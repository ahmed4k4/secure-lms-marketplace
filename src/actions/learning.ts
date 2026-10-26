'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { parseForm, reviewSchema, submissionSchema, type ActionState } from '@/lib/validation';
import { fail, ok } from './helpers';

export async function enrollFreeAction(courseId: string, slug: string): Promise<void> {
  const { supabase } = await requireUser(`/courses/${slug}`);
  const { error } = await supabase.rpc('enroll_free_course', { p_course_id: courseId });
  if (error) redirect(`/courses/${slug}?error=enroll`);
  revalidatePath('/dashboard');
  redirect(`/learn/${slug}`);
}

export async function reviewAction(courseId: string, slug: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser(`/courses/${slug}`);
  const p = parseForm(reviewSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const { data: existing } = await supabase.from('reviews').select('id').eq('course_id', courseId).eq('user_id', user.id).maybeSingle();
  const { error } = existing
    ? await supabase.from('reviews').update({ rating: p.data.rating, comment: p.data.comment ?? null }).eq('id', existing.id)
    : await supabase.from('reviews').insert({ course_id: courseId, user_id: user.id, rating: p.data.rating, comment: p.data.comment ?? null });
  if (error) return fail('err.forbidden');
  revalidatePath(`/courses/${slug}`);
  return ok('msg.saved');
}

export async function submitAssignmentAction(assignmentId: string, slug: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser(`/learn/${slug}`);
  const p = parseForm(submissionSchema, formData);
  if (!p.ok) return fail('err.invalid_input');
  const { data: existing } = await supabase.from('submissions').select('id, score').eq('assignment_id', assignmentId).eq('user_id', user.id).maybeSingle();
  if (existing?.score != null) return fail('assignment.locked');
  const { data, error } = existing
    ? await supabase.from('submissions').update({ content: p.data.content }).eq('id', existing.id).select('id')
    : await supabase.from('submissions').insert({ assignment_id: assignmentId, user_id: user.id, content: p.data.content }).select('id');
  if (error || !data?.length) return fail('err.forbidden');
  revalidatePath(`/learn/${slug}`);
  return ok('msg.saved');
}

export async function toggleCompleteAction(lessonId: string, slug: string, completed: boolean): Promise<void> {
  const { supabase, user } = await requireUser(`/learn/${slug}`);
  const patch = { completed, completed_at: completed ? new Date().toISOString() : null };
  const { data: existing } = await supabase.from('lesson_progress').select('lesson_id').eq('user_id', user.id).eq('lesson_id', lessonId).maybeSingle();
  if (existing) await supabase.from('lesson_progress').update(patch).eq('user_id', user.id).eq('lesson_id', lessonId);
  else await supabase.from('lesson_progress').insert({ user_id: user.id, lesson_id: lessonId, ...patch });
  revalidatePath(`/learn/${slug}`, 'layout');
}

export async function issueCertificateAction(courseId: string, slug: string): Promise<void> {
  const { supabase } = await requireUser(`/learn/${slug}`);
  const { data, error } = await supabase.rpc('issue_certificate', { p_course_id: courseId });
  if (error || !data) redirect(`/learn/${slug}?error=incomplete`);
  redirect(`/certificates/${data}`);
}
