import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireInstructor } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { deleteLessonAction, deleteResourceAction, updateLessonAction } from '@/actions/instructor';
import { ActionForm, Field } from '@/components/action-form';
import { ConfirmSubmit } from '@/components/form-bits';
import { UploadWidget } from '@/components/upload-widget';
import { Alert, Badge, Card, CardBody, CardHeader, Input, Textarea } from '@/components/ui/primitives';
import { formatBytes, formatDuration } from '@/lib/utils';

export default async function LessonEditor({ params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(lessonId).success) notFound();
  const { supabase } = await requireInstructor();
  const { t } = await getT();
  const { data: canManage } = await supabase.rpc('can_manage_course', { p_course_id: id });
  if (!canManage) notFound();
  const { data: lesson } = await supabase.from('lessons').select('id, title, description, type, is_free_preview, duration_seconds, availability_starts_at, availability_ends_at, max_watch_minutes, watermark_enabled, seek_allowed').eq('id', lessonId).eq('course_id', id).maybeSingle();
  if (!lesson) notFound();
  const [{ data: video }, { data: content }, { data: resources }] = await Promise.all([
    supabase.from('lesson_videos').select('status, size_bytes, content_type, duration_seconds').eq('lesson_id', lessonId).maybeSingle(),
    supabase.from('lesson_contents').select('body').eq('lesson_id', lessonId).maybeSingle(),
    supabase.from('lesson_resources').select('id, title, size_bytes, status').eq('lesson_id', lessonId).order('created_at'),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/instructor/courses/${id}`} className="text-sm text-primary underline">← {t('action.back')}</Link>
      <h1 className="text-3xl">{lesson.title}</h1>

      <Card><CardBody>
        <ActionForm action={updateLessonAction.bind(null, id, lessonId)} submitLabel={t('action.save')}>
          <Field label={t('instr.lesson_title')} htmlFor="title"><Input id="title" name="title" defaultValue={lesson.title} required maxLength={140} /></Field>
          <Field label={t('lesson.description')} htmlFor="description"><Textarea id="description" name="description" defaultValue={lesson.description ?? ''} maxLength={2000} /></Field>
          {lesson.type === 'text' && <Field label={t('lesson.body')} htmlFor="body"><Textarea id="body" name="body" defaultValue={content?.body ?? ''} className="min-h-64" maxLength={100000} /></Field>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFreePreview" defaultChecked={lesson.is_free_preview} />{t('lesson.free_preview')}</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="إتاحة الدرس من (اختياري)" htmlFor="availabilityStartsAt"><Input id="availabilityStartsAt" name="availabilityStartsAt" type="datetime-local" defaultValue={lesson.availability_starts_at ? new Date(lesson.availability_starts_at).toISOString().slice(0,16) : ''} /></Field>
            <Field label="إغلاق الدرس بعد (اختياري)" htmlFor="availabilityEndsAt"><Input id="availabilityEndsAt" name="availabilityEndsAt" type="datetime-local" defaultValue={lesson.availability_ends_at ? new Date(lesson.availability_ends_at).toISOString().slice(0,16) : ''} /></Field>
          </div>
          <p className="text-xs text-muted-foreground">اترك التاريخين فارغين لإتاحة الدرس دون موعد محدد. تعتمد المواعيد على توقيت الخادم.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="watermarkEnabled" defaultChecked={lesson.watermark_enabled ?? true} />إظهار علامة مائية متحركة بمعرّف الطالب أثناء مشاهدة الفيديو</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="seekAllowed" defaultChecked={lesson.seek_allowed ?? true} />السماح بتقديم الفيديو وإرجاعه</label>
        </ActionForm>
      </CardBody></Card>

      {lesson.type === 'video' && (
        <Card><CardHeader><h2 className="text-lg">{t('lesson.video')}</h2></CardHeader><CardBody className="space-y-3">
          <Alert>{t('lesson.video_note')}</Alert>
          {video && <p className="text-sm">{t('lesson.current_video')}: <Badge tone={video.status === 'ready' ? 'success' : 'warn'}>{video.status === 'ready' ? t('lesson.video_ready') : t('lesson.video_pending')}</Badge> {formatBytes(Number(video.size_bytes))} {video.duration_seconds ? `· ${formatDuration(video.duration_seconds)}` : ''}</p>}
          <UploadWidget kind="video" lessonId={lessonId} label={video ? t('lesson.replace_video') : t('lesson.upload_video')} />
        </CardBody></Card>
      )}

      <Card><CardHeader><h2 className="text-lg">{t('learn.resources')}</h2></CardHeader><CardBody className="space-y-3">
        <ul className="divide-y divide-border text-sm">
          {(resources ?? []).map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2">
              <span>{r.title}</span><span className="text-muted-foreground">{formatBytes(Number(r.size_bytes))}</span>
              {r.status !== 'ready' && <Badge tone="warn">{t('lesson.video_pending')}</Badge>}
              <form action={deleteResourceAction.bind(null, id, lessonId, r.id)} className="ms-auto"><ConfirmSubmit variant="ghost" size="sm" message={t('instr.confirm_delete')}>{t('action.delete')}</ConfirmSubmit></form>
            </li>
          ))}
        </ul>
        <UploadWidget kind="resource" lessonId={lessonId} label={t('lesson.add_resource')} />
      </CardBody></Card>

      <form action={deleteLessonAction.bind(null, id, lessonId)}><ConfirmSubmit variant="destructive" size="sm" message={t('instr.confirm_delete')}>{t('instr.delete_lesson')}</ConfirmSubmit></form>
    </div>
  );
}
