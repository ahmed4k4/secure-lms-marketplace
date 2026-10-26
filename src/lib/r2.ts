import 'server-only';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiError } from '@/lib/api-error';
import { serverEnv } from '@/lib/env';

let client: S3Client | undefined;
export function r2() {
  if (!client) {
    const env = serverEnv();
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
  }
  return client;
}
const bucket = () => serverEnv().R2_BUCKET;

/** Short-lived upload URL. Content-Type and Content-Length are part of the signature. */
export function presignPut(a: { key: string; contentType: string; sizeBytes: number; expiresIn?: number }) {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({ Bucket: bucket(), Key: a.key, ContentType: a.contentType, ContentLength: a.sizeBytes }),
    { expiresIn: a.expiresIn ?? 900, signableHeaders: new Set(['content-type', 'content-length']) },
  );
}

export function presignGet(a: { key: string; expiresIn: number; disposition?: 'inline' | 'attachment'; filename?: string }) {
  const name = a.filename ? `; filename="${a.filename.replace(/[^\w.\- ]/g, '_')}"` : '';
  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: a.key,
      ResponseContentDisposition: `${a.disposition ?? 'inline'}${name}`,
      ResponseCacheControl: 'private, no-store',
    }),
    { expiresIn: a.expiresIn },
  );
}

export async function headObject(key: string) {
  const r = await r2().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
  return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? '' };
}

export async function readHead(key: string, bytes = 32): Promise<Uint8Array> {
  const r = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${bytes - 1}` }));
  return (await r.Body?.transformToByteArray()) ?? new Uint8Array();
}

export async function deleteObject(key: string) {
  await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}


/** Validates that public cover assets use a real URL and a bucket separate from private lesson media. */
function validatedCoverBaseUrl() {
  const env = serverEnv();
  if (!env.R2_COVERS_BUCKET || !env.R2_COVERS_PUBLIC_URL) {
    throw new ApiError(503, 'COVER_STORAGE_NOT_CONFIGURED', 'Configure a dedicated public R2 covers bucket and its public URL.');
  }
  let url: URL;
  try { url = new URL(env.R2_COVERS_PUBLIC_URL); } catch {
    throw new ApiError(503, 'COVER_PUBLIC_DOMAIN_INVALID', 'Configure the actual public r2.dev or custom-domain URL.');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !host || /r2\.cloudflarestorage\.com$/i.test(host) || host.endsWith('.example') || /(?:your-public|placeholder)/i.test(host) || env.R2_COVERS_BUCKET === env.R2_BUCKET) {
    throw new ApiError(503, 'COVER_PUBLIC_DOMAIN_INVALID', 'Use a real public r2.dev/custom domain and a dedicated covers bucket separate from private course media.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const COVER_KEY_PATTERN = /^covers\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i;
function assertCoverKey(key: string) {
  if (!COVER_KEY_PATTERN.test(key)) throw new ApiError(400, 'INVALID_COVER_KEY', 'Invalid cover object key.');
}

/** Covers are written server-side to a dedicated public bucket. This avoids browser CORS for cover uploads. */
export function coverPublicUrl(key: string) {
  assertCoverKey(key);
  const base = validatedCoverBaseUrl();
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function uploadCoverObject(input: { key: string; bytes: Uint8Array; contentType: string }) {
  const env = serverEnv();
  const publicUrl = coverPublicUrl(input.key); // Validate before writing so bad config does not leave orphaned public files.
  await r2().send(new PutObjectCommand({
    Bucket: env.R2_COVERS_BUCKET, Key: input.key, Body: input.bytes, ContentType: input.contentType,
    CacheControl: 'public, max-age=31536000, immutable', Metadata: { purpose: 'lms-course-cover' },
  }));
  return { objectKey: input.key, publicUrl };
}

export async function deleteCoverObject(key: string) {
  const env = serverEnv();
  assertCoverKey(key);
  await r2().send(new DeleteObjectCommand({ Bucket: env.R2_COVERS_BUCKET, Key: key }));
}

export async function headCoverObject(key: string) {
  const env = serverEnv();
  assertCoverKey(key);
  const result = await r2().send(new HeadObjectCommand({ Bucket: env.R2_COVERS_BUCKET, Key: key }));
  return { size: Number(result.ContentLength ?? 0), contentType: result.ContentType ?? '' };
}
