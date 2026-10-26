import { createClient } from '@/lib/supabase/server';
import { getT } from '@/lib/i18n';
import { LogoMark, MonoLabel } from '@/components/ui/brand';
import { Alert } from '@/components/ui/primitives';
import { PrintButton } from '@/components/print-button';
import { formatDate } from '@/lib/utils';
import { publicEnv } from '@/lib/env';

export const metadata = { title: 'Certificate' };

/** Documents use the light theme from the identity guide (Paper / Ink / Arc Ink / Copper Ink) so they print cleanly. */
export default async function CertificatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { t, locale } = await getT();
  const supabase = await createClient();
  const { data } = await supabase.rpc('verify_certificate', { p_code: code.slice(0, 30) });
  if (!data) return <div className="mx-auto max-w-lg"><Alert tone="error">{t('cert.invalid')}</Alert></div>;
  return (
    <div className="theme-light mx-auto max-w-3xl rounded-lg bg-background p-3 text-foreground sm:p-6 print:max-w-none print:p-0">
      <div className="relative rounded-lg border-2 border-arc bg-card p-8 text-center sm:p-14">
        <div className="absolute inset-3 rounded-md border border-line" aria-hidden />
        <div className="relative space-y-5">
          <div className="flex flex-col items-center gap-3"><LogoMark size={64} /><MonoLabel>{'// CERTIFICATE OF COMPLETION'}</MonoLabel></div>
          <h1 className="text-3xl sm:text-4xl">{t('cert.title')}</h1>
          <p className="text-muted-foreground">{t('cert.awarded_to')}</p>
          <p className="font-display text-3xl font-bold sm:text-4xl">{data.holder_name}</p>
          <p className="text-muted-foreground">{t('cert.for_completing')}</p>
          <p className="font-display text-2xl font-semibold text-arc">{data.course_title}</p>
          <div className="mx-auto mt-6 flex max-w-md flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-line pt-5 text-sm text-muted-foreground">
            <span>{formatDate(data.issued_at, locale)}</span>
            <span dir="ltr" className="num font-semibold text-foreground">{data.code}</span>
          </div>
          <p dir="ltr" className="font-mono text-[11px] text-muted-foreground">{publicEnv.siteUrl.replace(/\/$/, '')}/certificates/{data.code}</p>
        </div>
      </div>
      <div className="no-print mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t('cert.print_hint')}</p><PrintButton label={t('cert.print')} /></div>
    </div>
  );
}
