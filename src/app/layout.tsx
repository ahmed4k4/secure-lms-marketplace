import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import '@fontsource-variable/sora';
import '@fontsource-variable/readex-pro';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './globals.css';
import { getDictionary, getT, dirOf } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n/provider';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const metadata: Metadata = {
  title: { default: 'Archai Academy — Where hardware meets intelligence', template: '%s · Archai Academy' },
  description: 'Courses from independent instructors with protected video, quizzes, assignments and verifiable certificates.',
  openGraph: { siteName: 'Archai Academy', type: 'website' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1B2228' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers(); // opt into dynamic rendering so the per-request CSP nonce is applied to framework scripts
  const { locale, t } = await getT();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <I18nProvider locale={locale} dict={getDictionary(locale) as Record<string, string>}>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
            {t('a11y.skip')}
          </a>
          <SiteHeader />
          <main id="main" className="mx-auto min-h-[60vh] max-w-7xl px-4 py-10">{children}</main>
          <SiteFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
