import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const API_ACCOUNT_ID = "CLOUDFLARE_R2_ACCOUNT_ID";
const BUCKET_ENV = "CLOUDFLARE_R2_BUCKET";
const COVERS_BUCKET_ENV = "CLOUDFLARE_R2_COVERS_BUCKET";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function positiveIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

let cachedClient: S3Client | undefined;
export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;
  const accountId = requiredEnv(API_ACCOUNT_ID);
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv("CLOUDFLARE_R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    },
  });
  return cachedClient;
}

export function getR2Bucket(purpose: "private" | "cover" = "private"): string {
  // Public course covers must live in a dedicated bucket. Never expose the private
  // video/resource bucket through a public custom domain.
  return purpose === "cover" ? requiredEnv(COVERS_BUCKET_ENV) : requiredEnv(BUCKET_ENV);
}

export function getR2CoverPublicUrl(key: string): string {
  const base = requiredEnv("CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL");
  const parsed = new URL(base);
  if (parsed.protocol !== "https:") throw new Error("CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL must use HTTPS");
  if (parsed.hostname.endsWith(".r2.cloudflarestorage.com") || parsed.hostname === "r2.cloudflarestorage.com") throw new Error("CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL must be a public custom domain or configured r2.dev URL, not the S3 API endpoint");
  const basePath = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  parsed.pathname = `${basePath}${key.split("/").map(encodeURIComponent).join("/")}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function getR2Limits() {
  return {
    resourceBytes: positiveIntegerEnv("R2_MAX_RESOURCE_SIZE_BYTES", 25 * 1024 * 1024, 1, 100 * 1024 * 1024),
    coverBytes: positiveIntegerEnv("R2_MAX_COVER_SIZE_BYTES", 4 * 1024 * 1024, 1, 4 * 1024 * 1024),
    videoBytes: positiveIntegerEnv("R2_MAX_VIDEO_SIZE_BYTES", 1024 * 1024 * 1024, 1, 4 * 1024 * 1024 * 1024),
    uploadTtlSeconds: positiveIntegerEnv("R2_UPLOAD_URL_TTL_SECONDS", 600, 60, 900),
    downloadTtlSeconds: positiveIntegerEnv("R2_DOWNLOAD_URL_TTL_SECONDS", 300, 60, 3600),
    playbackTtlSeconds: positiveIntegerEnv("R2_VIDEO_URL_TTL_SECONDS", 21600, 300, 43200),
  };
}

export async function createR2UploadUrl(input: { key: string; contentType: string; expiresIn: number; bucket?: string }) {
  const bucket = input.bucket ?? getR2Bucket();
  const command = new PutObjectCommand({ Bucket: bucket, Key: input.key, ContentType: input.contentType, IfNoneMatch: "*" });
  // These headers are part of the signature; clients cannot omit the create-only guard or change MIME type.
  const url = await getSignedUrl(getR2Client(), command, {
    expiresIn: input.expiresIn,
    signableHeaders: new Set(["content-type", "if-none-match"]),
  });
  return { url, bucket };
}

export async function putR2Object(input: { key: string; body: Uint8Array; contentType: string; contentLength: number; bucket: string }) {
  await getR2Client().send(new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
    IfNoneMatch: "*",
    CacheControl: "public, max-age=31536000, immutable",
  }));
}

export async function headR2Object(key: string, bucket?: string) {
  return getR2Client().send(new HeadObjectCommand({ Bucket: bucket ?? getR2Bucket(), Key: key }));
}

export async function getR2ObjectPrefix(key: string, bucket?: string, bytes = 16): Promise<Uint8Array> {
  const end = Math.max(0, Math.min(63, Math.floor(bytes) - 1));
  const response = await getR2Client().send(new GetObjectCommand({
    Bucket: bucket ?? getR2Bucket(),
    Key: key,
    Range: `bytes=0-${end}`,
  }));
  if (!response.Body) return new Uint8Array();
  return new Uint8Array(await response.Body.transformToByteArray());
}

function safeDownloadName(name: string): string {
  const normalized = name.replace(/[\r\n"\\/]/g, "_").trim().slice(0, 180) || "download";
  const ascii = normalized.replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(normalized).replace(/'/g, "%27");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function createR2DownloadUrl(input: {
  key: string;
  contentType: string;
  fileName: string;
  expiresIn: number;
  inline?: boolean;
  bucket?: string;
}) {
  const command = new GetObjectCommand({
    Bucket: input.bucket ?? getR2Bucket(),
    Key: input.key,
    ResponseContentType: input.contentType,
    ResponseContentDisposition: input.inline ? "inline" : safeDownloadName(input.fileName),
    ResponseCacheControl: "private, no-store, max-age=0",
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: input.expiresIn });
}

export async function deleteR2Object(key: string, bucket?: string): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket ?? getR2Bucket(), Key: key }));
}
