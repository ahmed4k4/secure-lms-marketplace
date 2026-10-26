import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { deleteCategoryAction, reviewCategoryRequestAction, saveCategoryAction } from '@/actions/admin';
import { ActionForm } from '@/components/action-form';
import { ConfirmSubmit } from '@/components/form-bits';
import { Badge, Card, CardBody, CardHeader, Input } from '@/components/ui/primitives';

export default async function AdminCategories() {
  const { supabase } = await requirePermission('categories.manage');
  const { t, locale } = await getT();
  const [{ data: cats }, { data: requests }] = await Promise.all([
    supabase.from('categories').select('id, slug, name_en, name_ar').order('position'),
    supabase.from('category_requests').select('id, slug, name_en, name_ar, created_at, requester:profiles!category_requests_requested_by_fkey(full_name)').eq('status', 'pending').order('created_at', { ascending: true }).limit(100),
  ]);
  const fields = (c?: { slug: string; name_en: string; name_ar: string }) => (
    <>
      <Input name="slug" placeholder="slug" aria-label="slug" defaultValue={c?.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" className="w-36" dir="ltr" />
      <Input name="nameEn" placeholder="English" aria-label="English" defaultValue={c?.name_en} required className="w-44" />
      <Input name="nameAr" placeholder="العربية" aria-label="العربية" defaultValue={c?.name_ar} required className="w-44" />
    </>
  );
  return (
    <div className="space-y-6">
      <header><p className="font-mono text-xs tracking-widest text-arc">// TAXONOMY</p><h1 className="mt-2 text-3xl font-semibold">{t('admin.categories')}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('course.new_category_hint')}</p></header>
      <section className="space-y-3" aria-labelledby="category-requests">
        <div className="flex items-center justify-between gap-3"><h2 id="category-requests" className="text-xl font-semibold">{t('admin.category_requests')}</h2><Badge tone={requests?.length ? 'warn' : 'neutral'}>{requests?.length ?? 0}</Badge></div>
        {requests?.length ? requests.map((request: any) => {
          const profile = Array.isArray(request.requester) ? request.requester[0] : request.requester;
          return <Card key={request.id}><CardHeader className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{locale === 'ar' ? request.name_ar : request.name_en}</h3><p dir="ltr" className="mt-1 font-mono text-xs text-muted-foreground">{request.slug}</p><p className="mt-2 text-sm text-muted-foreground">{t('admin.category_request_by')}: {profile?.full_name ?? '—'}</p></div><Badge tone="warn">{t('admin.category_request_pending')}</Badge></CardHeader><CardBody className="flex flex-wrap items-start gap-3">
            <ActionForm action={reviewCategoryRequestAction.bind(null, request.id, 'approve')} submitLabel={t('admin.approve')} className="flex" />
            <ActionForm action={reviewCategoryRequestAction.bind(null, request.id, 'reject')} submitLabel={t('admin.reject')} variant="destructive" className="flex flex-1 flex-wrap gap-2"><Input name="reason" placeholder={t('admin.category_reject_reason')} aria-label={t('admin.category_reject_reason')} maxLength={500} /></ActionForm>
          </CardBody></Card>;
        }) : <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">{t('admin.no_category_requests')}</p>}
      </section>
      <section className="space-y-3"><h2 className="text-xl font-semibold">{t('admin.categories')}</h2>
        {cats?.map((c) => (
          <Card key={c.id}><CardBody className="flex flex-wrap items-start gap-2">
            <ActionForm action={saveCategoryAction.bind(null, c.id)} submitLabel={t('action.save')} variant="outline" className="flex flex-1 flex-wrap items-start gap-2">{fields(c)}</ActionForm>
            <form action={deleteCategoryAction.bind(null, c.id)}><ConfirmSubmit size="sm" variant="ghost" message={t('instr.confirm_delete')}>{t('action.delete')}</ConfirmSubmit></form>
          </CardBody></Card>
        ))}
        <Card><CardBody><ActionForm action={saveCategoryAction.bind(null, null)} submitLabel={t('admin.add_category')} resetOnSuccess className="flex flex-wrap items-start gap-2">{fields()}</ActionForm></CardBody></Card>
      </section>
    </div>
  );
}
