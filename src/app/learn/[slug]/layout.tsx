import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, ClipboardList, ListChecks } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { LessonLink } from '@/components/lesson-link';
import { Progress } from '@/components/ui/primitives';
import { formatHM } from '@/lib/utils';

export default async function LearnLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, user } = await requireUser(`/learn/${slug}`);
  const { t, locale } = await getT();
  const { data: course } = await supabase.from('courses').select('id, slug, title').eq('slug', slug).maybeSingle();
  if (!course) notFound();

  const [{ data: sections }, { data: progress }, { data: quizzes }, { data: assignments }, a, m] = await Promise.all([
    supabase.from('sections').select('id, title, position, lessons(id, title, type, position, is_free_preview, duration_seconds)').eq('course_id', course.id).order('position'),
    supabase.from('lesson_progress').select('lesson_id, completed').eq('user_id', user.id).eq('course_id', course.id),
    supabase.from('quizzes').select('id, title').eq('course_id', course.id).eq('is_published', true),
    supabase.from('assignments').select('id, title').eq('course_id', course.id).eq('is_published', true),
    supabase.rpc('has_course_access', { p_course_id: course.id }),
    supabase.rpc('can_manage_course', { p_course_id: course.id }),
  ]);
  const full = a.data === true || m.data === true;
  const doneSet = new Set((progress ?? []).filter((p) => p.completed).map((p) => p.lesson_id));
  const all = (sections ?? []).flatMap((s) => s.lessons as any[]);
  const pct = all.length ? (all.filter((l) => doneSet.has(l.id)).length / all.length) * 100 : 0;
  const Back = locale === 'ar' ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-card px-4 py-3">
        <Link href={`/courses/${slug}`} className="inline-flex items-center gap-2 text-sm font-semibold text-silver hover:text-arc"><Back className="h-4 w-4" strokeWidth={1.75} />{t('learn.back')}</Link>
        <Link href={`/learn/${slug}`} className="min-w-0 flex-1 truncate font-display text-base font-semibold hover:text-arc">{course.title}</Link>
        <div className="flex w-full items-center gap-3 sm:w-64"><Progress value={pct} label={course.title} /><span dir="ltr" className="num w-10 text-end text-sm text-silver">{Math.round(pct)}%</span></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_21rem]">
        <section className="min-w-0">{children}</section>
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
          <div className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 text-base">{t('course.curriculum')}</h2>
            <nav aria-label={t('course.curriculum')} className="space-y-1 p-2">
              {(sections ?? []).map((s) => {
                const ls = [...(s.lessons as any[])].sort((x, y) => x.position - y.position);
                const secDone = ls.filter((l) => doneSet.has(l.id)).length;
                return (
                  <details key={s.id} open className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2.5 hover:bg-steel/50">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.title}</span>
                      <span dir="ltr" className="num text-xs text-muted-foreground">{secDone}/{ls.length}</span>
                    </summary>
                    <div className="space-y-0.5 pb-2">
                      {ls.map((l) => <LessonLink key={l.id} href={`/learn/${slug}/${l.id}`} title={l.title} type={l.type} done={doneSet.has(l.id)} locked={!(full || l.is_free_preview)} seconds={l.duration_seconds} />)}
                    </div>
                  </details>
                );
              })}
              {full && !!quizzes?.length && (
                <div className="border-t border-border pt-2"><p className="px-3 py-1 text-xs font-semibold text-muted-foreground">{t('learn.quizzes')}</p>
                  {quizzes.map((q) => <Link key={q.id} href={`/learn/${slug}/quiz/${q.id}`} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-silver hover:bg-steel/70"><ListChecks className="h-4 w-4 text-arc" strokeWidth={1.75} aria-hidden />{q.title}</Link>)}</div>
              )}
              {full && !!assignments?.length && (
                <div className="border-t border-border pt-2"><p className="px-3 py-1 text-xs font-semibold text-muted-foreground">{t('learn.assignments')}</p>
                  {assignments.map((x) => <Link key={x.id} href={`/learn/${slug}/assignment/${x.id}`} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-silver hover:bg-steel/70"><ClipboardList className="h-4 w-4 text-arc" strokeWidth={1.75} aria-hidden />{x.title}</Link>)}</div>
              )}
            </nav>
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{formatHM(all.reduce((n, l) => n + (l.duration_seconds ?? 0), 0), { h: t('unit.h'), m: t('unit.m') })}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
