import { Check } from 'lucide-react';
import { Bus, LogoMark, MonoLabel } from '@/components/ui/brand';
import { getT } from '@/lib/i18n';

/** Split layout for authentication: brand panel + form. */
export async function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const { t } = await getT();
  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[1fr_1.05fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-deep p-10 lg:flex">
        <Bus className="absolute inset-x-0 bottom-0 h-1/2 w-full opacity-70" />
        <div className="relative">
          <LogoMark size={56} />
          <MonoLabel className="mt-8 block">{'// ARCHAI ACADEMY'}</MonoLabel>
          <h2 className="mt-3 text-3xl leading-tight">{t('auth.panel_title')}</h2>
        </div>
        <ul className="relative mt-10 space-y-3 text-sm text-silver">
          {(['auth.panel_1', 'auth.panel_2', 'auth.panel_3'] as const).map((k) => <li key={k} className="flex items-start gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-arc" strokeWidth={2.5} aria-hidden />{t(k)}</li>)}
        </ul>
      </div>
      <div className="p-6 sm:p-10">
        <h1 className="text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        <div className="mt-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}
