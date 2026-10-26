import Link from 'next/link';
import { SlidersHorizontal, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getT } from '@/lib/i18n';
import { CourseCard, type CatalogCourse } from '@/components/course-card';
import { EmptyState, Input, Select } from '@/components/ui/primitives';
import { Button, buttonVariants } from '@/components/ui/button';
import { MonoLabel } from '@/components/ui/brand';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Courses' };
const PAGE_SIZE = 12;
const SORTS = ['new', 'rating', 'popular', 'price_asc', 'price_desc'] as const;
type SP = Record<string, string | undefined>;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { t, locale } = await getT();
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const sort = (SORTS as readonly string[]).includes(sp.sort ?? '') ? (sp.sort as (typeof SORTS)[number]) : 'new';
  const minRating = ['4', '4.5'].includes(sp.rating ?? '') ? Number(sp.rating) : 0;
  const supabase = await createClient();

  let query = supabase.from('course_catalog').select('*', { count: 'exact' });
  // Strip characters that are meaningful in PostgREST filter syntax.
  const q = (sp.q ?? '').replace(/[%,()*\\:"']/g, ' ').trim().slice(0, 80);
  if (q) query = query.or(`title.ilike.%${q}%,subtitle.ilike.%${q}%,owner_name.ilike.%${q}%`);
  if (sp.category && /^[a-z0-9-]+$/.test(sp.category)) query = query.eq('category_slug', sp.category);
  if (sp.price === 'free' || sp.price === 'paid') query = query.eq('access_type', sp.price);
  if (sp.lang === 'en' || sp.lang === 'ar') query = query.eq('language', sp.lang);
  if (['beginner', 'intermediate', 'advanced'].includes(sp.level ?? '')) query = query.eq('level', sp.level!);
  if (minRating) query = query.gte('rating_avg', minRating);
  query = {
    new: () => query.order('published_at', { ascending: false }),
    rating: () => query.order('rating_avg', { ascending: false }).order('rating_count', { ascending: false }),
    popular: () => query.order('student_count', { ascending: false }),
    price_asc: () => query.order('price_cents', { ascending: true, nullsFirst: true }),
    price_desc: () => query.order('price_cents', { ascending: false, nullsFirst: false }),
  }[sort]();

  const from = (page - 1) * PAGE_SIZE;
  const [{ data: courses, count }, { data: categories }] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
    supabase.from('categories').select('slug, name_en, name_ar').order('position'),
  ]);
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (patch: SP) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v && k !== 'page') u.set(k, v);
    if (patch.page) u.set('page', patch.page);
    const s = u.toString();
    return s ? `/courses?${s}` : '/courses';
  };
  const catName = (slug: string) => { const c = categories?.find((x) => x.slug === slug); return c ? (locale === 'ar' ? c.name_ar : c.name_en) : slug; };
  const chips: { label: string; clear: SP }[] = [];
  if (q) chips.push({ label: `“${q}”`, clear: { q: undefined } });
  if (sp.category) chips.push({ label: catName(sp.category), clear: { category: undefined } });
  if (sp.level) chips.push({ label: t(`level.${sp.level}` as never), clear: { level: undefined } });
  if (sp.price) chips.push({ label: t(sp.price === 'free' ? 'course.free' : 'course.paid'), clear: { price: undefined } });
  if (sp.lang) chips.push({ label: sp.lang === 'ar' ? 'العربية' : 'English', clear: { lang: undefined } });
  if (minRating) chips.push({ label: `${minRating}+ ★`, clear: { rating: undefined } });

  const radio = (name: string, value: string, label: string, current: string | undefined) => (
    <label key={`${name}-${value}`} className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm text-silver hover:text-foreground has-[:checked]:text-arc">
      <input type="radio" name={name} value={value} defaultChecked={(current ?? '') === value} className="h-4 w-4 accent-[rgb(var(--arc))]" />{label}
    </label>
  );
  const group = (title: string, children: React.ReactNode) => (<fieldset className="border-b border-border pb-4"><legend className="mb-1.5 text-sm font-semibold">{title}</legend>{children}</fieldset>);

  return (
    <div className="space-y-6">
      <div><MonoLabel>{'// CATALOG'}</MonoLabel><h1 className="mt-2 text-3xl md:text-4xl">{t('nav.courses')}</h1></div>
      <form method="get" id="filters" className="grid gap-8 lg:grid-cols-[17rem_1fr]">
        <aside>
          <details className="group rounded-lg border border-border bg-card lg:!block lg:border-0 lg:bg-transparent" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold lg:hidden"><SlidersHorizontal className="h-4 w-4" />{t('catalog.filters')}</summary>
            <div className="space-y-4 px-4 pb-4 lg:p-0">
              {group(t('catalog.category'), <div>{radio('category', '', t('catalog.all_categories'), sp.category)}{categories?.map((c) => radio('category', c.slug, locale === 'ar' ? c.name_ar : c.name_en, sp.category))}</div>)}
              {group(t('catalog.level'), <div>{radio('level', '', t('catalog.any_level'), sp.level)}{(['beginner', 'intermediate', 'advanced'] as const).map((l) => radio('level', l, t(`level.${l}`), sp.level))}</div>)}
              {group(t('catalog.price'), <div>{radio('price', '', t('catalog.any_price'), sp.price)}{radio('price', 'free', t('course.free'), sp.price)}{radio('price', 'paid', t('course.paid'), sp.price)}</div>)}
              {group(t('catalog.rating'), <div>{radio('rating', '', t('catalog.rating_any'), sp.rating)}{radio('rating', '4', '4.0 ★ +', sp.rating)}{radio('rating', '4.5', '4.5 ★ +', sp.rating)}</div>)}
              {group(t('catalog.language'), <div>{radio('lang', '', t('catalog.any_language'), sp.lang)}{radio('lang', 'en', 'English', sp.lang)}{radio('lang', 'ar', 'العربية', sp.lang)}</div>)}
              <div className="flex gap-2"><Button type="submit" className="flex-1">{t('catalog.apply')}</Button>{chips.length > 0 && <Link href="/courses" className={cn(buttonVariants({ variant: 'outline' }))}>{t('catalog.clear')}</Link>}</div>
            </div>
          </details>
        </aside>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-3" role="search">
            <Input name="q" defaultValue={q} placeholder={t('catalog.search')} aria-label={t('catalog.search')} className="min-w-52 flex-1" />
            <Select name="sort" defaultValue={sort} aria-label={t('catalog.sort')} className="w-auto min-w-44">
              {SORTS.map((s) => <option key={s} value={s}>{t(`catalog.sort_${s}` as never)}</option>)}
            </Select>
            <Button type="submit" variant="outline">{t('catalog.apply')}</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="me-2 text-sm text-muted-foreground"><span dir="ltr" className="num font-semibold text-foreground">{total}</span> {t('catalog.results')}</p>
            {chips.map((c) => (
              <Link key={c.label} href={href(c.clear)} className="inline-flex items-center gap-1.5 rounded-full border border-arc/50 bg-arc/10 px-3 py-1 text-xs font-semibold text-arc hover:bg-arc/20">
                {c.label}<X className="h-3 w-3" aria-label={t('catalog.clear')} />
              </Link>
            ))}
          </div>
          {courses?.length ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{(courses as CatalogCourse[]).map((c) => <CourseCard key={c.id} course={c} locale={locale} t={t} headingLevel={2} />)}</div>
          ) : <EmptyState title={t('catalog.empty')} hint={t('catalog.empty_hint')}>{chips.length > 0 && <Link href="/courses" className={cn(buttonVariants({ variant: 'outline' }))}>{t('catalog.clear')}</Link>}</EmptyState>}
          {totalPages > 1 && (
            <nav className="flex items-center justify-center gap-4 pt-2" aria-label={t('catalog.pagination')}>
              {page > 1 ? <Link href={href({ page: String(page - 1) })} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>{t('action.previous')}</Link> : <span />}
              <span dir="ltr" className="num text-sm text-muted-foreground">{page} / {totalPages}</span>
              {page < totalPages ? <Link href={href({ page: String(page + 1) })} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>{t('action.next')}</Link> : <span />}
            </nav>
          )}
        </div>
      </form>
    </div>
  );
}
