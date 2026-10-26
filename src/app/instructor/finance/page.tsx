import Link from 'next/link';
import { requireInstructor } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardBody, Input } from '@/components/ui/primitives';
import { ActionForm, Field } from '@/components/action-form';
import { requestInstructorPayoutAction } from '@/actions/finance';

export const metadata = { title: 'Instructor finance' };
export default async function InstructorFinancePage() {
  const { user } = await requireInstructor();
  const admin = createAdminClient();
  const [{ data: wallets }, { data: earnings }, { data: payouts }] = await Promise.all([
    admin.from('wallets').select('id,currency,balance_cents').eq('user_id', user.id).eq('is_platform', false).order('currency'),
    admin.from('instructor_earnings').select('id,net_cents,status,order_item_id,created_at').eq('instructor_id', user.id).order('created_at', { ascending: false }).limit(1000),
    admin.from('payout_requests').select('id,amount_cents,currency,status,payout_method,requested_at,reviewed_at,paid_at,transfer_reference,admin_note').eq('instructor_id', user.id).order('requested_at', { ascending: false }).limit(100),
  ]);
  const itemIds = (earnings ?? []).map((e) => e.order_item_id);
  const { data: orderItems } = itemIds.length ? await admin.from('order_items').select('id,order_id').in('id', itemIds) : { data: [] };
  const orderIds = (orderItems ?? []).map((i) => i.order_id);
  const { data: orders } = orderIds.length ? await admin.from('orders').select('id,currency,paid_at,status').in('id', orderIds) : { data: [] };
  const currencyByItem = new Map((orderItems ?? []).map((i) => [i.id, orders?.find((o) => o.id === i.order_id)?.currency ?? 'USD']));
  const byCurrency = new Map<string, { available: number; pending: number; paid: number }>();
  for (const earning of earnings ?? []) {
    const currency = currencyByItem.get(earning.order_item_id) ?? 'USD';
    const row = byCurrency.get(currency) ?? { available: 0, pending: 0, paid: 0 };
    if (earning.status === 'available') row.available += Number(earning.net_cents);
    else if (earning.status === 'pending') row.pending += Number(earning.net_cents);
    else if (earning.status === 'paid') row.paid += Number(earning.net_cents);
    byCurrency.set(currency, row);
  }
  const money = (n: number, c: string) => `${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
  return <div className="mx-auto max-w-5xl space-y-6"><Link href="/instructor" className="text-sm text-primary underline">← لوحة المدرس</Link><header><p className="font-mono text-xs tracking-widest text-arc">INSTRUCTOR FINANCE</p><h1 className="mt-2 text-3xl font-semibold">الأرباح والسحب المالي</h1><p className="mt-2 text-sm text-muted-foreground">الأرباح تمر بفترة مراجعة وتسوية مدتها 7 أيام. طلب السحب يحجز المبلغ حتى اعتماد الطلب، وإثبات التحويل الفعلي يسجله مسؤول المنصة.</p></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{(wallets ?? []).map((w) => { const row = byCurrency.get(w.currency) ?? { available: 0, pending: 0, paid: 0 }; return <Card key={w.id}><CardBody><p className="text-xs text-muted-foreground">رصيد المحفظة · {w.currency}</p><p className="mt-2 text-2xl font-semibold" dir="ltr">{money(Number(w.balance_cents),w.currency)}</p><p className="mt-3 text-xs text-muted-foreground">أرباح جاهزة للسحب: {money(row.available,w.currency)}</p><p className="text-xs text-muted-foreground">قيد التسوية: {money(row.pending,w.currency)}</p></CardBody></Card>; })}</div>
    <Card><CardBody><h2 className="mb-4 text-xl font-semibold">إنشاء طلب سحب</h2><ActionForm action={requestInstructorPayoutAction} submitLabel="إرسال طلب السحب" resetOnSuccess className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="المبلغ (الحد الأدنى 10)" htmlFor="amount"><Input id="amount" name="amount" type="number" min="10" max="1000000" step="0.01" required /></Field><Field label="العملة" htmlFor="currency"><select id="currency" name="currency" required defaultValue={wallets?.[0]?.currency ?? 'USD'} className="h-11 w-full rounded-md border border-border bg-background px-3">{(wallets ?? []).map((w) => <option key={w.currency} value={w.currency}>{w.currency}</option>)}</select></Field><Field label="طريقة الاستلام" htmlFor="method"><select id="method" name="method" defaultValue="bank_transfer" className="h-11 w-full rounded-md border border-border bg-background px-3"><option value="bank_transfer">تحويل بنكي</option><option value="paypal">PayPal</option><option value="wise">Wise</option><option value="other">طريقة أخرى</option></select></Field><Field label="اسم المستلم / الحساب" htmlFor="recipient"><Input id="recipient" name="recipient" minLength={3} maxLength={160} required placeholder="اسم صاحب الحساب" /></Field></div><Field label="بيانات التحويل المطلوبة" htmlFor="details"><Input id="details" name="details" maxLength={1000} required placeholder="البريد أو رقم الحساب/IBAN أو بيانات وسيلة الاستلام" /></Field><p className="text-xs text-muted-foreground">تُخزن بيانات الاستلام بشكل خاص لعرضها لمسؤول المالية فقط. لا تُدخل كلمات مرور أو رموز تحقق.</p></ActionForm></CardBody></Card>
    <section className="space-y-3"><h2 className="text-xl font-semibold">طلبات السحب</h2>{payouts?.length ? payouts.map((p) => <Card key={p.id}><CardBody className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{money(Number(p.amount_cents),p.currency)} · {p.payout_method}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(p.requested_at).toLocaleString('ar-EG')} · رقم الطلب {p.id}</p>{p.transfer_reference && <p className="mt-1 text-xs">مرجع التحويل: {p.transfer_reference}</p>}{p.admin_note && <p className="mt-1 text-xs text-muted-foreground">ملاحظة الإدارة: {p.admin_note}</p>}</div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' : p.status === 'rejected' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-600'}`}>{p.status === 'pending' ? 'قيد المراجعة' : p.status === 'approved' ? 'تم الاعتماد — بانتظار التحويل' : p.status === 'paid' ? 'مدفوع' : 'مرفوض'}</span></CardBody></Card>) : <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">لا توجد طلبات سحب حتى الآن.</p>}</section>
  </div>;
}
