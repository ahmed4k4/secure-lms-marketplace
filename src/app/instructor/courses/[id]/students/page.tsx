import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireInstructor } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { announceAction, deleteAnnouncementAction } from '@/actions/instructor';
import { ConfirmSubmit } from '@/components/form-bits';
import { ActionForm, Field } from '@/components/action-form';
import { Card, CardBody, CardHeader, EmptyState, Input, Progress, Textarea } from '@/components/ui/primitives';
import { formatDate } from '@/lib/utils';

export default async function StudentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { supabase } = await requireInstructor();
  const { t, locale } = await getT();
  const [{ data: students, error }, { data: stats }, { data: course }, { data: anns }] = await Promise.all([
    supabase.rpc('course_student_progress', { p_course_id: id }),
    supabase.rpc('course_analytics', { p_course_id: id }),
    supabase.from('courses').select('title').eq('id', id).maybeSingle(),
    supabase.from('announcements').select('id, title, body, created_at').eq('course_id', id).order('created_at', { ascending: false }).limit(20),
  ]);
  if (error || !course) notFound();
  const s = (stats ?? {}) as Record<string, number | null>;
  const tiles: [string, string | number][] = [
    [t('analytics.enrollments'), s.enrollments ?? 0], [t('analytics.active'), s.active_7d ?? 0], [t('analytics.completions'), s.completions ?? 0],
    [t('analytics.rating'), s.avg_rating ? `${s.avg_rating} (${s.review_count})` : '—'], [t('analytics.quiz'), s.avg_quiz_score != null ? `${s.avg_quiz_score}%` : '—'],
  ];
  return (
    <div className="space-y-6">
      <Link href={`/instructor/courses/${id}`} className="text-sm text-primary underline">← {course.title}</Link>
      <h1 className="text-3xl">{t('instr.students')}</h1>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map(([k, v]) => <div key={k} className="rounded-lg border border-border bg-card p-4"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-display text-2xl">{v}</dd></div>)}
      </dl>
      {students?.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-start">{t('auth.full_name')}</th><th className="p-3 text-start">{t('instr.col_progress')}</th><th className="p-3 text-start">{t('instr.col_enrolled')}</th><th className="p-3 text-start">{t('instr.col_activity')}</th></tr></thead>
            <tbody>{students.map((r: any) => (
              <tr key={r.user_id} className="border-t border-border"><td className="p-3">{r.full_name || '—'}</td>
                <td className="w-56 p-3"><Progress value={r.total_lessons ? (r.completed_lessons / r.total_lessons) * 100 : 0} label={r.full_name} /><span className="text-xs text-muted-foreground">{r.completed_lessons}/{r.total_lessons}</span></td>
                <td className="p-3">{formatDate(r.enrolled_at, locale)}</td><td className="p-3">{formatDate(r.last_activity, locale) || '—'}</td></tr>))}</tbody></table>
        </div>
      ) : <EmptyState title={t('instr.no_students')} />}
      <Card><CardHeader><h2 className="text-lg">{t('instr.announce')}</h2></CardHeader><CardBody>
        <ActionForm action={announceAction.bind(null, id)} submitLabel={t('instr.send')} resetOnSuccess>
          <Field label={t('instr.announce_title')} htmlFor="title"><Input id="title" name="title" required maxLength={120} /></Field>
          <Field label={t('instr.announce_body')} htmlFor="body"><Textarea id="body" name="body" required maxLength={2000} /></Field>
        </ActionForm>
        {!!anns?.length && (
          <ul className="mt-6 divide-y divide-border border-t border-border">
            {anns.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-3 text-sm"><div className="min-w-0 flex-1"><p className="font-semibold">{a.title}</p><p className="line-clamp-2 text-muted-foreground">{a.body}</p><p className="text-xs text-muted-foreground">{formatDate(a.created_at, locale)}</p></div>
                <form action={deleteAnnouncementAction.bind(null, id, a.id)}><ConfirmSubmit variant="ghost" size="sm" message={t('instr.confirm_delete')}>{t('action.delete')}</ConfirmSubmit></form></li>
            ))}
          </ul>
        )}
      </CardBody></Card>
    </div>
  );
}
