import Link from 'next/link';
import { Award, BookOpen, CheckCircle2, Play } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { CourseCover } from '@/components/course-card';
import { IconBox, MonoLabel } from '@/components/ui/brand';
import { EmptyState, Progress, Badge } from '@/components/ui/primitives';
import { buttonVariants } from '@/components/ui/button';
import { cn, formatDate } from '@/lib/utils';

export const metadata = { title: 'My learning' };

export default async function DashboardPage() {
  const { supabase, user, profile } = await requireUser('/dashboard');
  const { t, locale } = await getT();
  const { data: enrollments } = await supabase
    .from('enrollments').select('course_id, enrolled_at, courses(id, slug, title, subtitle, status, cover_url)')
    .eq('user_id', user.id).order('enrolled_at', { ascending: false });
  const ids = (enrollments ?? []).map((e) => e.course_id);
  const [{ data: lessons }, { data: done }, { data: certs }, { data: subs }, { data: last }] = ids.length
    ? await Promise.all([
        supabase.from('lessons').select('id, course_id').in('course_id', ids),
        supabase.from('lesson_progress').select('lesson_id, course_id').eq('user_id', user.id).eq('completed', true).in('course_id', ids),
        supabase.from('certificates').select('code, course_id').eq('user_id', user.id),
        supabase.from('submissions').select('id, score, assignments(title, max_score)').eq('user_id', user.id).not('score', 'is', null).order('graded_at', { ascending: false }).limit(5),
        supabase.from('lesson_progress').select('lesson_id, course_id, completed, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const total = (id: string) => (lessons ?? []).filter((l) => l.course_id === id).length;
  const completed = (id: string) => (done ?? []).filter((l) => l.course_id === id).length;
  const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? (x[0] ?? null) : x);
  const lastCourse = last?.[0] ? one((enrollments ?? []).find((e) => e.course_id === last[0].course_id)?.courses ?? null) : null;
  const { data: lastLesson } = last?.[0] ? await supabase.from('lessons').select('id, title').eq('id', last[0].lesson_id).maybeSingle() : { data: null };

  const stats: [React.ElementType, number, string][] = [
    [BookOpen, enrollments?.length ?? 0, t('dash.stat_courses')], [CheckCircle2, done?.length ?? 0, t('dash.stat_lessons')], [Award, certs?.length ?? 0, t('dash.stat_certs')],
  ];

  return (
    <div className="space-y-10">
      <div><MonoLabel>{'// DASHBOARD'}</MonoLabel><h1 className="mt-2 text-3xl md:text-4xl">{t('dash.welcome', { name: profile.full_name.split(' ')[0] || '' })}</h1></div>

      {lastCourse && lastLesson && (
        <section aria-label={t('dash.resume')} className="chrome-edge flex flex-wrap items-center gap-5 rounded-lg p-5">
          <IconBox variant="filled" size={56} className="rounded-full"><Play className="h-6 w-6 fill-current" strokeWidth={1.75} /></IconBox>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-arc">{t('dash.resume')}</p><p className="truncate font-display text-xl font-semibold">{lastLesson.title}</p><p className="truncate text-sm text-muted-foreground">{lastCourse.title}</p></div>
          <Link href={`/learn/${lastCourse.slug}/${lastLesson.id}`} className={cn(buttonVariants({ size: 'lg' }))}>{t('course.continue')}</Link>
        </section>
      )}

      <ul className="grid grid-cols-3 gap-3">
        {stats.map(([Icon, n, label]) => (
          <li key={label} className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
            <IconBox size={48}><Icon className="h-5 w-5" strokeWidth={1.75} /></IconBox>
            <div><p dir="ltr" className="num text-2xl font-semibold">{n}</p><p className="text-xs text-muted-foreground">{label}</p></div>
          </li>
        ))}
      </ul>

      {enrollments?.length ? (
        <section aria-labelledby="mine"><h2 id="mine" className="mb-4 text-2xl">{t('dash.my_courses')}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {enrollments.map((e) => {
              const c = one(e.courses as any) as { id: string; slug: string; title: string; status: string; cover_url: string | null } | null;
              if (!c) return null;
              const pct = total(c.id) ? (completed(c.id) / total(c.id)) * 100 : 0;
              const cert = certs?.find((x) => x.course_id === c.id);
              return (
                <div key={e.course_id} className="hover-lift flex flex-col overflow-hidden rounded-lg border border-border bg-card">
                  <CourseCover title={c.title} className="h-28" imageUrl={c.cover_url} />
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <h3 className="line-clamp-2 text-lg font-semibold">{c.title}</h3>
                    <Progress value={pct} label={c.title} />
                    <p className="text-xs text-muted-foreground">{t('dash.progress', { done: completed(c.id), total: total(c.id) })} · {formatDate(e.enrolled_at, locale)}</p>
                    {c.status === 'suspended' && <Badge tone="danger">{t('status.suspended')}</Badge>}
                    <div className="mt-auto flex gap-2 pt-1">
                      <Link href={`/learn/${c.slug}`} className={cn(buttonVariants({ size: 'sm' }))}>{t('course.continue')}</Link>
                      {cert && <Link href={`/certificates/${cert.code}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>{t('dash.certificate')}</Link>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <EmptyState title={t('dash.empty')} hint={t('dash.empty_hint')}><Link href="/courses" className={cn(buttonVariants())}>{t('home.cta_browse')}</Link></EmptyState>
      )}

      {!!subs?.length && (
        <section><h2 className="mb-3 text-xl">{t('dash.grades')}</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {subs.map((s) => { const a = one(s.assignments as any) as { title: string; max_score: number } | null; return <li key={s.id} className="flex items-center justify-between px-4 py-3"><span>{a?.title}</span><span dir="ltr" className="num font-semibold text-arc">{s.score}{a ? ` / ${a.max_score}` : ''}</span></li>; })}
          </ul></section>
      )}
    </div>
  );
}
