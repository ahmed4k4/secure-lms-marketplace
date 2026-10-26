import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getT } from '@/lib/i18n';
import { Alert, Card, CardBody } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { formatPrice } from '@/lib/utils';

export const metadata = { title: 'Checkout' };

/**
 * Phase 1 placeholder: NOTHING here creates an order, charges a card or grants access.
 * Access is only ever granted from a verified provider webhook (phase 2).
 */
export default async function CheckoutPlaceholder({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { t, locale } = await getT();
  const supabase = await createClient();
  const { data: c } = await supabase.from('course_catalog').select('id, slug, title, price_cents, currency, access_type, price_kind, billing_interval').eq('slug', slug).eq('status', 'published').maybeSingle();
  if (!c || c.access_type !== 'paid') notFound();
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-3xl">{t('checkout.title')}</h1>
      <Alert tone="warn">{t('checkout.unavailable')}</Alert>
      <Card><CardBody className="space-y-2">
        <p className="font-medium">{c.title}</p>
        <p className="font-display text-2xl">{formatPrice(c.price_cents, c.currency ?? 'USD', locale)}{c.price_kind === 'subscription' ? (c.billing_interval === 'year' ? ` ${t('course.per_year')}` : ` ${t('course.per_month')}`) : ''}</p>
        <Button disabled className="w-full" aria-disabled>{t('checkout.pay_disabled')}</Button>
      </CardBody></Card>
      <Link href={`/courses/${c.slug}`} className="text-sm text-primary underline">{t('action.back')}</Link>
    </div>
  );
}
