import Link from 'next/link';
import { getT } from '@/lib/i18n';
import { registerAction, oauthLoginAction } from '@/actions/auth';
import { ActionForm, Field } from '@/components/action-form';
import { Input } from '@/components/ui/primitives';
import { AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'Create account' };

export default async function RegisterPage() {
  const { t } = await getT();
  return (
    <AuthShell title={t('auth.register_title')} subtitle={t('auth.register_sub')}>
      <div className="space-y-2">
        <form action={oauthLoginAction}>
          <input type="hidden" name="provider" value="google" />
          <input type="hidden" name="next" value={''} />
          <button className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold transition hover:bg-muted" type="submit">
            <span aria-hidden className="text-base font-bold">G</span> {t('auth.google')}
          </button>
        </form>
        <form action={oauthLoginAction}>
          <input type="hidden" name="provider" value="github" />
          <input type="hidden" name="next" value={''} />
          <button className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold transition hover:bg-muted" type="submit">{t('auth.github')}</button>
        </form>
        <p className="text-center text-xs text-muted-foreground">{t('auth.or_email')}</p>
      </div>
      <ActionForm action={registerAction} submitLabel={t('nav.register')}>
        <Field label={t('auth.full_name')} htmlFor="fullName"><Input id="fullName" name="fullName" autoComplete="name" required minLength={2} maxLength={100} /></Field>
        <Field label={t('auth.email')} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label={t('auth.password')} htmlFor="password" hint={t('auth.password_hint')}><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} /></Field>
      </ActionForm>
      <p className="text-sm text-muted-foreground">{t('auth.have_account')} <Link href="/login" className="font-semibold text-arc hover:underline">{t('nav.login')}</Link></p>
    </AuthShell>
  );
}
