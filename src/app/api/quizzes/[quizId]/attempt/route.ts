import { z } from 'zod';
import { ApiError, handle, json, readJson, requireApiUser } from '@/lib/api';
import { quizAttemptSchema } from '@/lib/validation';
import { enforceRateLimit } from '@/lib/rate-limit';

type Ctx = { params: Promise<{ quizId: string }> };

/** Grading happens inside Postgres (submit_quiz_attempt); answer keys never reach the browser. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { quizId } = await params;
  if (!z.string().uuid().safeParse(quizId).success) throw new ApiError(404, 'NOT_FOUND', 'Quiz not found.');
  const { supabase, user } = await requireApiUser();
  await enforceRateLimit(`quiz:${user.id}`, 600, 20);
  const { answers } = quizAttemptSchema.parse(await readJson(req));
  const { data, error } = await supabase.rpc('submit_quiz_attempt', { p_quiz_id: quizId, p_answers: answers });
  if (error) {
    if (error.message.includes('quiz_not_found')) throw new ApiError(404, 'NOT_FOUND', 'Quiz not found.');
    if (error.message.includes('quiz_empty')) throw new ApiError(422, 'QUIZ_EMPTY', 'This quiz has no questions.');
    throw new ApiError(403, 'NO_ACCESS', 'You cannot take this quiz.');
  }
  return json(data);
});
