import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { requireInstructor } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import {
  addLessonAction, addSectionAction, deleteCourseAction, deleteSectionAction, moveAction, renameSectionAction,
  submitForReviewAction, updateCourseAction, updatePricingAction, withdrawReviewAction,
} from '@/actions/instructor';
import { ActionForm, Field } from '@/components/action-form';
import { ConfirmSubmit } from '@/components/form-bits';
import { CourseFields } from '@/components/course-fields';
import { Alert, Badge, Card, CardBody, CardHeader, Input, Select } from '@/components/ui/primitives';
import { Button, buttonVariants } from '@/components/ui/button';
import { CURRENCIES } from '@/lib/validation';
import { cn } from '@/lib/utils';

type P = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function CourseEditor({ params, searchParams }: P) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const { supabase } = await requireInstructor();
  const { t, locale } = await getT();
  const { data: canManage } = await supabase.rpc('can_manage_course', { p_course_id: id });
  if (!canManage) notFound();
  const { data: course } = await supabase.from('courses').select('*').eq('id', id).maybeSingle();
  if (!course) notFound();

  const [{ data: categories }, { data: sections }, { data: plan }, { data: videos }] = await Promise.all([
    supabase.from('categories').select('id, name_en, name_ar').order('position'),
    supabase.from('sections').select('id, title, position, lessons(id, title, type, position, is_free_preview)').eq('course_id', id).order('position'),
    supabase.from('products').select('pricing_plans(amount_cents, currency, access_days, active, kind, billing_interval)').eq('course_id', id).maybeSingle(),
    supabase.from('lesson_videos').select('lesson_id, status'),
  ]);
  const activePlan = ((plan?.pricing_plans ?? []) as any[]).find((p) => p.active);
  const videoStatus = new Map((videos ?? []).map((v) => [v.lesson_id, v.status]));
  const editable = true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">{course.title}</h1>
        <Badge tone={course.status === 'published' ? 'success' : ['in_review', 'category_pending'].includes(course.status) ? 'warn' : 'neutral'}>{t(`status.${course.status}` as never)}</Badge>
        <div className="ms-auto flex flex-wrap gap-2">
          <Link href={`/instructor/courses/${id}/students`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>{t('instr.students')}</Link>
          <Link href={`/instructor/courses/${id}/questions`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>{t('instr.questions')}</Link>
          <Link href={`/instructor/courses/${id}/assessments`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>{t('instr.assessments')}</Link>
          <Link href={`/learn/${course.slug}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>{t('course.preview_as_learner')}</Link>
        </div>
      </div>

      {course.rejection_reason && ['rejected', 'suspended'].includes(course.status) && <Alert tone="error"><strong>{t('instr.reason')}:</strong> {course.rejection_reason}</Alert>}
      {sp.error === 'empty' && <Alert tone="warn">{t('instr.need_lessons')}</Alert>}
      {sp.error === 'category' && <Alert tone="warn">{t('course.new_category_hint')}</Alert>}

      {course.status === 'category_pending' && <Alert tone="warn">{t('instr.category_pending_note')}</Alert>}
      <Card><CardHeader><h2 className="text-lg">{t('instr.publishing')}</h2></CardHeader><CardBody className="flex flex-wrap items-center gap-3">
        {['draft', 'rejected'].includes(course.status) && <form action={submitForReviewAction.bind(null, id)}><Button variant="accent">{t('instr.submit_review')}</Button></form>}
        {course.status === 'in_review' && <><p className="text-sm">{t('instr.in_review_note')}</p><form action={withdrawReviewAction.bind(null, id)}><Button variant="outline">{t('instr.withdraw')}</Button></form></>}
        {course.status === 'published' && <p className="text-sm">{t('instr.live_note')}</p>}
        {course.status === 'draft' && <form action={deleteCourseAction.bind(null, id)} className="ms-auto"><ConfirmSubmit variant="destructive" size="sm" message={t('instr.confirm_delete_course')}>{t('instr.delete_course')}</ConfirmSubmit></form>}
      </CardBody></Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><h2 className="text-lg">{t('instr.details')}</h2></CardHeader><CardBody>
          <ActionForm action={updateCourseAction.bind(null, id)} submitLabel={t('action.save')}>
            <CourseFields course={course} categories={categories ?? []} locale={locale} t={t} />
          </ActionForm>
        </CardBody></Card>

        <Card className="self-start"><CardHeader><h2 className="text-lg">{t('instr.pricing')}</h2></CardHeader><CardBody>
          <Alert tone="info" className="mb-4">{t('instr.pricing_note')}</Alert>
          <ActionForm action={updatePricingAction.bind(null, id)} submitLabel={t('action.save')}>
            <Field label={t('instr.access_type')} htmlFor="planModel">
              <Select id="planModel" name="planModel" defaultValue={activePlan?.kind === 'subscription' ? (activePlan.billing_interval === 'year' ? 'yearly' : 'monthly') : activePlan?.kind === 'free' || course.access_type === 'free' ? 'free' : 'one_time'}>
                <option value="free">{t('course.free')}</option>
                <option value="one_time">{t('instr.one_time')}</option>
                <option value="monthly">{t('instr.monthly')}</option>
                <option value="yearly">{t('instr.yearly')}</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('instr.amount')} htmlFor="amount"><Input id="amount" name="amount" type="number" min="1" step="0.01" defaultValue={activePlan?.kind !== 'free' && activePlan?.amount_cents ? activePlan.amount_cents / 100 : ''} /></Field>
              <Field label={t('instr.currency')} htmlFor="currency"><Select id="currency" name="currency" defaultValue={activePlan?.currency ?? 'USD'}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            </div>
            <Field label={t('instr.access_days')} htmlFor="accessDays" hint={t('instr.access_days_hint')}><Input id="accessDays" name="accessDays" type="number" min="1" defaultValue={activePlan?.kind === 'one_time' ? activePlan.access_days ?? '' : ''} /></Field>
          </ActionForm>
        </CardBody></Card>
      </div>

      <section aria-labelledby="curr" className="space-y-3">
        <h2 id="curr" className="text-2xl">{t('course.curriculum')}</h2>
        {(sections ?? []).map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-wrap items-center gap-2">
              <form action={renameSectionAction.bind(null, id, s.id)} className="flex flex-1 gap-2">
                <Input name="title" defaultValue={s.title} aria-label={t('instr.section_title')} maxLength={140} required />
                <Button variant="outline" size="sm">{t('action.save')}</Button>
              </form>
              <form action={moveAction.bind(null, id, 'section', s.id, 'up')}><Button variant="ghost" size="icon" aria-label={t('action.move_up')}><ArrowUp className="h-4 w-4" /></Button></form>
              <form action={moveAction.bind(null, id, 'section', s.id, 'down')}><Button variant="ghost" size="icon" aria-label={t('action.move_down')}><ArrowDown className="h-4 w-4" /></Button></form>
              <form action={deleteSectionAction.bind(null, id, s.id)}><ConfirmSubmit variant="ghost" size="sm" message={t('instr.confirm_delete_section')}>{t('action.delete')}</ConfirmSubmit></form>
            </CardHeader>
            <CardBody className="space-y-3">
              <ul className="divide-y divide-border">
                {[...(s.lessons as any[])].sort((a, b) => a.position - b.position).map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link className="font-medium text-primary hover:underline" href={`/instructor/courses/${id}/lessons/${l.id}`}>{l.title}</Link>
                    <Badge>{t(`lesson.${l.type}` as never)}</Badge>
                    {l.is_free_preview && <Badge tone="brand">{t('course.preview')}</Badge>}
                    {l.type === 'video' && <Badge tone={videoStatus.get(l.id) === 'ready' ? 'success' : 'warn'}>{videoStatus.get(l.id) === 'ready' ? t('lesson.video_ready') : t('lesson.video_missing')}</Badge>}
                    <span className="ms-auto flex gap-1">
                      <form action={moveAction.bind(null, id, 'lesson', l.id, 'up')}><Button variant="ghost" size="icon" aria-label={t('action.move_up')}><ArrowUp className="h-4 w-4" /></Button></form>
                      <form action={moveAction.bind(null, id, 'lesson', l.id, 'down')}><Button variant="ghost" size="icon" aria-label={t('action.move_down')}><ArrowDown className="h-4 w-4" /></Button></form>
                    </span>
                  </li>
                ))}
              </ul>
              <ActionForm action={addLessonAction.bind(null, id, s.id)} submitLabel={t('instr.add_lesson')} variant="outline" resetOnSuccess className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1"><Input name="title" placeholder={t('instr.lesson_title')} aria-label={t('instr.lesson_title')} required maxLength={140} /></div>
                <Select name="type" className="w-32" aria-label={t('instr.lesson_type')}><option value="video">{t('lesson.video')}</option><option value="text">{t('lesson.text')}</option></Select>
              </ActionForm>
            </CardBody>
          </Card>
        ))}
        {editable && (
          <ActionForm action={addSectionAction.bind(null, id)} submitLabel={t('instr.add_section')} resetOnSuccess className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1"><Input name="title" placeholder={t('instr.section_title')} aria-label={t('instr.section_title')} required maxLength={140} /></div>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
