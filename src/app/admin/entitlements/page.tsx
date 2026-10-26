import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { grantAccessAction, revokeEntitlementAction } from '@/actions/admin';
import { ActionForm, Field } from '@/components/action-form';
import { ConfirmSubmit } from '@/components/form-bits';
import { Badge, Card, CardBody, CardHeader, Input, Select } from '@/components/ui/primitives';
import { formatDate } from '@/lib/utils';

export default async function AdminEntitlements() {
  const { admin } = await requirePermission('entitlements.manage');
  const { t, locale } = await getT();
  const [{ data: courses }, { data: ents }] = await Promise.all([
    admin.from('courses').select('id, title').in('status', ['published', 'archived']).order('title').limit(500),
    admin.from('entitlements').select('id, user_id, source, status, starts_at, expires_at, revoked_reason, courses(title), profiles:user_id(full_name)').order('created_at', { ascending: false }).limit(50),
  ]);
  const one = (x: any) => (Array.isArray(x) ? x[0] : x);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl">{t('admin.entitlements')}</h1>
      <Card><CardHeader><h2 className="text-lg">{t('admin.grant_access')}</h2></CardHeader><CardBody>
        <ActionForm action={grantAccessAction} submitLabel={t('admin.grant')} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
          <Field label={t('auth.email')} htmlFor="g-email"><Input id="g-email" name="email" type="email" required /></Field>
          <Field label={t('admin.course')} htmlFor="g-course"><Select id="g-course" name="courseId" required>{courses?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
          <Field label={t('instr.access_days')} htmlFor="g-days" hint={t('instr.access_days_hint')}><Input id="g-days" name="days" type="number" min="1" /></Field>
          <Field label={t('admin.note')} htmlFor="g-note"><Input id="g-note" name="note" maxLength={300} /></Field>
        </ActionForm>
      </CardBody></Card>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm"><thead className="bg-muted"><tr>{(['auth.full_name', 'admin.course', 'admin.source', 'instr.col_status', 'admin.expires'] as const).map((k) => <th key={k} className="p-3 text-start">{t(k)}</th>)}<th /></tr></thead>
          <tbody>{(ents ?? []).map((e: any) => (
            <tr key={e.id} className="border-t border-border"><td className="p-3">{one(e.profiles)?.full_name}</td><td className="p-3">{one(e.courses)?.title}</td><td className="p-3">{e.source}</td>
              <td className="p-3"><Badge tone={e.status === 'active' ? 'success' : 'danger'}>{e.status}</Badge></td><td className="p-3">{e.expires_at ? formatDate(e.expires_at, locale) : t('admin.lifetime')}</td>
              <td className="p-3 text-end">{e.status === 'active' && <form action={revokeEntitlementAction.bind(null, e.id)}><ConfirmSubmit size="sm" variant="outline" message={t('admin.confirm_revoke')}>{t('admin.revoke')}</ConfirmSubmit></form>}</td></tr>))}</tbody></table>
      </div>
    </div>
  );
}
