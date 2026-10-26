import { z } from 'zod';
import { ApiError, handle, json, readJson, requireApiUser } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { abortMultipartUpload } from '@/lib/r2';

const schema = z.object({ lessonId: z.string().uuid(), sessionId: z.string().uuid() });
export const POST = handle(async (req) => {
  const ctx = await requireApiUser();
  const input = schema.parse(await readJson(req));
  const { data: lesson } = await ctx.supabase.from('lessons').select('id,course_id').eq('id', input.lessonId).maybeSingle();
  if (!lesson) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');
  const { data: allowed } = await ctx.supabase.rpc('can_manage_course', { p_course_id: lesson.course_id });
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot manage this course.');
  const admin = createAdminClient();
  const { data: session } = await admin.from('video_upload_sessions').select('id,object_key,r2_upload_id,status').eq('id', input.sessionId).eq('lesson_id', input.lessonId).eq('created_by', ctx.user.id).maybeSingle();
  if (!session) throw new ApiError(404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found.');
  if (session.status !== 'uploading') return json({ ok: true, alreadyFinalized: true });
  try {
    await abortMultipartUpload(session.object_key, session.r2_upload_id);
  } catch (error) {
    // R2 might already have expired this upload; keep database cleanup idempotent and configure the bucket lifecycle as a fallback.
    console.warn('[multipart:abort]', error instanceof Error ? error.message : 'R2 abort failed');
  }
  await admin.from('video_upload_sessions').update({ status: 'aborted' }).eq('id', session.id).eq('status', 'uploading');
  await admin.from('lesson_videos').update({ status: 'failed', processing_status: 'failed', processing_error: 'Multipart upload was aborted by the uploader.' }).eq('lesson_id', input.lessonId).eq('object_key', session.object_key);
  return json({ ok: true });
}, { csrf: false });
