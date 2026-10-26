import { z } from 'zod';
import { ApiError, handle, json, readJson, requireApiUser } from '@/lib/api';
import { playbackSchema } from '@/lib/validation';
import { issuePlayback } from '@/lib/media';

type Ctx = { params: Promise<{ lessonId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { lessonId } = await params;
  if (!z.string().uuid().safeParse(lessonId).success) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');
  const ctx = await requireApiUser();
  const { sessionId } = playbackSchema.parse(await readJson(req));
  return json(await issuePlayback(ctx, lessonId, sessionId, req.headers));
});
