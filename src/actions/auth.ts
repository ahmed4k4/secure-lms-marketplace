'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { parseForm, loginSchema, registerSchema, emailSchema, newPasswordSchema, type ActionState } from '@/lib/validation';
import { getLocale, getT } from '@/lib/i18n';
import { safeNext } from '@/lib/utils';
import { publicEnv } from '@/lib/env';
import { fail, throttle } from './helpers';

async function siteUrl() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  // Prefer the configured URL: it must also be listed in Supabase "Redirect URLs".
  return publicEnv.siteUrl || (host ? `${proto}://${host}` : 'http://localhost:3000');
}


/** Start a provider login. Provider enablement and redirect allow-list are configured in Supabase. */
export async function oauthLoginAction(formData: FormData): Promise<void> {
  const provider = String(formData.get('provider') ?? 'google');
  if (!['google', 'github'].includes(provider)) redirect('/login?error=provider_invalid');
  const supabase = await createClient();
  const next = safeNext(String(formData.get('next') ?? ''));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as 'google' | 'github' | 'azure',
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`, queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined },
  });
  if (error || !data.url) {
    const detail = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
    // Supabase returns this before redirecting when the provider is disabled or misconfigured.
    if (detail.includes('provider is not enabled') || detail.includes('unsupported provider') || detail.includes('provider_disabled')) {
      redirect(`/login?error=${encodeURIComponent(`provider_disabled_${provider}`)}`);
    }
    if (detail.includes('redirect') || detail.includes('url not allowed')) redirect('/login?error=redirect_config');
    console.error('oauth_start_failed', { provider, code: error?.code ?? 'unknown', status: error?.status ?? 0 });
    redirect('/login?error=oauth_failed');
  }
  redirect(data.url);
}

export async function loginAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const blocked = await throttle('login');
  if (blocked) return blocked;
  const parsed = parseForm(loginSchema, formData);
  if (!parsed.ok) return fail('err.invalid_credentials');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return fail('err.invalid_credentials'); // same message for unknown user / wrong password
  redirect(safeNext(String(formData.get('next') ?? '')));
}

export async function registerAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const blocked = await throttle('register', 5, 3600);
  if (blocked) return blocked;
  const { t } = await getT();
  const parsed = parseForm(registerSchema, formData);
  if (!parsed.ok) return { error: parsed.error.includes('password') ? t('err.password_short') : t('err.invalid_input') };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName, locale: await getLocale() }, emailRedirectTo: `${await siteUrl()}/auth/callback` },
  });
  // Do not reveal whether the email already exists.
  if (error && !/registered|exists/i.test(error.message)) {
    const detail = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
    if (detail.includes('email') || detail.includes('smtp') || detail.includes('send')) return { error: t('err.email_delivery') };
    return { error: t('err.generic') };
  }
  return { ok: true, message: t('auth.check_email') };
}

export async function forgotPasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const blocked = await throttle('forgot', 5, 3600);
  if (blocked) return blocked;
  const { t } = await getT();
  const parsed = parseForm(emailSchema, formData);
  if (!parsed.ok) return { error: t('err.invalid_input') };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${await siteUrl()}/auth/callback?next=/reset-password` });
  if (error) {
    const detail = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
    console.error('password_reset_email_failed', { code: error.code ?? 'unknown', status: error.status ?? 0 });
    if (error.status === 429 || detail.includes('rate limit')) return { error: t('err.email_rate_limit') };
    if (detail.includes('redirect') || detail.includes('url not allowed')) return { error: t('err.redirect_config') };
    return { error: t('err.email_delivery') };
  }
  return { ok: true, message: t('auth.reset_sent') }; // same success response; account existence is never revealed
}

export async function resetPasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getT();
  const parsed = parseForm(newPasswordSchema, formData);
  if (!parsed.ok) return { error: t('err.password_short') };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: t('err.link_expired') };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: t('err.generic') };
  await supabase.auth.signOut({ scope: 'others' }); // end every other session after a password change
  redirect('/dashboard');
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function logoutOthersAction(): Promise<ActionState> {
  const { t } = await getT();
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'others' });
  return { ok: true, message: t('account.others_signed_out') };
}

export async function setLocaleAction(formData: FormData) {
  const locale = formData.get('locale') === 'ar' ? 'ar' : 'en';
  (await cookies()).set('locale', locale, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) await supabase.from('profiles').update({ locale }).eq('id', data.user.id);
  revalidatePath('/', 'layout');
  redirect(safeNext(String(formData.get('next') ?? ''), '/'));
}
