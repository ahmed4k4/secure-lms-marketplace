import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { canManageCourse, getCourseForSection } from "@/lib/server/r2-access";
import { localRateLimit } from "@/lib/server/rate-limit";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

const schema = z.object({
  titleEn: z.string().trim().min(1).max(180),
  titleAr: z.string().trim().min(1).max(180),
  kind: z.enum(["video", "text"]).default("video"),
  bodyEn: z.string().max(50_000).optional(),
  bodyAr: z.string().max(50_000).optional(),
  r2UploadId: z.string().uuid().optional(),
  isPreview: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
}).superRefine((value, context) => {
  if (value.kind === "video" && !value.r2UploadId) context.addIssue({ code: "custom", path: ["r2UploadId"], message: "Upload the video to private R2 storage before creating this lesson" });
  if (value.kind !== "video" && value.r2UploadId) context.addIssue({ code: "custom", path: ["r2UploadId"], message: "Only video lessons can reference an R2 video upload" });
});

export async function POST(request: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const { sectionId } = await params;
  if (!z.string().uuid().safeParse(sectionId).success) return NextResponse.json({ error: "Invalid section ID" }, { status: 400 });
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const rate = localRateLimit(`lesson-create:${user.id}`, 30);
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const roles = await getUserRoles(user.id);
  if (!roles.some((role) => ["instructor", "super_admin"].includes(role))) return NextResponse.json({ error: "Instructor role required" }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid lesson fields", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 });

  const value = parsed.data;
  const admin = createAdminClient();
  const parent = await getCourseForSection(admin, sectionId);
  if (!parent || !canManageCourse(parent.course, user.id, roles)) return NextResponse.json({ error: "Course owner access required" }, { status: 403 });
  if (parent.course.status === "archived") return NextResponse.json({ error: "Archived courses cannot accept new lessons" }, { status: 409 });

  let upload: { id: string; object_key: string; expected_size_bytes: number | string; expires_at: string; status: string; uploader_id: string; section_id: string | null } | null = null;
  if (value.kind === "video") {
    const { data, error } = await admin.from("r2_uploads")
      .select("id,purpose,object_key,expected_size_bytes,expires_at,status,uploader_id,section_id")
      .eq("id", value.r2UploadId!).maybeSingle();
    if (error || !data || data.purpose !== "video" || data.uploader_id !== user.id || data.section_id !== sectionId || data.status !== "uploaded" || new Date(data.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "The R2 video upload is missing, expired, already linked, or belongs to a different section" }, { status: 409 });
    }
    upload = data;
  }

  const { data: lesson, error: lessonError } = await admin.from("lessons").insert({
    section_id: sectionId,
    title_en: value.titleEn,
    title_ar: value.titleAr,
    kind: value.kind,
    body_en: value.kind === "text" ? (value.bodyEn ?? null) : null,
    body_ar: value.kind === "text" ? (value.bodyAr ?? null) : null,
    is_preview: value.isPreview,
    sort_order: value.sortOrder,
    stream_uid: null,
    r2_object_key: upload?.object_key ?? null,
    r2_size_bytes: upload ? Number(upload.expected_size_bytes) : null,
    processing_status: "ready",
    is_published: false,
  }).select("id,title_en,title_ar,kind,is_published,processing_status").single();

  if (lessonError || !lesson) {
    console.error("create_lesson_failed", JSON.stringify({ code: lessonError?.code ?? "unknown" }));
    return NextResponse.json({ error: "Could not create the lesson. Confirm migration 0009 and the course-section ownership." }, { status: 400 });
  }

  if (upload) {
    const { data: claimed, error: claimError } = await admin.from("r2_uploads")
      .update({ status: "claimed", claimed_lesson_id: lesson.id })
      .eq("id", upload.id).eq("uploader_id", user.id).eq("status", "uploaded")
      .select("id").maybeSingle();
    if (claimError || !claimed) {
      await admin.from("lessons").delete().eq("id", lesson.id);
      return NextResponse.json({ error: "This video upload has already been linked to a lesson. Upload it again if necessary." }, { status: 409 });
    }
  }

  await writeAuditLog({ actorId: user.id, action: "lesson.created", targetType: "lesson", targetId: lesson.id, metadata: { sectionId, kind: value.kind, hasR2Video: Boolean(upload) } });
  return NextResponse.json({ lesson }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
}
