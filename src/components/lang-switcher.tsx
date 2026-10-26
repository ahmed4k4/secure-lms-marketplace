'use client';
import { usePathname } from 'next/navigation';
import { setLocaleAction } from '@/actions/auth';
import { useT } from '@/lib/i18n/provider';

export function LangSwitcher() {
  const pathname = usePathname();
  const { locale, t } = useT();
  const target = locale === 'ar' ? 'en' : 'ar';
  return (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={target} />
      <input type="hidden" name="next" value={pathname} />
      <button type="submit" className="rounded-md px-2 py-1 text-sm font-medium hover:bg-muted" lang={target} aria-label={t('nav.switch_language')}>
        {target === 'ar' ? 'العربية' : 'English'}
      </button>
    </form>
  );
}
