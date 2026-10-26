import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n';
import { getAuth } from '@/lib/auth';
import { safeNext } from '@/lib/utils';
import { loginAction, oauthLoginAction } from '@/actions/auth';
import { ActionForm, Field } from '@/components/action-form';
import { Alert, Input } from '@/components/ui/primitives';
import { AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { t, locale } = await getT();
  const sp = await searchParams;
  const { user, profile } = await getAuth();
  if (user && profile?.status === 'active') redirect(safeNext(sp.next));
  const localeMessage = (kind: 'google' | 'github' | 'redirect' | 'oauth') => {
    const ar = locale === 'ar';
    if (kind === 'google') return ar ? 'تسجيل الدخول عبر Google غير مفعّل في Supabase حاليًا. فعّل Google من Authentication → Sign In / Providers وأكمل إعداد OAuth ثم جرّب مجددًا.' : 'Google sign-in is not enabled in this Supabase project yet. Enable Google under Authentication → Sign In / Providers, finish its OAuth setup, then try again.';
    if (kind === 'github') return ar ? 'تسجيل الدخول عبر GitHub غير مفعّل في Supabase حاليًا. فعّل GitHub من Authentication → Sign In / Providers وأكمل إعداد OAuth ثم جرّب مجددًا.' : 'GitHub sign-in is not enabled in this Supabase project yet. Enable GitHub under Authentication → Sign In / Providers, finish its OAuth setup, then try again.';
    if (kind === 'redirect') return ar ? 'عنوان إعادة التوجيه غير مسموح به في Supabase. أضف عنوان الموقع و /auth/callback إلى Redirect URLs.' : 'Supabase rejected the callback URL. Add this site origin and /auth/callback to Authentication → URL Configuration → Redirect URLs.';
    return ar ? 'تعذر بدء تسجيل الدخول الاجتماعي. راجع تفعيل المزوّد وإعداداته وعناوين إعادة التوجيه في Supabase.' : 'Could not start social sign-in. Check that the provider is enabled and its OAuth credentials and redirect URLs are configured in Supabase.';
  };
  return (
    <AuthShell title={t('auth.login_title')} subtitle={t('auth.login_sub')}>
      {sp.error && <Alert tone="error">{(() => {
        const e = sp.error ?? '';
        if (e === 'provider_disabled_google') return localeMessage('google');
        if (e === 'provider_disabled_github') return localeMessage('github');
        if (e === 'redirect_config') return localeMessage('redirect');
        if (e === 'oauth_failed' || e === 'provider_invalid') return localeMessage('oauth');
        if (e === 'link') return t('err.link_expired');
        return t('err.link_expired');
      })()}</Alert>}
      <div className="space-y-2">
        <form action={oauthLoginAction}>
          <input type="hidden" name="provider" value="google" />
          <input type="hidden" name="next" value={sp.next ?? ''} />
          <button className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold transition hover:bg-muted" type="submit">
            <span aria-hidden className="text-base font-bold">G</span> {t('auth.google')}
          </button>
        </form>
        <form action={oauthLoginAction}>
          <input type="hidden" name="provider" value="github" />
          <input type="hidden" name="next" value={sp.next ?? ''} />
          <button className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold transition hover:bg-muted" type="submit">{t('auth.github')}</button>
        </form>
        <p className="text-center text-xs text-muted-foreground">{t('auth.or_email')}</p>
      </div>
      <ActionForm action={loginAction} submitLabel={t('nav.login')}>
        <input type="hidden" name="next" value={sp.next ?? ''} />
        <Field label={t('auth.email')} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label={t('auth.password')} htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      </ActionForm>
      <p className="text-sm"><Link href="/forgot-password" className="text-arc hover:underline">{t('auth.forgot')}</Link></p>
      <p className="text-sm text-muted-foreground">{t('auth.no_account')} <Link href="/register" className="font-semibold text-arc hover:underline">{t('nav.register')}</Link></p>
    </AuthShell>
  );
}
