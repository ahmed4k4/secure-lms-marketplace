import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles, isAccountActive } from "@/lib/server/auth";
import { getCourseForLesson, canReadLessonContent } from "@/lib/server/r2-access";
import { isSameOriginMutation } from "@/lib/server/request-security";
import { localRateLimit } from "@/lib/server/rate-limit";
const schema = z.object({ lessonId: z.string().uuid(), positionSeconds: z.number().int().min(0).max(21_600), completed: z.boolean().default(false) });
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
  const session = await createClient(); const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAccountActive(user.id))) return NextResponse.json({ error: "Active account required" }, { status: 403 });
  const rate = localRateLimit(`lesson-progress:${user.id}`, 40);
  if (!rate.allowed) return NextResponse.json({ error: "Progress update limit reached" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let raw: unknown; try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: "Invalid progress update" }, { status: 400 });
  const admin = createAdminClient(); const parent = await getCourseForLesson(admin, parsed.data.lessonId);
  if (!parent || parent.course.status !== "published" || !parent.lesson.is_published) return NextResponse.json({ error: "Lesson unavailable" }, { status: 404 });
  const roles = await getUserRoles(user.id);
  if (!(await canReadLessonContent({ admin, userSupabase: session, userId: user.id, roles, course: parent.course, lesson: parent.lesson }))) return NextResponse.json({ error: "You do not have access to this lesson" }, { status: 403 });
  const position = Math.min(parsed.data.positionSeconds, parent.lesson.duration_seconds ?? 21_600);
  const duration = parent.lesson.duration_seconds;
  const canMarkComplete = parsed.data.completed && duration !== null && duration > 0 && position >= Math.max(0, duration - 10);
  const { data: current } = await admin.from("lesson_progress").select("completed_at").eq("user_id", user.id).eq("lesson_id", parent.lesson.id).maybeSingle();
  const { error } = await admin.from("lesson_progress").upsert({ user_id: user.id, lesson_id: parent.lesson.id, last_position_seconds: position, completed_at: current?.completed_at ?? (canMarkComplete ? new Date().toISOString() : null), updated_at: new Date().toISOString() }, { onConflict: "user_id,lesson_id" });
  if (error) { console.error("lesson_progress_save_failed", JSON.stringify({ code: error.code ?? "unknown" })); return NextResponse.json({ error: "Could not save lesson progress" }, { status: 503 }); }
  return NextResponse.json({ success: true, positionSeconds: position, completed: Boolean(current?.completed_at || canMarkComplete) }, { headers: { "Cache-Control": "no-store, private" } });
}
