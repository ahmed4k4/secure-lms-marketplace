import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { forgotPasswordAction, logoutOthersAction } from '@/actions/auth';
import { ActionForm, Field } from '@/components/action-form';
import { Alert, Card, CardBody, Input } from '@/components/ui/primitives';

export const metadata = { title: 'Account security' };

export default async function SecurityPage() {
  const { user } = await requireUser('/account/security');
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div><p className="font-mono text-xs tracking-widest text-arc">// ACCOUNT SECURITY</p><h1 className="mt-2 text-3xl font-semibold">{t('account.security')}</h1><p className="mt-2 text-sm text-muted-foreground">{t('account.security_note')}</p></div>
      <Card><CardBody className="space-y-4">
        <h2 className="text-xl font-semibold">{t('account.reset_password')}</h2>
        <Alert tone="info">{t('account.reset_password_note')}</Alert>
        <ActionForm action={forgotPasswordAction} submitLabel={t('auth.send_link')}>
          <Field label={t('auth.email')} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" defaultValue={user.email ?? ''} required /></Field>
        </ActionForm>
      </CardBody></Card>
      <Card><CardBody className="space-y-3"><h2 className="text-xl font-semibold">{t('account.sessions')}</h2><p className="text-sm text-muted-foreground">{t('account.sessions_hint')}</p><ActionForm action={logoutOthersAction} submitLabel={t('account.sign_out_others')} variant="outline" /></CardBody></Card>
    </div>
  );
}
