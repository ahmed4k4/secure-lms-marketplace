import Link from 'next/link';
import { ArrowLeft, ArrowRight, Award, ListChecks, Play } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getT } from '@/lib/i18n';
import { CourseCard, type CatalogCourse } from '@/components/course-card';
import { HeroPreview } from '@/components/hero-preview';
import { Bus, IconBox, MonoLabel, Port, Tech } from '@/components/ui/brand';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { buttonVariants } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
import { cn, formatCount } from '@/lib/utils';

export default async function HomePage() {
  const { t, locale } = await getT();
  const supabase = await createClient();
  const [{ data: courses }, { count }, { data: categories }] = await Promise.all([
    // Fetch only the six catalog rows needed for the cards; count on the base table avoids aggregating the view.
    supabase.from('course_catalog').select('*').order('published_at', { ascending: false }).limit(6),
    supabase.from('courses').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    supabase.from('categories').select('slug, name_en, name_ar').order('position').limit(12),
  ]);
  const Arrow = locale === 'ar' ? ArrowLeft : ArrowRight;
  const pillars = [
    { icon: Play, title: t('home.p_learn_t'), body: t('home.p_learn_b'), tags: ['Video', 'Notes', 'Q&A'] },
    { icon: ListChecks, title: t('home.p_practice_t'), body: t('home.p_practice_b'), tags: ['Quizzes', 'Assignments', 'Feedback'] },
    { icon: Award, title: t('home.p_prove_t'), body: t('home.p_prove_b'), tags: ['Certificate', 'Verify'] },
  ];
  const steps = [1, 2, 3, 4] as const;

  return (
    <div className="space-y-24">
      <section className="relative -mt-4 grid items-center gap-10 py-6 lg:grid-cols-[1.05fr_1fr] lg:py-12">
        <div className="relative z-10">
          <MonoLabel>{'// ARCHAI ACADEMY'}</MonoLabel>
          <h1 className="mt-5 text-4xl font-bold leading-[1.15] md:text-6xl">
            {t('home.title_a')} <span className="text-arc">{t('home.title_b')}</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-silver/90">{t('home.subtitle')}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/courses" className={cn(buttonVariants({ size: 'lg' }))}>{t('home.cta_browse')}<Arrow className="h-4 w-4" strokeWidth={2} /></Link>
            <Link href="/register" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}>{t('home.cta_join')}</Link>
          </div>
          {!!count && (
            <p className="mt-8 text-sm text-muted-foreground">
              <span dir="ltr" className="num text-arc">[{formatCount(count, 'en')}]</span> {t('home.stat_courses')}
            </p>
          )}
        </div>
        <HeroPreview t={t} />
      </section>

      <section aria-labelledby="pillars">
        <MonoLabel>{'// WHAT YOU GET'}</MonoLabel>
        <h2 id="pillars" className="mb-2 mt-3 text-3xl md:text-4xl">{t('home.pillars_title')}</h2>
        <p className="mb-8 max-w-2xl text-muted-foreground">{t('home.pillars_sub')}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {pillars.map((p, i) => (
            <div key={p.title} className={cn('notch p-6', i === 2 ? 'bg-arc text-primary-foreground' : 'bg-steel')}>
              <IconBox variant={i === 2 ? 'default' : 'default'} size={48} className={i === 2 ? '!bg-deep !text-arc' : ''}><p.icon className="h-5 w-5" strokeWidth={1.75} /></IconBox>
              <h3 className="mt-5 text-xl">{p.title}</h3>
              <p className={cn('mt-2 text-sm', i === 2 ? 'text-primary-foreground/85' : 'text-muted-foreground')}>{p.body}</p>
              <div dir="ltr" className="mt-4 flex flex-wrap gap-2">{p.tags.map((tag) => <span key={tag} className={cn('rounded-full border px-2.5 py-0.5 font-mono text-[11px]', i === 2 ? 'border-primary-foreground/50' : 'border-border text-silver')}>{tag}</span>)}</div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="latest">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><MonoLabel>{'// LATEST'}</MonoLabel><h2 id="latest" className="mt-3 text-3xl md:text-4xl">{t('home.latest')}</h2></div>
          <Link href="/courses" className="text-sm font-semibold text-arc hover:underline">{t('home.all_courses')}</Link>
        </div>
        {!!categories?.length && (
          <div className="mb-6 flex flex-wrap gap-2">
            {categories.map((c) => <Link key={c.slug} href={`/courses?category=${c.slug}`} className="rounded-full border border-border px-4 py-1.5 text-sm text-silver transition-colors hover:border-arc hover:text-arc">{locale === 'ar' ? c.name_ar : c.name_en}</Link>)}
          </div>
        )}
        {courses?.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{(courses as CatalogCourse[]).map((c) => <CourseCard key={c.id} course={c} locale={locale} t={t} />)}</div>
        ) : <EmptyState title={t('catalog.empty')} hint={t('catalog.empty_hint')} />}
      </section>

      <section aria-labelledby="how">
        <MonoLabel>{'// HOW IT WORKS'}</MonoLabel>
        <h2 id="how" className="mb-8 mt-3 text-3xl md:text-4xl">{t('home.how_title')}</h2>
        <ol className="grid gap-6 md:grid-cols-4">
          {steps.map((n, i) => (
            <li key={n} className={cn('border-t-2 pt-4', i === 0 ? 'border-arc' : 'border-border')}>
              <span dir="ltr" className={cn('num text-2xl', i === 0 ? 'text-arc' : 'text-muted-foreground/60')}>{String(n).padStart(2, '0')}</span>
              <h3 className="mt-2 text-lg">{t(`home.step${n}_t` as never)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`home.step${n}_b` as never)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="chrome-edge relative overflow-hidden rounded-lg px-6 py-12 md:px-12">
        <Bus className="absolute inset-y-0 end-0 hidden h-full w-3/5 opacity-50 md:block" accent={false} />
        <div className="relative z-10 grid items-center gap-6 md:grid-cols-[1.5fr_auto]">
          <div>
            <Badge tone="brand"><Port className="!h-2 !w-2 !shadow-none" /> {t('home.teach_badge')}</Badge>
            <h2 className="mt-4 text-3xl md:text-4xl">{t('home.teach_title')}</h2>
            <p className="mt-3 max-w-xl text-silver/90">{t('home.teach_body')} <Tech>{BRAND.company}</Tech></p>
          </div>
          <a href={BRAND.website} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: 'accent', size: 'lg' }))}>{t('home.teach_cta')}</a>
        </div>
      </section>
    </div>
  );
}
