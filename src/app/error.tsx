'use client';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useT();
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl">{t('err.generic')}</h1>
      <Button className="mt-4" onClick={reset}>{t('action.retry')}</Button>
    </div>
  );
}
