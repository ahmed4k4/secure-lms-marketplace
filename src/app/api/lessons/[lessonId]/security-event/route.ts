import { z } from 'zod';
import { ApiError, handle, json, readJson, requireApiUser } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { enforceRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';

const schema = z.object({
  sessionId: z.string().regex(/^[a-f0-9]{32}$/i),
  eventType: z.enum(['print_screen_key','print_dialog_shortcut','capture_shortcut','tab_hidden','fullscreen_exit','picture_in_picture_attempt','copy_attempt']),
  details: z.record(z.string(), z.union([z.string().max(120), z.number(), z.boolean()])).optional(),
});
type Context = { params: Promise<{ lessonId: string }> };
export const POST = handle<Context>(async (req, { params }) => {
  const { lessonId } = await params;
  if (!z.string().uuid().safeParse(lessonId).success) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');
  const ctx = await requireApiUser();
  await enforceRateLimit(`playback-event:${ctx.user.id}`, 60, 12);
  const body = schema.parse(await readJson(req));
  const { data: allowed } = await ctx.supabase.rpc('can_access_lesson', { p_lesson_id: lessonId });
  if (!allowed) throw new ApiError(403, 'NO_ACCESS', 'Course access is no longer available.');
  const admin = createAdminClient();
  const { data: session } = await admin.from('playback_sessions').select('session_id').eq('session_id', body.sessionId).eq('lesson_id', lessonId).eq('user_id', ctx.user.id).maybeSingle();
  if (!session) throw new ApiError(403, 'PLAYBACK_SESSION_INVALID', 'Playback session expired.');
  const { error } = await admin.from('playback_security_events').insert({
    user_id: ctx.user.id, lesson_id: lessonId, session_id: body.sessionId, event_type: body.eventType, details: body.details ?? {},
  });
  if (error) throw new ApiError(500, 'SECURITY_EVENT_SAVE_FAILED', 'Could not log the playback event.');
  await audit({ actorId: ctx.user.id, action: `playback.${body.eventType}`, entityType: 'lesson', entityId: lessonId, metadata: body.details ?? {} });
  return json({ ok: true });
});
