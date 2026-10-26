import Link from 'next/link';
import { getT } from '@/lib/i18n';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <div className="py-16 text-center">
      <h1 className="text-3xl">{t('err.not_found')}</h1>
      <Link href="/" className="mt-4 inline-block text-primary underline">{t('action.go_home')}</Link>
    </div>
  );
}
