import { getT } from '@/lib/i18n';
import { logoutAction } from '@/actions/auth';
import { Alert } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

export default async function SuspendedPage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-3xl">{t('suspended.title')}</h1>
      <Alert tone="warn">{t('suspended.body')}</Alert>
      <form action={logoutAction}><Button variant="outline">{t('nav.logout')}</Button></form>
    </div>
  );
}
