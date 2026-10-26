import { z } from 'zod';
import { ApiError, handle, json, readJson, requireApiUser } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { completeMultipartUpload, headObject } from '@/lib/r2';

const schema = z.object({ lessonId: z.string().uuid(), sessionId: z.string().uuid(), parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(1).max(256) })).min(1).max(10000) });
export const POST = handle(async (req) => {
  const ctx = await requireApiUser();
  const input = schema.parse(await readJson(req));
  const lesson = await ctx.supabase.from('lessons').select('id,course_id').eq('id', input.lessonId).maybeSingle();
  if (!lesson.data) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');
  const { data: allowed } = await ctx.supabase.rpc('can_manage_course', { p_course_id: lesson.data.course_id });
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot manage this course.');
  const numbers = input.parts.map((p) => p.partNumber);
  if (new Set(numbers).size !== numbers.length || numbers.some((n, i) => n !== i + 1)) throw new ApiError(400, 'INVALID_PARTS', 'Uploaded parts must be unique and ordered from 1.');
  const admin = createAdminClient();
  const { data: session } = await admin.from('video_upload_sessions').select('*').eq('id', input.sessionId).eq('lesson_id', input.lessonId).eq('created_by', ctx.user.id).maybeSingle();
  if (!session || session.status !== 'uploading' || Date.parse(session.expires_at) <= Date.now()) throw new ApiError(410, 'UPLOAD_SESSION_EXPIRED', 'Upload session expired. Start the upload again.');
  const expectedCount = Math.ceil(Number(session.expected_size) / (64 * 1024 * 1024));
  if (input.parts.length !== expectedCount) throw new ApiError(400, 'MISSING_PARTS', `Expected ${expectedCount} uploaded parts.`);
  await completeMultipartUpload({ key: session.object_key, uploadId: session.r2_upload_id, parts: input.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) });
  const head = await headObject(session.object_key);
  if (head.size !== Number(session.expected_size) || head.contentType !== session.content_type) {
    await admin.from('lesson_videos').update({ status: 'failed', processing_status: 'failed', processing_error: 'Multipart upload size/type mismatch.' }).eq('lesson_id', input.lessonId);
    throw new ApiError(422, 'UPLOAD_VALIDATION_FAILED', 'Uploaded file size or type did not match the original file.');
  }
  await admin.from('video_upload_sessions').update({ status: 'completed' }).eq('id', input.sessionId);
  return json({ ok: true, sizeBytes: head.size });
});
