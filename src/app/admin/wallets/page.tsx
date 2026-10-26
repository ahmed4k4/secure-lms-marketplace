import { requirePermission } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionForm, Field } from '@/components/action-form';
import { Input } from '@/components/ui/primitives';
import { creditWalletAction } from '@/actions/wallet';
export const metadata = { title: 'Wallet management' };
export default async function AdminWalletsPage() {
  await requirePermission('users.manage');
  const admin = createAdminClient();
  const { data: profiles, error } = await admin.from('profiles').select('id,full_name,avatar_url').order('full_name').limit(300);
  const { data: wallets } = await admin.from('wallets').select('user_id,currency,balance_cents').eq('is_platform', false);
  const byUser = new Map((wallets ?? []).map((w) => [`${w.user_id}:${w.currency}`, w]));
  return <div className="mx-auto max-w-5xl space-y-6"><header><p className="font-mono text-xs tracking-widest text-arc">FINANCE CONTROL</p><h1 className="mt-2 text-3xl font-semibold">إدارة المحافظ والأرصدة</h1><p className="mt-2 text-sm text-muted-foreground">شحن أرصدة الطلاب والمدرسين بالدولار الأمريكي أو عملة محددة. كل عملية تُسجل في دفتر مالي غير قابل للتعديل من الواجهة.</p></header>
    <section className="rounded-xl border border-border p-5"><h2 className="mb-4 text-xl font-semibold">إضافة رصيد</h2><ActionForm action={creditWalletAction} submitLabel="إضافة الرصيد"><Field label="الحساب" htmlFor="userId"><select id="userId" name="userId" required className="h-11 w-full rounded-md border border-border bg-background px-3">{profiles?.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.id} — {p.id}</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-3"><Field label="المبلغ" htmlFor="amount"><Input id="amount" name="amount" type="number" min="0.01" max="1000000" step="0.01" required /></Field><Field label="العملة" htmlFor="currency"><select id="currency" name="currency" defaultValue="USD" className="h-11 w-full rounded-md border border-border bg-background px-3"><option value="USD">USD</option><option value="EGP">EGP</option><option value="EUR">EUR</option><option value="SAR">SAR</option></select></Field><Field label="السبب / ملاحظة" htmlFor="description"><Input id="description" name="description" maxLength={300} placeholder="تعويض، منحة، شحن..." /></Field></div></ActionForm></section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">أرصدة الحسابات</h2>{error && <p role="alert" className="text-sm text-red-500">تعذر تحميل الحسابات: {error.message}</p>}<div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-start">الحساب</th><th className="p-3 text-start">USD</th><th className="p-3 text-start">EGP</th><th className="p-3 text-start">EUR</th><th className="p-3 text-start">SAR</th></tr></thead><tbody>{profiles?.map((p) => <tr key={p.id} className="border-t border-border"><td className="p-3">{p.full_name || '—'}<p className="font-mono text-xs text-muted-foreground">{p.id}</p></td>{['USD','EGP','EUR','SAR'].map((c) => <td key={c} className="p-3 tabular-nums" dir="ltr">{((Number(byUser.get(`${p.id}:${c}`)?.balance_cents ?? 0))/100).toFixed(2)}</td>)}</tr>)}</tbody></table></div></section>
  </div>;
}
