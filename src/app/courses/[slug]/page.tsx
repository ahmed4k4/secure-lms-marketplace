import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Award, Check, ChevronDown, FileText, Infinity as InfinityIcon, Lock, MessageSquare, NotebookPen, Play, Video } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getAuth } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { CourseCover } from '@/components/course-card';
import { Bus, Stars } from '@/components/ui/brand';
import { Alert, Badge, Card, CardBody, Select, Textarea } from '@/components/ui/primitives';
import { Button, buttonVariants } from '@/components/ui/button';
import { ActionForm, Field } from '@/components/action-form';
import { enrollFreeAction, reviewAction } from '@/actions/learning';
import { buyCourseWithWalletAction, buySubscriptionWithWalletAction } from '@/actions/wallet';
import { cn, formatCount, formatDate, formatDuration, formatHM, formatPrice, initials } from '@/lib/utils';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from('courses').select('title, subtitle').eq('slug', slug).eq('status', 'published').maybeSingle();
  return { title: data?.title ?? 'Course', description: data?.subtitle ?? undefined };
}

export default async function CoursePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { supabase, user } = await getAuth();

  const { data: course } = await supabase.from('courses').select('id, slug, title, subtitle, description, cover_url, language, level, access_type, status, created_by, published_at, updated_at, outcomes, requirements, audience').eq('slug', slug).maybeSingle();
  if (!course) notFound();

  const [{ data: catalog }, { data: sections }, { data: reviews }, { data: instructor }, { data: product }] = await Promise.all([
    supabase.from('course_catalog').select('price_cents, currency, price_kind, billing_interval, rating_avg, rating_count, category_name_en, category_name_ar, category_slug, student_count, total_duration_seconds, lesson_count').eq('id', course.id).maybeSingle(),
    supabase.from('sections').select('id, title, position, lessons(id, title, type, position, is_free_preview, duration_seconds)').eq('course_id', course.id).order('position'),
    supabase.from('public_reviews').select('id, rating, comment, created_at, reviewer_name, is_mine').eq('course_id', course.id).order('created_at', { ascending: false }).limit(100),
    supabase.from('public_instructors').select('id, full_name, headline, bio').eq('id', course.created_by).maybeSingle(),
    supabase.from('products').select('pricing_plans(id, access_days, active, kind, billing_interval, amount_cents, currency)').eq('course_id', course.id).maybeSingle(),
  ]);

  let hasAccess = false, canManage = false;
  if (user) {
    const [a, m] = await Promise.all([supabase.rpc('has_course_access', { p_course_id: course.id }), supabase.rpc('can_manage_course', { p_course_id: course.id })]);
    hasAccess = a.data === true;
    canManage = m.data === true;
  }
  const mine = reviews?.find((r) => r.is_mine);
  const secs = (sections ?? []).map((s) => ({ ...s, lessons: [...(s.lessons as any[])].sort((a, b) => a.position - b.position) }));
  const lessonCount = secs.reduce((n, s) => n + s.lessons.length, 0);
  const totalSeconds = secs.reduce((n, s) => n + s.lessons.reduce((m, l) => m + (l.duration_seconds ?? 0), 0), 0);
  const units = { h: t('unit.h'), m: t('unit.m') };
  const category = locale === 'ar' ? catalog?.category_name_ar : catalog?.category_name_en;
  const activePlans = ((product?.pricing_plans ?? []) as { id: string; access_days: number | null; active: boolean; kind: string; billing_interval?: string | null; amount_cents: number; currency: string }[]).filter((p) => p.active);
  const activePlan = activePlans.find((p) => p.kind === 'one_time');
  const subscriptionPlan = activePlans.find((p) => p.kind === 'subscription');
  const accessDays = activePlans.find((p) => p.kind !== 'free')?.access_days ?? null;
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: (reviews ?? []).filter((r) => r.rating === n).length }));
  const distTotal = Math.max(1, reviews?.length ?? 0);
  const price = course.access_type === 'free' ? t('course.free') : `${formatPrice(catalog?.price_cents, catalog?.currency ?? 'USD', locale)}${catalog?.price_kind === 'subscription' ? ` ${catalog.billing_interval === 'year' ? t('course.per_year') : t('course.per_month')}` : ''}`;

  const cta = canManage ? (
    <div className="space-y-2">
      <Link href={`/learn/${course.slug}`} className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>{t('course.preview_as_learner')}</Link>
      <Link href={`/instructor/courses/${course.id}`} className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>{t('course.edit')}</Link>
    </div>
  ) : hasAccess ? (
    <Link href={`/learn/${course.slug}`} className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>{t('course.continue')}</Link>
  ) : course.status !== 'published' ? (
    <Alert tone="warn">{t('course.unavailable')}</Alert>
  ) : course.access_type === 'free' ? (
    user ? <form action={enrollFreeAction.bind(null, course.id, course.slug)}><Button size="lg" className="w-full">{t('course.enroll_free')}</Button></form>
      : <Link href={`/login?next=${encodeURIComponent(`/courses/${course.slug}`)}`} className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>{t('course.login_to_enroll')}</Link>
  ) : user && (activePlan || subscriptionPlan) ? (
    <div className="space-y-3">
      {activePlan && <ActionForm action={buyCourseWithWalletAction} submitLabel="شراء نهائي من المحفظة" className="space-y-2">
        <input type="hidden" name="planId" value={activePlan.id} />
        <p className="text-xs text-muted-foreground">شراء لمرة واحدة: {formatPrice(activePlan.amount_cents, activePlan.currency, locale)}. سيبقى الوصول وفق مدة الخطة.</p>
      </ActionForm>}
      {subscriptionPlan && <ActionForm action={buySubscriptionWithWalletAction} submitLabel={`اشتراك من المحفظة — ${formatPrice(subscriptionPlan.amount_cents, subscriptionPlan.currency, locale)} / ${subscriptionPlan.billing_interval === 'year' ? 'سنة' : 'شهر'}`} className="space-y-2">
        <input type="hidden" name="planId" value={subscriptionPlan.id} />
        <p className="text-xs text-muted-foreground">يتجدد الاشتراك تلقائيًا من المحفظة عند الموعد طالما الرصيد كافٍ، ويمكنك إلغاء التجديد من صفحة المحفظة.</p>
      </ActionForm>}
      <Link href={`/checkout/${course.slug}`} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}>{t(catalog?.price_kind === 'subscription' ? 'course.subscribe' : 'course.buy')}</Link>
      <Link href="/wallet" className="block text-center text-sm text-primary underline">عرض رصيد المحفظة والاشتراكات</Link>
    </div>
  ) : (
    <Link href={`/checkout/${course.slug}`} className={cn(buttonVariants({ variant: 'accent', size: 'lg' }), 'w-full')}>{t(catalog?.price_kind === 'subscription' ? 'course.subscribe' : 'course.buy')}</Link>
  );

  const includes: [React.ElementType, string][] = [
    [Video, t('course.inc_video', { h: formatHM(totalSeconds, units) || '—' })],
    [Play, t('course.lessons_n', { n: lessonCount })],
    [MessageSquare, t('course.inc_qa')],
    [NotebookPen, t('course.inc_notes')],
    [Award, t('course.inc_cert')],
    [InfinityIcon, catalog?.price_kind === 'subscription' ? t('course.subscription_note') : accessDays ? t('course.inc_days', { n: accessDays }) : t('course.inc_lifetime')],
  ];

  return (
    <div className="pb-24 lg:pb-0">
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[1fr_22rem]">
        <header className="chrome-edge relative overflow-hidden rounded-lg !bg-deep px-6 py-8 md:px-8 lg:col-start-1">
          <Bus className="absolute inset-y-0 end-0 hidden h-full w-1/2 opacity-40 md:block" accent={false} />
          <div className="relative space-y-4">
            <nav aria-label="breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/courses" className="hover:text-arc">{t('nav.courses')}</Link>
              {category && <><span aria-hidden>/</span><Link href={`/courses?category=${catalog?.category_slug}`} className="hover:text-arc">{category}</Link></>}
            </nav>
            <h1 className="text-3xl leading-tight md:text-4xl">{course.title}</h1>
            {course.subtitle && <p className="max-w-2xl text-lg text-silver/90">{course.subtitle}</p>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {!!catalog?.rating_count ? (
                <span className="flex items-center gap-2"><span dir="ltr" className="num font-semibold text-copper">{Number(catalog.rating_avg).toFixed(1)}</span><Stars value={Number(catalog.rating_avg)} /><span className="text-muted-foreground">({t('course.rating_n', { n: formatCount(catalog.rating_count, locale) })})</span></span>
              ) : <Badge tone="brand">{t('course.new')}</Badge>}
              {!!catalog?.student_count && <span className="text-silver"><span dir="ltr" className="num">{formatCount(catalog.student_count, locale)}</span> {t('course.students')}</span>}
              {course.status !== 'published' && <Badge tone="warn">{t(`status.${course.status}` as never)}</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{t(`level.${course.level}` as never)}</Badge>
              <Badge>{course.language === 'ar' ? 'العربية' : 'English'}</Badge>
              <span className="text-xs text-muted-foreground">{t('course.updated', { date: formatDate(course.updated_at ?? course.published_at, locale) })}</span>
            </div>
            {instructor && <p className="text-sm text-silver">{t('course.by')} <Link className="font-semibold text-arc hover:underline" href={`/instructors/${instructor.id}`}>{instructor.full_name}</Link></p>}
          </div>
        </header>

        <aside className="lg:col-start-2 lg:row-span-6 lg:row-start-1">
          <div className="lg:sticky lg:top-24">
            <Card chrome className="overflow-hidden">
              <CourseCover title={course.title} className="h-44" imageUrl={course.cover_url} mono={course.language === 'ar' ? 'AR' : 'EN'} />
              <CardBody className="space-y-5">
                {sp.error === 'enroll' && <Alert tone="error">{t('err.enroll')}</Alert>}
                <p dir={course.access_type === 'free' ? undefined : 'ltr'} className="font-display text-4xl font-bold">{price}</p>
                {cta}
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-silver">{t('course.includes')}</h2>
                  <ul className="space-y-2.5 text-sm">{includes.map(([Icon, label]) => <li key={label} className="flex items-center gap-3 text-silver"><Icon className="h-4 w-4 shrink-0 text-arc" strokeWidth={1.75} aria-hidden />{label}</li>)}</ul>
                </div>
                <p className="border-t border-border pt-4 text-xs text-muted-foreground">{catalog?.price_kind === 'subscription' ? t('course.subscription_note') : t('course.lifetime_note')}</p>
              </CardBody>
            </Card>
          </div>
        </aside>

        {!!course.outcomes?.length && (
          <section aria-labelledby="learn" className="rounded-lg border border-border bg-card p-6 lg:col-start-1">
            <h2 id="learn" className="mb-4 text-2xl">{t('course.learn_title')}</h2>
            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">{course.outcomes.map((o: string) => <li key={o} className="flex items-start gap-3 text-[15px]"><Check className="mt-1 h-4 w-4 shrink-0 text-arc" strokeWidth={2.5} aria-hidden />{o}</li>)}</ul>
          </section>
        )}

        <section aria-labelledby="curriculum" className="lg:col-start-1">
          <h2 id="curriculum" className="text-2xl">{t('course.curriculum')}</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">{t('course.sections_n', { n: secs.length })} · {t('course.lessons_n', { n: lessonCount })}{totalSeconds ? ` · ${formatHM(totalSeconds, units)}` : ''}</p>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {secs.map((s, i) => {
              const dur = s.lessons.reduce((m: number, l: any) => m + (l.duration_seconds ?? 0), 0);
              return (
                <details key={s.id} open={i === 0} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 hover:bg-steel/40">
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base group-open:rotate-180" aria-hidden />
                    <span className="min-w-0 flex-1 font-semibold">{s.title}</span>
                    <span className="text-xs text-muted-foreground">{t('course.lessons_n', { n: s.lessons.length })}{dur ? ` · ${formatHM(dur, units)}` : ''}</span>
                  </summary>
                  <ul className="border-t border-border bg-deep/50">
                    {s.lessons.map((l: any) => {
                      const open = hasAccess || canManage || l.is_free_preview;
                      const Icon = !open ? Lock : l.type === 'video' ? Play : FileText;
                      return (
                        <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 ps-11 text-sm">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                          {open && user ? <Link href={`/learn/${course.slug}/${l.id}`} className="hover:text-arc hover:underline">{l.title}</Link> : <span className="text-silver">{l.title}</span>}
                          {l.is_free_preview && <Badge tone="brand">{t('course.preview')}</Badge>}
                          <span dir="ltr" className="num ms-auto text-xs text-muted-foreground">{formatDuration(l.duration_seconds)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
            {!secs.length && <p className="p-6 text-muted-foreground">{t('course.no_curriculum')}</p>}
          </div>
        </section>

        {!!course.requirements?.length && (
          <section aria-labelledby="req" className="lg:col-start-1"><h2 id="req" className="mb-3 text-2xl">{t('course.requirements')}</h2>
            <ul className="list-disc space-y-2 ps-5 text-[15px] text-silver marker:text-arc">{course.requirements.map((r: string) => <li key={r}>{r}</li>)}</ul></section>
        )}
        {course.description && <section aria-labelledby="about" className="lg:col-start-1"><h2 id="about" className="mb-3 text-2xl">{t('course.about')}</h2><p className="max-w-prose whitespace-pre-wrap text-[15px] leading-8 text-silver">{course.description}</p></section>}
        {!!course.audience?.length && (
          <section aria-labelledby="aud" className="lg:col-start-1"><h2 id="aud" className="mb-3 text-2xl">{t('course.audience')}</h2>
            <ul className="list-disc space-y-2 ps-5 text-[15px] text-silver marker:text-arc">{course.audience.map((r: string) => <li key={r}>{r}</li>)}</ul></section>
        )}

        {instructor && (
          <section aria-labelledby="inst" className="lg:col-start-1"><h2 id="inst" className="mb-3 text-2xl">{t('course.instructor')}</h2>
            <Card><CardBody className="flex gap-4">
              <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-arc/60 bg-deep font-display text-xl font-semibold text-arc">{initials(instructor.full_name)}</span>
              <div className="min-w-0"><Link href={`/instructors/${instructor.id}`} className="font-display text-lg font-semibold hover:text-arc">{instructor.full_name}</Link>
                {instructor.headline && <p className="text-sm text-muted-foreground">{instructor.headline}</p>}
                {instructor.bio && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-silver">{instructor.bio}</p>}</div>
            </CardBody></Card></section>
        )}

        <section aria-labelledby="reviews" className="lg:col-start-1">
          <h2 id="reviews" className="mb-4 text-2xl">{t('course.reviews')}</h2>
          {!!reviews?.length && (
            <div className="mb-6 grid items-center gap-6 rounded-lg border border-border bg-card p-5 sm:grid-cols-[10rem_1fr]">
              <div className="text-center"><p dir="ltr" className="num text-5xl font-semibold text-copper">{Number(catalog?.rating_avg ?? 0).toFixed(1)}</p><Stars value={Number(catalog?.rating_avg ?? 0)} size={16} className="mt-1" /><p className="mt-1 text-xs text-muted-foreground">{t('course.rating_n', { n: formatCount(catalog?.rating_count ?? 0, locale) })}</p></div>
              <ul className="space-y-1.5">{dist.map((d) => (
                <li key={d.n} className="flex items-center gap-3 text-sm"><span dir="ltr" className="num w-8 text-silver">{d.n} ★</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-steel"><span className="block h-full rounded-full bg-copper" style={{ width: `${(d.c / distTotal) * 100}%` }} /></span>
                  <span dir="ltr" className="num w-8 text-end text-xs text-muted-foreground">{Math.round((d.c / distTotal) * 100)}%</span></li>))}</ul>
            </div>
          )}
          {hasAccess && (
            <Card className="mb-4"><CardBody>
              <ActionForm action={reviewAction.bind(null, course.id, course.slug)} submitLabel={t('review.submit')}>
                <Field label={t('review.rating')} htmlFor="rating"><Select id="rating" name="rating" defaultValue={String(mine?.rating ?? 5)}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</Select></Field>
                <Field label={t('review.comment')} htmlFor="comment"><Textarea id="comment" name="comment" maxLength={3000} defaultValue={mine?.comment ?? ''} /></Field>
              </ActionForm>
            </CardBody></Card>
          )}
          <ul className="grid gap-3 md:grid-cols-2">
            {reviews?.slice(0, 10).map((r) => (
              <li key={r.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-3"><span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-steel text-sm font-semibold text-silver">{initials(r.reviewer_name)}</span>
                  <div><p className="text-sm font-semibold">{r.reviewer_name}</p><div className="flex items-center gap-2"><Stars value={r.rating} size={12} /><span className="text-xs text-muted-foreground">{formatDate(r.created_at, locale)}</span></div></div></div>
                {r.comment && <p className="mt-3 whitespace-pre-wrap text-sm text-silver">{r.comment}</p>}
              </li>
            ))}
            {!reviews?.length && <li className="text-muted-foreground">{t('course.no_reviews')}</li>}
          </ul>
        </section>
      </div>

      {/* Sticky purchase bar on small screens */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <p dir={course.access_type === 'free' ? undefined : 'ltr'} className="font-display text-2xl font-bold">{price}</p>
        <div className="ms-auto min-w-40 flex-1 sm:max-w-xs">{canManage || hasAccess ? (
          <Link href={`/learn/${course.slug}`} className={cn(buttonVariants(), 'w-full')}>{t('course.continue')}</Link>
        ) : course.status === 'published' && course.access_type === 'paid' ? (
          <Link href={`/checkout/${course.slug}`} className={cn(buttonVariants({ variant: 'accent' }), 'w-full')}>{t(catalog?.price_kind === 'subscription' ? 'course.subscribe' : 'course.buy')}</Link>
        ) : course.status === 'published' && user ? (
          <form action={enrollFreeAction.bind(null, course.id, course.slug)}><Button className="w-full">{t('course.enroll_free')}</Button></form>
        ) : <Link href={`/login?next=${encodeURIComponent(`/courses/${course.slug}`)}`} className={cn(buttonVariants(), 'w-full')}>{t('course.login_to_enroll')}</Link>}</div>
      </div>
    </div>
  );
}
