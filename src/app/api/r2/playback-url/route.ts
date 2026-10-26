import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccountState, getUserRoles } from "@/lib/server/auth";
import { canReadLessonContent, getCourseForLesson } from "@/lib/server/r2-access";
import { createR2DownloadUrl, getR2Limits } from "@/lib/server/r2";
import { localRateLimit } from "@/lib/server/rate-limit";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { writeAuditLog } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ lessonId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid lesson ID" }, { status: 400 });

  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  const admin = createAdminClient();
  const parent = await getCourseForLesson(admin, parsed.data.lessonId);
  if (!parent || parent.lesson.kind !== "video" || !parent.lesson.r2_object_key || parent.course.status !== "published" || !parent.lesson.is_published) {
    return NextResponse.json({ error: "Video lesson is unavailable or has not been migrated to private R2 storage" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (parent.lesson.processing_status !== "ready") return NextResponse.json({ error: "Video is not ready to play yet. Refresh the lesson editor and try again." }, { status: 409, headers: { "Cache-Control": "no-store" } });

  let watermark = "preview";
  if (user) {
    const state = await getAccountState(user.id);
    if (state !== "active") return NextResponse.json({ error: "Active account required" }, { status: 403 });
    const rate = localRateLimit(`r2-playback:${user.id}`, 30);
    if (!rate.allowed) return NextResponse.json({ error: "Playback request limit reached" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
    const roles = await getUserRoles(user.id);
    if (!(await canReadLessonContent({ admin, userSupabase: session, userId: user.id, roles, course: parent.course, lesson: parent.lesson }))) {
      return NextResponse.json({ error: "You do not have access to this lesson" }, { status: 403 });
    }
    watermark = user.id.slice(0, 8);
  } else {
    if (!parent.lesson.is_preview) return NextResponse.json({ error: "Sign in and enroll to watch this lesson" }, { status: 401 });
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientIp = (forwarded && /^[0-9a-fA-F:.]{3,64}$/.test(forwarded)) ? forwarded : "unknown";
    const rate = localRateLimit(`r2-preview:${clientIp}`, 12);
    if (!rate.allowed) return NextResponse.json({ error: "Preview request limit reached" }, { status: 429 });
  }

  try {
    const { data: upload } = await admin.from("r2_uploads").select("content_type")
      .eq("claimed_lesson_id", parent.lesson.id).eq("purpose", "video").maybeSingle();
    const contentType = upload?.content_type;
    if (!contentType || !["video/mp4", "video/webm", "video/quicktime"].includes(contentType)) {
      return NextResponse.json({ error: "Video storage metadata is invalid. Contact the course instructor." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const expiresIn = getR2Limits().playbackTtlSeconds;
    const videoUrl = await createR2DownloadUrl({
      key: parent.lesson.r2_object_key,
      contentType,
      fileName: parent.lesson.title_en || "course-video",
      expiresIn,
      inline: true,
    });
    if (user) await writeAuditLog({ actorId: user.id, action: "r2.video.playback_url.issued", targetType: "lesson", targetId: parent.lesson.id, metadata: { courseId: parent.course.id, expiresIn } });
    return NextResponse.json({ videoUrl, expiresIn, watermark, canTrackProgress: Boolean(user) }, { headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } });
  } catch (error) {
    console.error("r2_playback_url_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Private R2 video storage is not configured or playback authorization failed" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
