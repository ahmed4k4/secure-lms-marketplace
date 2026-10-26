import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { hideReviewAction } from '@/actions/admin';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';

export default async function AdminReviews() {
  const { admin } = await requirePermission('moderation.manage');
  const { t, locale } = await getT();
  const { data } = await admin.from('reviews').select('id, rating, comment, is_hidden, created_at, courses(title), profiles:user_id(full_name)').order('created_at', { ascending: false }).limit(50);
  const one = (x: any) => (Array.isArray(x) ? x[0] : x);
  return (
    <div className="space-y-4">
      <h1 className="text-3xl">{t('admin.reviews')}</h1>
      {data?.length ? <ul className="space-y-2">{data.map((r: any) => (
        <li key={r.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{one(r.profiles)?.full_name}</span><span className="text-accent">{'★'.repeat(r.rating)}</span><span className="text-muted-foreground">{one(r.courses)?.title} · {formatDate(r.created_at, locale)}</span>{r.is_hidden && <Badge tone="danger">{t('admin.hidden')}</Badge>}
            <form action={hideReviewAction.bind(null, r.id, !r.is_hidden)} className="ms-auto"><Button size="sm" variant="outline">{r.is_hidden ? t('admin.restore') : t('admin.hide')}</Button></form></div>
          {r.comment && <p className="mt-2 whitespace-pre-wrap text-sm">{r.comment}</p>}
        </li>))}</ul> : <EmptyState title={t('admin.none')} />}
    </div>
  );
}
