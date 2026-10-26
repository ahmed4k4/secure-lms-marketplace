'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { instructorProfileSchema, parseForm, profileSchema, type ActionState } from '@/lib/validation';
import { ok } from './helpers';

export async function updateProfileAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser('/account');
  const { t } = await getT();
  const p = parseForm(profileSchema, formData);
  if (!p.ok) return { error: t('err.invalid_input') };
  const { error } = await supabase.from('profiles').update({ full_name: p.data.fullName, locale: p.data.locale }).eq('id', user.id);
  if (error) return { error: t('err.generic') };
  revalidatePath('/', 'layout');
  return ok('msg.saved');
}

export async function updateInstructorProfileAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser('/account');
  const { t } = await getT();
  const p = parseForm(instructorProfileSchema, formData);
  if (!p.ok) return { error: t('err.invalid_input') };
  const { data, error } = await supabase
    .from('instructor_profiles')
    .update({ headline: p.data.headline ?? null, bio: p.data.bio ?? null, website: p.data.website ?? null })
    .eq('user_id', user.id)
    .select('user_id');
  if (error || !data?.length) return { error: t('err.generic') };
  revalidatePath(`/instructors/${user.id}`);
  return ok('msg.saved');
}

export async function markNotificationsReadAction() {
  const { supabase, user } = await requireUser('/notifications');
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}
