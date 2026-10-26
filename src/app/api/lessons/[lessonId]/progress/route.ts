import { z } from 'zod';
import { ApiError, handle, json, readJson, requireApiUser } from '@/lib/api';
import { progressSchema } from '@/lib/validation';
import { createAdminClient } from '@/lib/supabase/admin';
import { enforceRateLimit } from '@/lib/rate-limit';

type Ctx = { params: Promise<{ lessonId: string }> };

/** Saves resume position / completion. Row Level Security re-verifies access on every write, so revoked users stop here. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { lessonId } = await params;
  if (!z.string().uuid().safeParse(lessonId).success) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');
  const { supabase, user } = await requireApiUser();
  await enforceRateLimit(`progress:${user.id}`, 60, 20);
  const body = progressSchema.parse(await readJson(req));

  const { data: existing } = await supabase.from('lesson_progress').select('completed').eq('user_id', user.id).eq('lesson_id', lessonId).maybeSingle();
  if (existing) {
    const patch: Record<string, unknown> = { position_seconds: body.positionSeconds };
    if (body.completed && !existing.completed) Object.assign(patch, { completed: true, completed_at: new Date().toISOString() });
    const { data, error } = await supabase.from('lesson_progress').update(patch).eq('user_id', user.id).eq('lesson_id', lessonId).select('lesson_id');
    if (error || !data?.length) throw new ApiError(403, 'NO_ACCESS', 'Access to this lesson was revoked.');
  } else {
    const { error } = await supabase.from('lesson_progress').insert({
      user_id: user.id, lesson_id: lessonId, position_seconds: body.positionSeconds,
      ...(body.completed ? { completed: true, completed_at: new Date().toISOString() } : {}),
    });
    if (error) throw new ApiError(403, 'NO_ACCESS', 'You do not have access to this lesson.');
  }
  if (body.sessionId) {
    // Heartbeat for the concurrent-stream limiter.
    await createAdminClient().from('playback_sessions').update({ last_seen_at: new Date().toISOString() }).eq('session_id', body.sessionId).eq('user_id', user.id);
  }
  return json({ ok: true });
});
