import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const accountId = required("CLOUDFLARE_R2_ACCOUNT_ID");
const bucket = required("CLOUDFLARE_R2_BUCKET");
const appUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const dryRun = !process.argv.includes("--apply");
const gracePeriodMs = 24 * 60 * 60 * 1000;
const deleteLimit = 250;

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: required("CLOUDFLARE_R2_ACCESS_KEY_ID"),
    secretAccessKey: required("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
  },
});
const supabase = createClient(appUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function readAll(table, columns) {
  const result = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    result.push(...(data ?? []));
    if (!data || data.length < pageSize) return result;
  }
}

async function main() {
  const [lessons, resources, uploads] = await Promise.all([
    readAll("lessons", "r2_object_key"),
    readAll("lesson_resources", "storage_path"),
    readAll("r2_uploads", "object_key,status,expires_at,claimed_lesson_id"),
  ]);

  const protectedKeys = new Set();
  for (const lesson of lessons) if (lesson.r2_object_key) protectedKeys.add(lesson.r2_object_key);
  for (const resource of resources) {
    if (typeof resource.storage_path === "string" && resource.storage_path.startsWith("lms/")) {
      protectedKeys.add(resource.storage_path);
    }
  }
  const now = Date.now();
  const staleCutoff = now - gracePeriodMs;
  for (const upload of uploads) {
    const expiresAt = new Date(upload.expires_at).getTime();
    const activePending = upload.status === "pending" && expiresAt > staleCutoff;
    const activeUnclaimedVideo = upload.status === "uploaded" && expiresAt > now;
    const activeClaim = upload.status === "claimed" && (Boolean(upload.claimed_lesson_id) || expiresAt > staleCutoff);
    if (activePending || activeUnclaimedVideo || activeClaim) protectedKeys.add(upload.object_key);
  }

  let continuationToken;
  const candidates = [];
  do {
    const response = await r2.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: "lms/",
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    }));
    for (const object of response.Contents ?? []) {
      if (!object.Key || protectedKeys.has(object.Key) || !object.LastModified) continue;
      if (object.LastModified.getTime() < staleCutoff) candidates.push({ key: object.Key, size: object.Size ?? 0, lastModified: object.LastModified });
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken && candidates.length < deleteLimit + 1);

  candidates.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
  const selected = candidates.slice(0, deleteLimit);
  const totalBytes = selected.reduce((sum, object) => sum + object.size, 0);
  console.log(`Mode: ${dryRun ? "DRY RUN (no deletion)" : "APPLY (deleting objects)"}`);
  console.log(`Referenced keys protected: ${protectedKeys.size}`);
  console.log(`Unreferenced objects older than 24 hours found: ${candidates.length}${candidates.length > deleteLimit ? " (showing first 250; rerun to continue)" : ""}`);
  console.log(`Selected bytes: ${totalBytes} (${(totalBytes / (1024 ** 3)).toFixed(3)} GiB)`);
  for (const object of selected) console.log(`${dryRun ? "WOULD DELETE" : "DELETING"}\t${object.size}\t${object.key}`);

  if (!dryRun) {
    for (const object of selected) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.key }));
    }
    console.log(`Deleted ${selected.length} object(s).`);
  } else {
    console.log("Nothing deleted. Run `npm run cleanup:r2-orphans -- --apply` only after reviewing the list.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "R2 cleanup failed");
  process.exitCode = 1;
});
