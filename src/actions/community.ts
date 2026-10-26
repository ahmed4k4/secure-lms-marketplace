'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { noteSchema, parseForm, questionPostSchema, replySchema, type ActionState } from '@/lib/validation';
import { fail, ok } from './helpers';

// Every write uses the user-scoped client: RLS decides who may post (enrolled students, course managers).

async function limited(userId: string, bucket: string, max: number, windowSeconds = 300) {
  try { return !(await rateLimit(`${bucket}:${userId}`, windowSeconds, max)); } catch { return false; }
}

async function ownersOf(courseId: string) {
  const { data } = await createAdminClient().from('course_instructors').select('instructor_id').eq('course_id', courseId);
  return (data ?? []).map((r) => r.instructor_id as string);
}

export async function postQuestionAction(courseId: string, lessonId: string | null, path: string, link: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser(path);
  const p = parseForm(questionPostSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  if (await limited(user.id, 'qa', 8)) return fail('err.rate_limited');
  const { data, error } = await supabase.from('discussions')
    .insert({ course_id: courseId, lesson_id: lessonId, user_id: user.id, title: p.data.title, body: p.data.body }).select('id').single();
  if (error || !data) return fail('err.forbidden');
  const admin = createAdminClient();
  const owners = (await ownersOf(courseId)).filter((id) => id !== user.id);
  if (owners.length) await admin.from('notifications').insert(owners.map((id) => ({ user_id: id, type: 'new_question', title: p.data.title, body: p.data.body.slice(0, 200), link })));
  revalidatePath(path);
  return ok('msg.sent');
}

export async function replyAction(discussionId: string, path: string, link: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser(path);
  const p = parseForm(replySchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  if (await limited(user.id, 'reply', 15)) return fail('err.rate_limited');
  const { error } = await supabase.from('discussion_replies').insert({ discussion_id: discussionId, user_id: user.id, body: p.data.body });
  if (error) return fail('err.forbidden');
  const { data: d } = await supabase.from('discussions').select('user_id, title').eq('id', discussionId).maybeSingle();
  if (d && d.user_id !== user.id) {
    await createAdminClient().from('notifications').insert({ user_id: d.user_id, type: 'new_reply', title: d.title, body: p.data.body.slice(0, 200), link });
  }
  revalidatePath(path);
  return ok('msg.sent');
}

export async function resolveDiscussionAction(discussionId: string, resolved: boolean, path: string): Promise<void> {
  const { supabase } = await requireUser(path);
  await supabase.from('discussions').update({ is_resolved: resolved }).eq('id', discussionId);
  revalidatePath(path);
}

export async function deleteDiscussionAction(discussionId: string, path: string): Promise<void> {
  const { supabase, user } = await requireUser(path);
  const { data } = await supabase.from('discussions').delete().eq('id', discussionId).select('id, course_id');
  if (data?.length) await audit({ actorId: user.id, action: 'discussion.deleted', entityType: 'discussion', entityId: discussionId });
  revalidatePath(path);
}

export async function deleteReplyAction(replyId: string, path: string): Promise<void> {
  const { supabase } = await requireUser(path);
  await supabase.from('discussion_replies').delete().eq('id', replyId);
  revalidatePath(path);
}

export async function addNoteAction(lessonId: string, path: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser(path);
  const p = parseForm(noteSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  if (await limited(user.id, 'note', 30)) return fail('err.rate_limited');
  const { error } = await supabase.from('lesson_notes').insert({ lesson_id: lessonId, user_id: user.id, position_seconds: p.data.positionSeconds, body: p.data.body });
  if (error) return fail('err.forbidden');
  revalidatePath(path);
  return { ok: true };
}

export async function deleteNoteAction(noteId: string, path: string): Promise<void> {
  const { supabase } = await requireUser(path);
  await supabase.from('lesson_notes').delete().eq('id', noteId);
  revalidatePath(path);
}
