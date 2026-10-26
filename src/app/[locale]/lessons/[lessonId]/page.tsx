import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccountState, getUserRoles } from "@/lib/server/auth";
import { canReadLessonContent, getCourseForLesson } from "@/lib/server/r2-access";
import { LessonPlayer } from "@/components/lesson-player";
export const metadata = { robots: { index: false, follow: false } };

export default async function LessonPage({ params }: { params: Promise<{ locale: string; lessonId: string }> }) {
  const { locale, lessonId } = await params; const ar = locale === "ar"; const session = await createClient();
  const { data: { user } } = await session.auth.getUser(); const admin = createAdminClient();
  const parent = await getCourseForLesson(admin, lessonId);
  if (!parent || parent.course.status !== "published" || !parent.lesson.is_published) notFound();
  if (!user && !parent.lesson.is_preview) redirect(`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/lessons/${lessonId}`)}`);
  if (user) {
    const state = await getAccountState(user.id);
    if (state !== "active") redirect(`/${locale}/sign-in?account=${state === "suspended" ? "suspended" : state === "pending" ? "pending" : state === "missing" ? "setup" : "profile_error"}`);
    const roles = await getUserRoles(user.id);
    const canRead = await canReadLessonContent({ admin, userSupabase: session, userId: user.id, roles, course: parent.course, lesson: parent.lesson });
    if (!canRead) redirect(`/${locale}/courses/${parent.course.slug}?access=required`);
  }
  const { data: lesson, error } = await session.from("lessons").select("id,title_ar,title_en,kind,body_ar,body_en,is_preview").eq("id", lessonId).maybeSingle();
  if (error || !lesson) notFound();
  return <section className="section"><div className="container lesson-page-container"><Link href={`/${locale}/courses/${parent.course.slug}`} className="muted">← {ar ? parent.course.title_ar : parent.course.title_en}</Link><div className="lesson-page-heading"><span className="eyebrow">{ar ? "درس من الكورس" : "COURSE LESSON"}</span><h1>{ar ? lesson.title_ar : lesson.title_en}</h1>{lesson.is_preview && <span className="status-chip status-active">{ar ? "معاينة مجانية" : "Free preview"}</span>}</div>{lesson.kind === "video" ? <LessonPlayer lessonId={lesson.id} locale={locale} /> : <article className="panel lesson-text-content">{ar ? lesson.body_ar : lesson.body_en}</article>}</div></section>;
}
