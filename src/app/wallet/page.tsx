import { requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardBody } from '@/components/ui/primitives';

export const metadata = { title: 'Wallet' };
export default async function WalletPage() {
  const { user } = await requireUser('/wallet');
  const admin = createAdminClient();
  const [{ data: wallets }, { data: profile }] = await Promise.all([
    admin.from('wallets').select('id,currency,balance_cents,updated_at').eq('user_id', user.id).order('currency'),
    admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ]);
  const ids = (wallets ?? []).map((w) => w.id);
  const { data: transactions } = ids.length ? await admin.from('wallet_transactions').select('id,wallet_id,amount_cents,balance_after_cents,kind,description,created_at').in('wallet_id', ids).order('created_at', { ascending: false }).limit(50) : { data: [] };
  return <div className="mx-auto max-w-4xl space-y-6"><header><p className="font-mono text-xs tracking-widest text-arc">ACCOUNT FINANCE</p><h1 className="mt-2 text-3xl font-semibold">المحفظة المالية</h1><p className="mt-2 text-sm text-muted-foreground">{profile?.full_name ?? user.email} — رصيدك وسجل الحركات المالية.</p></header>
    <div className="grid gap-3 sm:grid-cols-2">{wallets?.length ? wallets.map((w) => <Card key={w.id}><CardBody><p className="text-sm text-muted-foreground">الرصيد المتاح · {w.currency}</p><p className="mt-2 text-3xl font-semibold tabular-nums" dir="ltr">{(Number(w.balance_cents) / 100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} {w.currency}</p></CardBody></Card>) : <Card><CardBody><p>لا يوجد رصيد بعد. يمكن لمسؤول المنصة إضافة رصيد إلى حسابك.</p></CardBody></Card>}</div>
    <section className="space-y-3"><h2 className="text-xl font-semibold">سجل المعاملات</h2><div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-start">التاريخ</th><th className="p-3 text-start">الوصف</th><th className="p-3 text-start">الحركة</th><th className="p-3 text-start">الرصيد بعد الحركة</th></tr></thead><tbody>{transactions?.map((tx) => { const w = wallets?.find((item) => item.id === tx.wallet_id); return <tr key={tx.id} className="border-t border-border"><td className="whitespace-nowrap p-3">{new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(new Date(tx.created_at))}</td><td className="p-3">{tx.description || tx.kind}</td><td className={`p-3 font-semibold ${tx.amount_cents > 0 ? 'text-emerald-600' : 'text-red-500'}`} dir="ltr">{tx.amount_cents > 0 ? '+' : ''}{(Number(tx.amount_cents)/100).toFixed(2)} {w?.currency}</td><td className="p-3" dir="ltr">{(Number(tx.balance_after_cents)/100).toFixed(2)} {w?.currency}</td></tr>; })}</tbody></table>{!transactions?.length && <p className="p-5 text-sm text-muted-foreground">لا توجد معاملات حتى الآن.</p>}</div></section>
  </div>;
}
