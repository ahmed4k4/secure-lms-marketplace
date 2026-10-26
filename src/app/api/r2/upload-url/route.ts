import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { createR2UploadUrl, getR2Bucket, getR2CoverPublicUrl, getR2Limits } from "@/lib/server/r2";
import { canManageCourse, getCourseForLesson, getCourseForSection } from "@/lib/server/r2-access";
import { isAllowedR2ContentType, safeDisplayFileName, safeFileExtension } from "@/lib/server/r2-policy";
import { localRateLimit } from "@/lib/server/rate-limit";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  purpose: z.enum(["video", "resource", "cover"]),
  lessonId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(180),
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(3).max(150),
  sizeBytes: z.number().int().positive().max(4 * 1024 * 1024 * 1024),
}).superRefine((value, context) => {
  if (value.purpose === "video" && (!value.sectionId || value.lessonId)) {
    context.addIssue({ code: "custom", path: ["sectionId"], message: "Videos must be uploaded into a course section before the lesson is created" });
  }
  if (value.purpose === "resource" && (!value.lessonId || value.sectionId)) {
    context.addIssue({ code: "custom", path: ["lessonId"], message: "Resources must belong to an existing lesson" });
  }
  if (value.purpose === "cover" && (value.lessonId || value.sectionId)) {
    context.addIssue({ code: "custom", path: ["purpose"], message: "Course covers do not use a lesson or section ID" });
  }
  if (!isAllowedR2ContentType(value.purpose, value.contentType)) {
    context.addIssue({ code: "custom", path: ["contentType"], message: "Unsupported file type for this upload" });
  }
});

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const rate = localRateLimit(`r2-upload:${user.id}`, 10);
  if (!rate.allowed) return NextResponse.json({ error: "Too many upload requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const roles = await getUserRoles(user.id);
  if (!roles.some((role) => ["instructor", "super_admin"].includes(role))) {
    return NextResponse.json({ error: "An instructor account is required to upload course media" }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload details", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 });

  const value = parsed.data;
  // Covers use a same-origin multipart endpoint; never hand the browser a cross-origin R2 PUT URL for them.
  if (value.purpose === "cover") return NextResponse.json({ error: "Course covers must be uploaded through /api/r2/upload-cover. Direct browser-to-R2 cover uploads are disabled." }, { status: 410 });
  const limits = getR2Limits();
  const admin = createAdminClient();
  let courseId: string | null = null;
  let lessonId: string | null = null;
  let sectionId: string | null = null;
  let maximum = limits.resourceBytes;

  if (value.purpose === "cover") {
    maximum = limits.coverBytes;
  } else if (value.purpose === "video") {
    maximum = limits.videoBytes;
    const parent = await getCourseForSection(admin, value.sectionId!);
    if (!parent || !canManageCourse(parent.course, user.id, roles)) return NextResponse.json({ error: "Course owner access required" }, { status: 403 });
    if (parent.course.status === "archived") return NextResponse.json({ error: "Archived courses cannot accept new media" }, { status: 409 });
    courseId = parent.course.id;
    sectionId = parent.section.id;
  } else {
    const { data: setting } = await admin.from("platform_settings").select("value").eq("key", "uploads.max_resource_bytes").maybeSingle();
    if (typeof setting?.value === "number" && Number.isFinite(setting.value)) maximum = Math.max(1_048_576, Math.min(100 * 1024 * 1024, Math.floor(setting.value)));
    const parent = await getCourseForLesson(admin, value.lessonId!);
    if (!parent || !canManageCourse(parent.course, user.id, roles)) return NextResponse.json({ error: "Course owner access required" }, { status: 403 });
    if (parent.lesson.kind === "video" && !parent.lesson.r2_object_key) return NextResponse.json({ error: "Finish the video upload before attaching resources" }, { status: 409 });
    if (parent.course.status === "archived") return NextResponse.json({ error: "Archived courses cannot accept new media" }, { status: 409 });
    courseId = parent.course.id;
    lessonId = parent.lesson.id;
    sectionId = parent.section.id;
  }

  if (value.sizeBytes > maximum) return NextResponse.json({ error: `File exceeds the configured ${value.purpose} size limit (${Math.ceil(maximum / 1024 / 1024)} MB)` }, { status: 413 });

  const uploadId = randomUUID();
  const fileName = safeDisplayFileName(value.fileName);
  const extension = safeFileExtension(fileName, value.contentType);
  const objectKey = value.purpose === "cover"
    ? `lms/covers/${user.id}/${uploadId}.${extension}`
    : `lms/${value.purpose}/${courseId}/${sectionId}/${user.id}/${uploadId}.${extension}`;
  const expiresIn = limits.uploadTtlSeconds;
  const normalizedContentType = value.contentType.toLowerCase().split(";")[0]?.trim() ?? "";

  try {
    const bucket = getR2Bucket(value.purpose === "cover" ? "cover" : "private");
    if (value.purpose === "cover") getR2CoverPublicUrl(objectKey); // Validate public URL configuration before sending bytes.
    const { url } = await createR2UploadUrl({ key: objectKey, contentType: normalizedContentType, expiresIn, bucket });
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const { error } = await admin.from("r2_uploads").insert({
      id: uploadId,
      uploader_id: user.id,
      purpose: value.purpose,
      lesson_id: lessonId,
      section_id: sectionId,
      object_key: objectKey,
      title: value.title.trim(),
      original_filename: fileName,
      content_type: normalizedContentType,
      expected_size_bytes: value.sizeBytes,
      status: "pending",
      expires_at: expiresAt,
    });
    if (error) throw new Error(`Could not register upload intent (${error.code ?? "unknown"})`);
    await writeAuditLog({ actorId: user.id, action: `r2.${value.purpose}.upload_url.created`, targetType: "r2_upload", targetId: uploadId, metadata: { purpose: value.purpose, sizeBytes: value.sizeBytes, courseId } });
    return NextResponse.json({ uploadId, uploadUrl: url, expiresIn, requiredHeaders: { "Content-Type": normalizedContentType, "If-None-Match": "*" } }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    console.error("r2_upload_url_error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "R2 storage is not configured or upload preparation failed. Check bucket names and server credentials." }, { status: 503 });
  }
}
