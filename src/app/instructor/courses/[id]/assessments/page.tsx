import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireInstructor } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getT } from '@/lib/i18n';
import {
  addQuestionAction, createAssignmentAction, createQuizAction, deleteAssignmentAction, deleteQuestionAction, deleteQuizAction,
  gradeSubmissionAction, toggleAssignmentPublishAction, toggleQuizPublishAction,
} from '@/actions/instructor';
import { ActionForm, Field } from '@/components/action-form';
import { ConfirmSubmit } from '@/components/form-bits';
import { Badge, Card, CardBody, CardHeader, Input, Select, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

export default async function AssessmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { supabase } = await requireInstructor();
  const { t } = await getT();
  const { data: ok } = await supabase.rpc('can_manage_course', { p_course_id: id });
  if (!ok) notFound();
  const [{ data: course }, { data: quizzes }, { data: questions }, { data: keys }, { data: assignments }, { data: submissions }] = await Promise.all([
    supabase.from('courses').select('title').eq('id', id).single(),
    supabase.from('quizzes').select('id, title, pass_percent, is_published, duration_minutes, question_time_seconds, attempts_limit, shuffle_questions, shuffle_options, available_from, available_until').eq('course_id', id).order('created_at'),
    supabase.from('questions').select('id, quiz_id, prompt, options, position').order('position'),
    supabase.from('question_keys').select('question_id, correct_option_id'),
    supabase.from('assignments').select('id, title, max_score, is_published, due_at, duration_minutes, available_from, available_until, allow_late_submission').eq('course_id', id).order('created_at'),
    supabase.from('submissions').select('id, assignment_id, user_id, content, score, feedback').order('submitted_at', { ascending: false }),
  ]);
  // Instructors cannot read other users' profiles via RLS; names of this course's own submitters are fetched after the can_manage_course check above.
  const names = new Map<string, string>();
  if (submissions?.length) {
    const { data: ps } = await createAdminClient().from('profiles').select('id, full_name').in('id', [...new Set(submissions.map((x) => x.user_id))]);
    ps?.forEach((p) => names.set(p.id, p.full_name));
  }
  const keyOf = (qid: string) => keys?.find((k) => k.question_id === qid)?.correct_option_id;

  return (
    <div className="space-y-8">
      <Link href={`/instructor/courses/${id}`} className="text-sm text-primary underline">← {course?.title}</Link>
      <h1 className="text-3xl">{t('instr.assessments')}</h1>

      <section className="space-y-4"><h2 className="text-2xl">{t('learn.quizzes')}</h2>
        {quizzes?.map((q) => (
          <Card key={q.id}>
            <CardHeader className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-medium">{q.title}</h3><Badge tone={q.is_published ? 'success' : 'neutral'}>{q.is_published ? t('instr.published') : t('status.draft')}</Badge>
              <span className="text-sm text-muted-foreground">{t('quiz.pass_mark', { n: q.pass_percent })}</span><span className="text-xs text-muted-foreground">{q.duration_minutes ? `المدة: ${q.duration_minutes} دقيقة` : 'بلا حد زمني'}{q.question_time_seconds ? ` · لكل سؤال ${q.question_time_seconds} ثانية` : ''}</span>
              <span className="ms-auto flex gap-2">
                <form action={toggleQuizPublishAction.bind(null, id, q.id, !q.is_published)}><Button size="sm" variant="outline">{q.is_published ? t('instr.unpublish') : t('instr.publish')}</Button></form>
                <form action={deleteQuizAction.bind(null, id, q.id)}><ConfirmSubmit size="sm" variant="ghost" message={t('instr.confirm_delete')}>{t('action.delete')}</ConfirmSubmit></form>
              </span>
            </CardHeader>
            <CardBody className="space-y-3">
              <ol className="space-y-2 text-sm">
                {questions?.filter((x) => x.quiz_id === q.id).map((x) => (
                  <li key={x.id} className="rounded border border-border p-3">
                    <div className="flex gap-2"><p className="font-medium">{x.prompt}</p><form action={deleteQuestionAction.bind(null, id, x.id)} className="ms-auto"><ConfirmSubmit size="sm" variant="ghost" message={t('instr.confirm_delete')}>{t('action.delete')}</ConfirmSubmit></form></div>
                    <ul className="mt-1 list-disc ps-5">{(x.options as any[]).map((o) => <li key={o.id} className={keyOf(x.id) === o.id ? 'font-semibold text-success' : ''}>{o.text}</li>)}</ul>
                  </li>
                ))}
              </ol>
              <details><summary className="cursor-pointer text-sm font-medium text-primary">{t('instr.add_question')}</summary>
                <ActionForm action={addQuestionAction.bind(null, id, q.id)} submitLabel={t('instr.add_question')} resetOnSuccess className="mt-3 space-y-3">
                  <Field label={t('instr.question')} htmlFor={`p-${q.id}`}><Input id={`p-${q.id}`} name="prompt" required maxLength={1000} /></Field>
                  <div className="grid gap-2 sm:grid-cols-2">{[1, 2, 3, 4].map((n) => <Input key={n} name={`option${n}`} placeholder={`${t('instr.option')} ${n}${n > 2 ? ` (${t('instr.optional')})` : ''}`} aria-label={`${t('instr.option')} ${n}`} required={n <= 2} maxLength={300} />)}</div>
                  <Field label={t('instr.correct')} htmlFor={`c-${q.id}`}><Select id={`c-${q.id}`} name="correct">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{t('instr.option')} {n}</option>)}</Select></Field>
                  <Field label={t('instr.explanation')} htmlFor={`e-${q.id}`}><Input id={`e-${q.id}`} name="explanation" maxLength={1000} /></Field>
                </ActionForm>
              </details>
            </CardBody>
          </Card>
        ))}
        <Card><CardBody><ActionForm action={createQuizAction.bind(null, id)} submitLabel={t('instr.add_quiz')} resetOnSuccess className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1"><Field label={t('instr.quiz_title')} htmlFor="qt"><Input id="qt" name="title" required maxLength={160} /></Field></div>
          <div className="w-32"><Field label={t('instr.pass_percent')} htmlFor="pp"><Input id="pp" name="passPercent" type="number" min="1" max="100" defaultValue="70" required /></Field></div>
          <div className="w-36"><Field label="مدة الامتحان (دقيقة)" htmlFor="qd"><Input id="qd" name="durationMinutes" type="number" min="1" max="600" placeholder="اختياري" /></Field></div>
          <div className="w-36"><Field label="وقت السؤال (ثانية)" htmlFor="qts"><Input id="qts" name="questionTimeSeconds" type="number" min="5" max="3600" placeholder="اختياري" /></Field></div>
          <div className="w-32"><Field label="عدد المحاولات" htmlFor="qal"><Input id="qal" name="attemptsLimit" type="number" min="1" max="100" placeholder="غير محدود" /></Field></div>
          <Field label="إتاحة من" htmlFor="qfrom"><Input id="qfrom" name="availableFrom" type="datetime-local" /></Field><Field label="إتاحة حتى" htmlFor="quntil"><Input id="quntil" name="availableUntil" type="datetime-local" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shuffleQuestions" />ترتيب عشوائي للأسئلة</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shuffleOptions" />ترتيب عشوائي للاختيارات</label>
        </ActionForm></CardBody></Card>
      </section>

      <section className="space-y-4"><h2 className="text-2xl">{t('learn.assignments')}</h2>
        {assignments?.map((a) => (
          <Card key={a.id}>
            <CardHeader className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-medium">{a.title}</h3><Badge tone={a.is_published ? 'success' : 'neutral'}>{a.is_published ? t('instr.published') : t('status.draft')}</Badge>
              <span className="text-xs text-muted-foreground">{a.duration_minutes ? `المدة: ${a.duration_minutes} دقيقة` : 'بلا حد زمني'}{a.due_at ? ` · آخر موعد: ${new Date(a.due_at).toLocaleString()}` : ''}</span><span className="ms-auto flex gap-2">
                <form action={toggleAssignmentPublishAction.bind(null, id, a.id, !a.is_published)}><Button size="sm" variant="outline">{a.is_published ? t('instr.unpublish') : t('instr.publish')}</Button></form>
                <form action={deleteAssignmentAction.bind(null, id, a.id)}><ConfirmSubmit size="sm" variant="ghost" message={t('instr.confirm_delete')}>{t('action.delete')}</ConfirmSubmit></form>
              </span>
            </CardHeader>
            <CardBody className="space-y-3">
              {submissions?.filter((s) => s.assignment_id === a.id).map((s) => (
                <div key={s.id} className="rounded border border-border p-3 text-sm">
                  <p className="font-medium">{names.get(s.user_id)}</p>
                  <p className="mt-1 whitespace-pre-wrap">{s.content}</p>
                  <ActionForm action={gradeSubmissionAction.bind(null, id, s.id)} submitLabel={t('instr.grade')} className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="w-28"><Input name="score" type="number" min="0" max={a.max_score} defaultValue={s.score ?? ''} aria-label={t('instr.score')} required /></div>
                    <div className="min-w-48 flex-1"><Input name="feedback" defaultValue={s.feedback ?? ''} placeholder={t('instr.feedback')} aria-label={t('instr.feedback')} maxLength={5000} /></div>
                  </ActionForm>
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
        <Card><CardBody><ActionForm action={createAssignmentAction.bind(null, id)} submitLabel={t('instr.add_assignment')} resetOnSuccess>
          <Field label={t('instr.quiz_title')} htmlFor="at"><Input id="at" name="title" required maxLength={160} /></Field>
          <Field label={t('assignment.instructions')} htmlFor="ai"><Textarea id="ai" name="instructions" maxLength={10000} /></Field>
          <div className="w-32"><Field label={t('instr.max_score')} htmlFor="ms"><Input id="ms" name="maxScore" type="number" min="1" defaultValue="100" required /></Field></div>
          <Field label="آخر موعد للتسليم" htmlFor="dueAt"><Input id="dueAt" name="dueAt" type="datetime-local" /></Field><Field label="مدة الحل (دقيقة)" htmlFor="ad"><Input id="ad" name="durationMinutes" type="number" min="1" max="10080" placeholder="اختياري" /></Field>
          <Field label="إتاحة من" htmlFor="af"><Input id="af" name="availableFrom" type="datetime-local" /></Field><Field label="إتاحة حتى" htmlFor="au"><Input id="au" name="availableUntil" type="datetime-local" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowLateSubmission" defaultChecked />السماح بالتسليم المتأخر</label>
        </ActionForm></CardBody></Card>
      </section>
    </div>
  );
}
