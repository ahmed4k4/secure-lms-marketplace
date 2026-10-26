import Link from 'next/link';
import Image from 'next/image';
import { Badge } from '@/components/ui/primitives';
import { Stars } from '@/components/ui/brand';
import { formatCount, formatHM, formatPrice } from '@/lib/utils';
import type { DictKey, Locale } from '@/lib/i18n/shared';

export type CatalogCourse = {
  id: string; slug: string; title: string; subtitle: string | null; access_type: 'free' | 'paid'; level?: string; language?: string;
  owner_name: string | null; category_name_en: string | null; category_name_ar: string | null;
  price_cents: number | null; currency: string | null; rating_avg: number; rating_count: number; lesson_count: number;
  total_duration_seconds?: number; student_count?: number; cover_url?: string | null;
  price_kind?: 'free' | 'one_time' | 'subscription' | null; billing_interval?: 'month' | 'year' | null;
};
export type T = (k: DictKey, v?: Record<string, string | number>) => string;

/** On-brand cover: flat steel panel with a "Bus" trace motif (no gradients, no stock photos). Pattern is seeded by the title. */
export function CourseCover({ title, className = 'h-40', mono, imageUrl }: { title: string; className?: string; mono?: string; imageUrl?: string | null }) {
  let h = 7;
  for (const c of title) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const bx = 90 + (h % 120), dy = 26 + ((h >> 3) % 36), y0 = 70 + ((h >> 6) % 24);
  const trace = (i: number) => `M0 ${y0 + i * 12} H${bx + i * 10} L${bx + i * 10 + dy} ${y0 + i * 12 - dy} H420`;
  return (
    <div aria-hidden={!imageUrl} className={`group relative overflow-hidden bg-steel ${className}`}>
      {imageUrl ? <Image src={imageUrl} alt={title} fill sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" /> : <>
        <svg viewBox="0 0 420 160" preserveAspectRatio="xMaxYMid slice" className="absolute inset-0 h-full w-full text-line rtl:-scale-x-100" fill="none">
          {[1, 2, 3, 4].map((i) => <path key={i} d={trace(i)} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />)}
          <path d={trace(0)} stroke="rgb(var(--arc))" strokeWidth="2" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 5px rgb(var(--arc) / .55))' }} />
          <circle cx="400" cy={y0 - dy} r="9" fill="rgb(var(--arc) / .2)" /><circle cx="400" cy={y0 - dy} r="4" fill="rgb(var(--arc))" />
        </svg>
        <span className="absolute bottom-3 start-4 font-display text-5xl font-bold leading-none text-line/90">{[...title.trim()][0]?.toUpperCase()}</span>
      </>}
      {mono && <span dir="ltr" className="absolute end-3 top-3 rounded-full border border-border bg-background/70 px-2 py-0.5 font-mono text-[10px] tracking-wider text-silver backdrop-blur">{mono}</span>}
    </div>
  );
}

export function CourseCard({ course, locale, t, headingLevel = 3 }: { course: CatalogCourse; locale: Locale; t: T; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const category = locale === 'ar' ? course.category_name_ar : course.category_name_en;
  const duration = formatHM(course.total_duration_seconds, { h: t('unit.h'), m: t('unit.m') });
  const meta = [t('course.lessons_n', { n: course.lesson_count }), duration, course.level && course.level !== 'all' ? t(`level.${course.level}` as DictKey) : ''].filter(Boolean);
  return (
    <Link href={`/courses/${course.slug}`} prefetch={false} className="group hover-lift flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <CourseCover title={course.title} imageUrl={course.cover_url} mono={course.language === 'ar' ? 'AR' : 'EN'} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        {category && <span className="text-xs font-semibold text-arc">{category}</span>}
        <Heading className="line-clamp-2 text-[17px] font-semibold leading-snug group-hover:text-arc">{course.title}</Heading>
        {course.owner_name && <p className="text-sm text-muted-foreground">{course.owner_name}</p>}
        <div className="flex items-center gap-2 text-sm">
          {course.rating_count > 0 ? (
            <>
              <span dir="ltr" className="num font-semibold text-copper">{Number(course.rating_avg).toFixed(1)}</span>
              <Stars value={Number(course.rating_avg)} />
              <span dir="ltr" className="num text-xs text-muted-foreground">({formatCount(course.rating_count, locale)})</span>
            </>
          ) : <Badge tone="brand">{t('course.new')}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{meta.join(' · ')}</p>
        <div className="mt-auto flex items-end justify-between pt-3">
          {course.access_type === 'free' ? <Badge tone="success">{t('course.free')}</Badge> : <span dir="ltr" className="font-display text-lg font-semibold">{formatPrice(course.price_cents, course.currency ?? 'USD', locale)}{course.price_kind === 'subscription' ? ` ${course.billing_interval === 'year' ? t('course.per_year') : t('course.per_month')}` : ''}</span>}
          {!!course.student_count && <span className="text-xs text-muted-foreground"><span dir="ltr" className="num">{formatCount(course.student_count, locale)}</span> {t('course.students')}</span>}
        </div>
      </div>
    </Link>
  );
}
