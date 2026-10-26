import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { deleteR2Object, getR2Bucket, getR2CoverPublicUrl, getR2Limits, getR2ObjectPrefix, headR2Object } from "@/lib/server/r2";
import { canManageCourse, getCourseForLesson, getCourseForSection } from "@/lib/server/r2-access";
import { matchesFileSignature } from "@/lib/server/r2-policy";
import { localRateLimit } from "@/lib/server/rate-limit";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ uploadId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const rate = localRateLimit(`r2-complete:${user.id}`, 12);
  if (!rate.allowed) return NextResponse.json({ error: "Too many completion requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload ID" }, { status: 400 });

  const roles = await getUserRoles(user.id);
  const admin = createAdminClient();
  const { data: upload, error: uploadError } = await admin.from("r2_uploads")
    .select("id,uploader_id,purpose,lesson_id,section_id,object_key,title,original_filename,content_type,expected_size_bytes,status,expires_at,resource_id,claimed_lesson_id")
    .eq("id", parsed.data.uploadId).maybeSingle();
  if (uploadError || !upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  if (upload.uploader_id !== user.id) return NextResponse.json({ error: "Upload owner access required" }, { status: 403 });

  let bucket: ReturnType<typeof getR2Bucket>;
  try { bucket = upload.purpose === "cover" ? getR2Bucket("cover") : getR2Bucket("private"); }
  catch { return NextResponse.json({ error: "Cloudflare R2 storage is not configured on the server" }, { status: 503 }); }
  if (upload.purpose === "cover" && upload.status === "complete") {
    try { return NextResponse.json({ status: "complete", publicUrl: getR2CoverPublicUrl(upload.object_key) }, { headers: { "Cache-Control": "no-store, private" } }); }
    catch { return NextResponse.json({ error: "Configure a public HTTPS domain for the dedicated course-cover bucket" }, { status: 503 }); }
  }
  if (upload.status === "complete" && upload.resource_id) return NextResponse.json({ status: "complete", resourceId: upload.resource_id }, { headers: { "Cache-Control": "no-store, private" } });
  if (upload.status === "uploaded" && upload.purpose === "video") return NextResponse.json({ status: "uploaded", uploadId: upload.id }, { headers: { "Cache-Control": "no-store, private" } });
  if (upload.status !== "pending") return NextResponse.json({ error: "Upload is no longer pending" }, { status: 409 });
  if (new Date(upload.expires_at).getTime() < Date.now() - 30_000) {
    await admin.from("r2_uploads").update({ status: "expired" }).eq("id", upload.id).eq("status", "pending");
    return NextResponse.json({ error: "Upload URL expired; select the file again to request a new upload URL" }, { status: 410 });
  }

  let courseId: string | null = null;
  if (upload.purpose !== "cover") {
    const parent = upload.purpose === "video"
      ? await getCourseForSection(admin, upload.section_id)
      : upload.lesson_id ? await getCourseForLesson(admin, upload.lesson_id) : null;
    if (!parent || !canManageCourse(parent.course, user.id, roles)) return NextResponse.json({ error: "Course owner access required" }, { status: 403 });
    if (parent.course.status === "archived") return NextResponse.json({ error: "Archived courses cannot accept new media" }, { status: 409 });
    courseId = parent.course.id;
  }

  const limits = getR2Limits();
  const maximum = upload.purpose === "video" ? limits.videoBytes : upload.purpose === "cover" ? limits.coverBytes : limits.resourceBytes;
  let objectHead;
  try {
    objectHead = await headR2Object(upload.object_key, bucket);
  } catch {
    return NextResponse.json({ error: "Uploaded object was not found in R2 yet. Wait for the upload to finish and retry." }, { status: 422 });
  }
  const actualSize = objectHead.ContentLength;
  const actualType = objectHead.ContentType?.toLowerCase().split(";")[0]?.trim();
  const expectedType = String(upload.content_type).toLowerCase().split(";")[0]?.trim();
  let signatureValid = false;
  if (Number.isSafeInteger(actualSize) && actualSize === Number(upload.expected_size_bytes) && actualSize! > 0 && actualSize! <= maximum && actualType === expectedType) {
    try { signatureValid = matchesFileSignature(upload.purpose, expectedType, await getR2ObjectPrefix(upload.object_key, bucket, 16)); }
    catch { signatureValid = false; }
  }
  if (!Number.isSafeInteger(actualSize) || actualSize !== Number(upload.expected_size_bytes) || actualSize! <= 0 || actualSize! > maximum || actualType !== expectedType || !signatureValid) {
    try { await deleteR2Object(upload.object_key, bucket); } catch (cleanupError) { console.error("r2_invalid_object_cleanup_failed", cleanupError instanceof Error ? cleanupError.message : "unknown"); }
    await admin.from("r2_uploads").update({ status: "expired" }).eq("id", upload.id).eq("status", "pending");
    return NextResponse.json({ error: "Uploaded file size, MIME metadata, or file signature did not match the approved upload request" }, { status: 422 });
  }

  try {
    if (upload.purpose === "cover") {
      const { data: updated, error: updateError } = await admin.from("r2_uploads")
        .update({ status: "complete" }).eq("id", upload.id).eq("status", "pending").select("id").maybeSingle();
      if (updateError || !updated) return NextResponse.json({ error: "Cover upload was finalized concurrently; retry completion" }, { status: 409 });
      const publicUrl = getR2CoverPublicUrl(upload.object_key);
      await writeAuditLog({ actorId: user.id, action: "r2.cover.uploaded", targetType: "r2_upload", targetId: upload.id, metadata: { sizeBytes: actualSize } });
      return NextResponse.json({ status: "complete", publicUrl }, { headers: { "Cache-Control": "no-store, private" } });
    }

    if (upload.purpose === "resource") {
      const { data: existing } = await admin.from("lesson_resources").select("id").eq("storage_path", upload.object_key).maybeSingle();
      let resourceId = existing?.id as string | undefined;
      if (!resourceId) {
        const { data: resource, error: resourceError } = await admin.from("lesson_resources").insert({
          lesson_id: upload.lesson_id, title: upload.title, storage_path: upload.object_key,
          mime_type: expectedType, size_bytes: actualSize,
        }).select("id").single();
        if (resourceError || !resource) throw new Error("Could not register R2 lesson resource");
        resourceId = resource.id;
      }
      const { error: completeError } = await admin.from("r2_uploads").update({ status: "complete", resource_id: resourceId }).eq("id", upload.id).eq("status", "pending");
      if (completeError) throw new Error("Could not finalize resource upload");
      await writeAuditLog({ actorId: user.id, action: "r2.resource.uploaded", targetType: "lesson_resource", targetId: resourceId, metadata: { lessonId: upload.lesson_id, sizeBytes: actualSize } });
      return NextResponse.json({ status: "complete", resourceId }, { headers: { "Cache-Control": "no-store, private" } });
    }

    const { data: updated, error: updateError } = await admin.from("r2_uploads")
      .update({ status: "uploaded", expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
      .eq("id", upload.id).eq("status", "pending").select("id").maybeSingle();
    if (updateError || !updated) return NextResponse.json({ error: "Upload was finalized concurrently; refresh and retry" }, { status: 409 });
    await writeAuditLog({ actorId: user.id, action: "r2.video.uploaded", targetType: "r2_upload", targetId: upload.id, metadata: { courseId, sectionId: upload.section_id, sizeBytes: actualSize } });
    return NextResponse.json({ status: "uploaded", uploadId: upload.id }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    console.error("r2_upload_finalize_error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Could not finalize upload metadata" }, { status: 503 });
  }
}
