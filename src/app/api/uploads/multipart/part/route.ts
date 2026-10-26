import { z } from 'zod';
import { ApiError, handle, json, readJson, requireApiUser } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { presignUploadPart } from '@/lib/r2';

const schema = z.object({ lessonId: z.string().uuid(), sessionId: z.string().uuid(), partNumber: z.number().int().min(1).max(10000) });
export const POST = handle(async (req) => {
  const ctx = await requireApiUser();
  const input = schema.parse(await readJson(req));
  const lesson = await ctx.supabase.from('lessons').select('id,course_id').eq('id', input.lessonId).maybeSingle();
  if (!lesson.data) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');
  const { data: allowed } = await ctx.supabase.rpc('can_manage_course', { p_course_id: lesson.data.course_id });
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot manage this course.');
  const admin = createAdminClient();
  const { data: session } = await admin.from('video_upload_sessions').select('id,object_key,r2_upload_id,expected_size,status,expires_at')
    .eq('id', input.sessionId).eq('lesson_id', input.lessonId).eq('created_by', ctx.user.id).maybeSingle();
  if (!session || session.status !== 'uploading' || Date.parse(session.expires_at) <= Date.now()) throw new ApiError(410, 'UPLOAD_SESSION_EXPIRED', 'Upload session expired. Start the upload again.');
  const partSize = 64 * 1024 * 1024;
  const parts = Math.ceil(Number(session.expected_size) / partSize);
  if (input.partNumber > parts) throw new ApiError(400, 'INVALID_PART', 'Part number is outside the upload range.');
  const url = await presignUploadPart({ key: session.object_key, uploadId: session.r2_upload_id, partNumber: input.partNumber, expiresIn: 900 });
  return json({ url, partNumber: input.partNumber, expiresInSeconds: 900 });
});
