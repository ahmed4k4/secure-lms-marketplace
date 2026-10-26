import Link from 'next/link';
import { getT } from '@/lib/i18n';
import { LogoMark, Wordmark } from '@/components/ui/brand';
import { BRAND } from '@/lib/brand';

export async function SiteFooter() {
  const { t } = await getT();
  const col = 'space-y-2.5 text-sm';
  const head = 'mb-3 font-display text-sm font-semibold text-foreground';
  const link = 'text-muted-foreground hover:text-arc';
  return (
    <footer className="no-print mt-24 border-t border-border bg-deep">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3"><LogoMark size={44} /><Wordmark name="Archai" /></div>
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">{t('footer.tagline')}</p>
          <p dir="ltr" className="mt-1 font-mono text-xs text-muted-foreground/80">Where hardware meets intelligence.</p>
        </div>
        <div><h2 className={head}>{t('footer.platform')}</h2>
          <ul className={col}>
            <li><Link className={link} href="/courses">{t('nav.courses')}</Link></li>
            <li><Link className={link} href="/dashboard">{t('nav.my_learning')}</Link></li>
            <li><Link className={link} href="/account">{t('nav.account')}</Link></li>
          </ul></div>
        <div><h2 className={head}>{t('footer.company')}</h2>
          <ul className={col}>
            <li><a className={link} href={BRAND.website} target="_blank" rel="noopener noreferrer">{BRAND.company}</a></li>
            <li><a className={link} href={BRAND.website} target="_blank" rel="noopener noreferrer">{t('footer.work_with_us')}</a></li>
          </ul></div>
        <div><h2 className={head}>{t('footer.follow')}</h2>
          <ul className={col}>{BRAND.social.map((s) => <li key={s.label}><a className={link} href={s.href} target="_blank" rel="noopener noreferrer" dir="ltr">{s.label}</a></li>)}</ul></div>
      </div>
      <div className="border-t border-border"><p dir="ltr" className="mx-auto max-w-7xl px-4 py-5 font-mono text-xs text-muted-foreground/80">© {new Date().getFullYear()} {BRAND.company}. All rights reserved.</p></div>
    </footer>
  );
}
