import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { Input } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

const PAGE = 50;

export default async function AdminAudit({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const { supabase } = await requirePermission('audit.read'); // read through RLS (audit.read)
  const { t } = await getT();
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const action = (sp.action ?? '').replace(/[^a-z._]/g, '').slice(0, 60);
  let q = supabase.from('audit_logs').select('id, actor_id, action, entity_type, entity_id, metadata, created_at', { count: 'exact' }).order('created_at', { ascending: false });
  if (action) q = q.ilike('action', `${action}%`);
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  return (
    <div className="space-y-4">
      <h1 className="text-3xl">{t('admin.audit')}</h1>
      <form className="flex gap-2"><Input name="action" defaultValue={action} placeholder="security., course., entitlement." className="max-w-sm" aria-label={t('admin.action_filter')} dir="ltr" /><Button variant="outline">{t('catalog.apply')}</Button></form>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-xs" dir="ltr"><thead className="bg-muted"><tr><th className="p-2 text-start">time</th><th className="p-2 text-start">action</th><th className="p-2 text-start">actor</th><th className="p-2 text-start">entity</th><th className="p-2 text-start">metadata</th></tr></thead>
          <tbody>{(data ?? []).map((r) => (
            <tr key={r.id} className="border-t border-border align-top"><td className="whitespace-nowrap p-2">{new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19)}</td><td className="p-2 font-medium">{r.action}</td><td className="p-2 font-mono">{r.actor_id?.slice(0, 8)}</td><td className="p-2">{r.entity_type} {r.entity_id?.slice(0, 8)}</td><td className="max-w-xs break-all p-2 text-muted-foreground">{JSON.stringify(r.metadata)}</td></tr>))}</tbody></table>
      </div>
      {pages > 1 && <div className="flex items-center gap-4 text-sm">{page > 1 && <Link className="text-primary underline" href={`/admin/audit?action=${action}&page=${page - 1}`}>{t('action.previous')}</Link>}<span>{page}/{pages}</span>{page < pages && <Link className="text-primary underline" href={`/admin/audit?action=${action}&page=${page + 1}`}>{t('action.next')}</Link>}</div>}
    </div>
  );
}
