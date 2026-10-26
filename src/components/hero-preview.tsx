import { Award, Check, Play } from 'lucide-react';
import { Bus, IconBox } from '@/components/ui/brand';
import type { T } from '@/components/course-card';

/** Decorative product preview built from real UI primitives on glass panels (the identity guide asks for UI screens instead of stock imagery). */
export function HeroPreview({ t }: { t: T }) {
  const bar = (w: string, o = 'bg-steel') => <span className={`block h-2 rounded-full ${o}`} style={{ width: w }} />;
  return (
    <div aria-hidden className="relative mx-auto h-[400px] w-full max-w-[560px] select-none">
      <Bus className="absolute inset-y-0 -end-24 h-full w-[calc(100%+6rem)]" />
      <div className="glass absolute inset-x-6 top-8 rounded-lg p-4 shadow-2xl">
        <div className="mb-3 flex items-center gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-line" />)}<span className="ms-auto">{bar('72px')}</span></div>
        <div className="grid grid-cols-[1.5fr_1fr] gap-3">
          <div className="relative flex aspect-video items-center justify-center rounded-md bg-deep">
            <IconBox variant="filled" size={48} className="rounded-full"><Play className="h-5 w-5 fill-current" strokeWidth={1.75} /></IconBox>
            <span className="absolute inset-x-3 bottom-3 h-1 rounded-full bg-steel"><span className="block h-full w-[68%] rounded-full bg-arc" style={{ boxShadow: '0 0 10px rgb(var(--arc) / .6)' }} /></span>
          </div>
          <div className="space-y-2.5 py-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`flex h-4 w-4 items-center justify-center rounded-full ${i < 2 ? 'bg-ok text-primary-foreground' : 'border border-line'}`}>{i < 2 && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                {bar(i % 2 ? '60%' : '82%')}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 space-y-2">{bar('90%')}{bar('64%')}</div>
      </div>
      <div className="glass absolute bottom-6 start-0 w-44 rounded-lg p-4 shadow-xl">
        <p dir="ltr" className="label-mono !text-muted-foreground">{t('home.preview_progress')}</p>
        <p dir="ltr" className="num mt-1 text-4xl font-semibold text-foreground">68<span className="text-lg text-muted-foreground">%</span></p>
      </div>
      <div className="glass absolute bottom-0 end-0 flex items-center gap-3 rounded-lg p-3 pe-5 shadow-xl">
        <IconBox variant="active" size={48}><Award className="h-5 w-5" strokeWidth={1.75} /></IconBox>
        <div><p className="text-sm font-semibold">{t('home.preview_cert')}</p>{bar('88px')}</div>
      </div>
    </div>
  );
}
