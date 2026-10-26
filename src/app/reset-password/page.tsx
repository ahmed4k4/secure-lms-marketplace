import { getT } from '@/lib/i18n';
import { resetPasswordAction } from '@/actions/auth';
import { ActionForm, Field } from '@/components/action-form';
import { Input } from '@/components/ui/primitives';
import { AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'New password' };

export default async function ResetPage() {
  const { t } = await getT();
  return (
    <AuthShell title={t('auth.reset_title')}>
      <ActionForm action={resetPasswordAction} submitLabel={t('auth.save_password')}>
        <Field label={t('auth.new_password')} htmlFor="password" hint={t('auth.password_hint')}><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} /></Field>
      </ActionForm>
    </AuthShell>
  );
}
