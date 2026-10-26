import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { getR2Bucket, getR2CoverPublicUrl, getR2Limits, putR2Object } from "@/lib/server/r2";
import { isAllowedR2ContentType, matchesFileSignature, safeFileExtension, safeDisplayFileName } from "@/lib/server/r2-policy";
import { localRateLimit } from "@/lib/server/rate-limit";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_MULTIPART_BYTES = 4 * 1024 * 1024 + 64 * 1024;

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_MULTIPART_BYTES) return NextResponse.json({ error: "Cover upload exceeds the 4 MB limit. Resize the image and retry." }, { status: 413 });

  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const roles = await getUserRoles(user.id);
  if (!roles.some((role) => role === "instructor" || role === "super_admin")) return NextResponse.json({ error: "An instructor account is required to upload course covers" }, { status: 403 });
  const rate = localRateLimit(`r2-cover:${user.id}`, 12);
  if (!rate.allowed) return NextResponse.json({ error: "Too many cover uploads. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid multipart upload" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a JPG, PNG, or WebP image." }, { status: 400 });
  const limits = getR2Limits();
  if (file.size <= 0 || file.size > limits.coverBytes) return NextResponse.json({ error: `The cover image must be no larger than ${Math.ceil(limits.coverBytes / 1024 / 1024)} MB.` }, { status: 413 });
  const contentType = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!isAllowedR2ContentType("cover", contentType)) return NextResponse.json({ error: "Choose a JPG, PNG, or WebP image." }, { status: 415 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesFileSignature("cover", contentType, bytes)) return NextResponse.json({ error: "The file contents do not match the selected image type." }, { status: 415 });

  const uploadId = randomUUID();
  const objectKey = `lms/covers/${user.id}/${uploadId}.${safeFileExtension(safeDisplayFileName(file.name), contentType)}`;
  try {
    const bucket = getR2Bucket("cover");
    const publicUrl = getR2CoverPublicUrl(objectKey);
    await putR2Object({ key: objectKey, body: bytes, contentType, contentLength: bytes.byteLength, bucket });
    await writeAuditLog({ actorId: user.id, action: "r2.cover.uploaded", targetType: "course_cover", targetId: uploadId, metadata: { sizeBytes: bytes.byteLength, contentType } });
    return NextResponse.json({ publicUrl, uploadId }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("r2_cover_upload_failed", { name: error instanceof Error ? error.name : "unknown" });
    if (message.includes("CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL must be a public custom domain")) {
      return NextResponse.json({ error: "Your cover URL is configured as the R2 S3 API endpoint. Set CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL to the actual public custom domain or enabled r2.dev URL for the covers bucket, then restart the app." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not upload the cover to R2. Check the server-side R2 credentials, bucket, and public covers domain." }, { status: 503 });
  }
}
