import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { updateProfileAction, updateInstructorProfileAction } from '@/actions/account';
import { logoutOthersAction } from '@/actions/auth';
import { ActionForm, Field } from '@/components/action-form';
import { Card, CardBody, Input, Select, Textarea } from '@/components/ui/primitives';

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const { supabase, user, profile, roles } = await requireUser('/account');
  const { t } = await getT();
  const { data: ip } = roles.includes('instructor')
    ? await supabase.from('instructor_profiles').select('headline, bio, website').eq('user_id', user.id).maybeSingle()
    : { data: null };
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl">{t('nav.account')}</h1>
      <Card><CardBody>
        <ActionForm action={updateProfileAction} submitLabel={t('action.save')}>
          <Field label={t('auth.email')} htmlFor="email"><Input id="email" value={user.email ?? ''} disabled readOnly /></Field>
          <Field label={t('auth.full_name')} htmlFor="fullName"><Input id="fullName" name="fullName" defaultValue={profile.full_name} required minLength={2} maxLength={100} /></Field>
          <Field label={t('account.language')} htmlFor="locale">
            <Select id="locale" name="locale" defaultValue={profile.locale}><option value="en">English</option><option value="ar">العربية</option></Select>
          </Field>
        </ActionForm>
      </CardBody></Card>

      {ip && (
        <Card><CardBody>
          <h2 className="mb-3 text-xl">{t('account.public_profile')}</h2>
          <ActionForm action={updateInstructorProfileAction} submitLabel={t('action.save')}>
            <Field label={t('account.headline')} htmlFor="headline"><Input id="headline" name="headline" defaultValue={ip.headline ?? ''} maxLength={160} /></Field>
            <Field label={t('account.bio')} htmlFor="bio"><Textarea id="bio" name="bio" defaultValue={ip.bio ?? ''} maxLength={4000} /></Field>
            <Field label={t('account.website')} htmlFor="website"><Input id="website" name="website" type="url" defaultValue={ip.website ?? ''} placeholder="https://" /></Field>
          </ActionForm>
          <Link href={`/instructors/${user.id}`} className="mt-3 inline-block text-sm text-primary underline">{t('account.view_public')}</Link>
        </CardBody></Card>
      )}

      <Card><CardBody className="space-y-3">
        <h2 className="text-xl">{t('account.security')}</h2>
        <Link href="/account/security" className="text-primary underline">{t('account.security')}</Link>
        <ActionForm action={logoutOthersAction} submitLabel={t('account.sign_out_others')} variant="outline"><p className="text-sm text-muted-foreground">{t('account.sessions_hint')}</p></ActionForm>
      </CardBody></Card>
    </div>
  );
}
