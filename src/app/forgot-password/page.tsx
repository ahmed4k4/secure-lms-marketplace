import { getT } from '@/lib/i18n';
import { forgotPasswordAction } from '@/actions/auth';
import { ActionForm, Field } from '@/components/action-form';
import { Input } from '@/components/ui/primitives';
import { AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'Reset password' };

export default async function ForgotPage() {
  const { t } = await getT();
  return (
    <AuthShell title={t('auth.forgot_title')}>
      <ActionForm action={forgotPasswordAction} submitLabel={t('auth.send_link')}>
        <Field label={t('auth.email')} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      </ActionForm>
    </AuthShell>
  );
}
