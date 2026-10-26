import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Users created before the migrations ran (or by the Auth dashboard) can lack a profile row.
 * This creates the same rows the signup trigger would have created (student role only).
 */
async function ensureProfile(user: User) {
  try {
    const admin = createAdminClient();
    await admin.from('profiles').upsert(
      { id: user.id, full_name: String(user.user_metadata?.full_name ?? '').slice(0, 120), locale: user.user_metadata?.locale === 'ar' ? 'ar' : 'en' },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    const { data: existingRole } = await admin.from('user_roles').select('role_id').eq('user_id', user.id).limit(1).maybeSingle();
    const { data: role } = await admin.from('roles').select('id').eq('key', 'student').maybeSingle();
    if (!existingRole && role) await admin.from('user_roles').insert({ user_id: user.id, role_id: role.id });
  } catch (e) {
    console.error('[auth] ensureProfile failed', (e as Error).message);
  }
}

export const getAuth = cache(async () => {
  const supabase = await createClient();
  let user: User | null = null;
  try {
    user = (await supabase.auth.getUser()).data.user;
  } catch {
    /* network failure => anonymous */
  }
  if (!user) return { supabase, user: null, profile: null, roles: [] as string[] };
  const load = () =>
    Promise.all([
      supabase.from('profiles').select('id, full_name, avatar_url, locale, status').eq('id', user!.id).maybeSingle(),
      supabase.from('user_roles').select('roles(key)').eq('user_id', user!.id),
    ]);
  let [{ data: profile }, { data: roleRows }] = await load();
  if (!profile) {
    await ensureProfile(user);
    [{ data: profile }, { data: roleRows }] = await load();
  }
  const roles = (roleRows ?? [])
    .map((r: any) => (Array.isArray(r.roles) ? r.roles[0]?.key : r.roles?.key))
    .filter(Boolean) as string[];
  return { supabase, user, profile, roles };
});

export const isAdminRole = (roles: string[]) => roles.includes('admin') || roles.includes('super_admin');

export async function requireUser(next = '/dashboard') {
  const ctx = await getAuth();
  if (!ctx.user || !ctx.profile) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (ctx.profile.status !== 'active') redirect('/suspended');
  return { ...ctx, user: ctx.user, profile: ctx.profile };
}

export async function requireInstructor() {
  const ctx = await requireUser('/instructor');
  if (!ctx.roles.includes('instructor') && !isAdminRole(ctx.roles)) redirect('/dashboard');
  // Suspended instructors must not retain write access just because their platform role remains assigned.
  // Admin roles are handled by granular permissions and do not need an instructor profile.
  if (ctx.roles.includes('instructor') && !isAdminRole(ctx.roles)) {
    const { data: instructor } = await ctx.supabase
      .from('instructor_profiles')
      .select('status')
      .eq('user_id', ctx.user.id)
      .maybeSingle();
    if (instructor?.status !== 'active') redirect('/suspended?reason=instructor');
  }
  return ctx;
}

/** Admin gate: authenticated account + a specific permission verified by Postgres. MFA is intentionally not part of this product. */
export async function requirePermission(perm: string) {
  const ctx = await requireUser('/admin');
  const { data: ok } = await ctx.supabase.rpc('has_permission', { p_perm: perm });
  if (!ok) redirect('/dashboard');
  // The service-role client is only handed out AFTER the permission above was verified.
  return { ...ctx, admin: createAdminClient() };
}

export async function requireAnyAdmin() {
  const ctx = await requireUser('/admin');
  if (!isAdminRole(ctx.roles)) redirect('/dashboard');
  return ctx;
}
