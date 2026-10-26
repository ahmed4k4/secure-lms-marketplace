import { requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardBody, Input } from '@/components/ui/primitives';
import { ActionForm, Field } from '@/components/action-form';
import { requestRefundAction, cancelWalletSubscriptionAction } from '@/actions/wallet';

export const metadata = { title: 'Wallet' };
export default async function WalletPage() {
  const { user } = await requireUser('/wallet');
  const admin = createAdminClient();
  const [{ data: wallets }, { data: profile }, { data: orders }, { data: subscriptions }] = await Promise.all([
    admin.from('wallets').select('id,currency,balance_cents,updated_at').eq('user_id', user.id).order('currency'),
    admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    admin.from('orders').select('id,status,currency,total_cents,provider,created_at,paid_at,order_items(id,products(title))').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
    admin.from('subscriptions').select('id,status,current_period_end,cancel_at_period_end,provider,created_at,pricing_plans(billing_interval,products(title))').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
  ]);
  const ids = (wallets ?? []).map((w) => w.id);
  const { data: transactions } = ids.length ? await admin.from('wallet_transactions').select('id,wallet_id,amount_cents,balance_after_cents,kind,description,created_at').in('wallet_id', ids).order('created_at', { ascending: false }).limit(50) : { data: [] };
  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: refunds } = orderIds.length ? await admin.from('refunds').select('id,order_id,status,reason,created_at,failure_reason').in('order_id', orderIds).order('created_at', { ascending: false }) : { data: [] };
  const latestRefund = new Map<string, any>();
  for (const refund of refunds ?? []) if (!latestRefund.has(refund.order_id)) latestRefund.set(refund.order_id, refund as never);
  const money = (cents: number | string, currency: string) => `${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  return <div className="mx-auto max-w-5xl space-y-8">
    <header><p className="font-mono text-xs tracking-widest text-arc">ACCOUNT FINANCE</p><h1 className="mt-2 text-3xl font-semibold">المحفظة المالية</h1><p className="mt-2 text-sm text-muted-foreground">{profile?.full_name ?? user.email} — الأرصدة وحركة الشراء والاشتراكات وطلبات الاسترداد.</p></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{wallets?.length ? wallets.map((w) => <Card key={w.id}><CardBody><p className="text-sm text-muted-foreground">الرصيد المتاح · {w.currency}</p><p className="mt-2 text-3xl font-semibold tabular-nums" dir="ltr">{money(w.balance_cents, w.currency)}</p></CardBody></Card>) : <Card><CardBody><p>لا يوجد رصيد بعد. يمكن لمسؤول المنصة إضافة رصيد إلى حسابك.</p></CardBody></Card>}</div>

    <section className="space-y-3"><h2 className="text-xl font-semibold">اشتراكات الكورسات</h2><div className="space-y-3">{(subscriptions ?? []).length ? subscriptions!.map((sub) => {
      const plan: any = Array.isArray(sub.pricing_plans) ? sub.pricing_plans[0] : sub.pricing_plans;
      const product: any = plan && (Array.isArray(plan.products) ? plan.products[0] : plan.products);
      return <Card key={sub.id}><CardBody className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-semibold">{product?.title ?? 'اشتراك كورس'}</p><p className="mt-1 text-sm text-muted-foreground">الحالة: {sub.status === 'active' ? 'نشط' : sub.status === 'past_due' ? 'متأخر — يلزم شحن المحفظة' : sub.status === 'canceled' ? 'ملغي' : sub.status}</p><p className="mt-1 text-xs text-muted-foreground">ينتهي/يتجدد: {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('ar-EG') : '—'}{sub.cancel_at_period_end ? ' · لن يتم التجديد' : ''}</p></div>
        {sub.status === 'active' && sub.provider === 'wallet' && !sub.cancel_at_period_end && <ActionForm action={cancelWalletSubscriptionAction} submitLabel="إلغاء التجديد التلقائي" variant="outline" className="min-w-56"><input type="hidden" name="subscriptionId" value={sub.id} /><p className="text-xs text-muted-foreground">يستمر وصولك حتى نهاية الفترة المدفوعة الحالية.</p></ActionForm>}
      </CardBody></Card>;
    }) : <Card><CardBody><p className="text-sm text-muted-foreground">لا توجد اشتراكات حتى الآن.</p></CardBody></Card>}</div></section>

    <section className="space-y-3"><h2 className="text-xl font-semibold">طلبات الشراء والاسترداد</h2><div className="space-y-3">{(orders ?? []).length ? orders!.map((order) => {
      const item: any = Array.isArray(order.order_items) ? order.order_items[0] : order.order_items;
      const product: any = item && (Array.isArray(item.products) ? item.products[0] : item.products);
      const refund: any = latestRefund.get(order.id);
      return <Card key={order.id}><CardBody className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{product?.title ?? 'طلب شراء'}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString('ar-EG')} · {order.provider ?? 'بوابة دفع'}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{order.id}</p></div><div className="text-end"><p dir="ltr" className="font-semibold">{money(order.total_cents, order.currency)}</p><p className="mt-1 text-xs text-muted-foreground">{order.status === 'paid' ? 'مدفوع' : order.status === 'refunded' ? 'مسترد' : order.status}</p></div></div>
        {refund && <div className="rounded-md border border-border p-3 text-sm"><p>طلب الاسترداد: {refund.status === 'pending' ? 'قيد المراجعة' : refund.status === 'succeeded' ? 'تم الاسترداد' : 'مرفوض/لم يكتمل'}</p>{refund.failure_reason && <p className="mt-1 text-xs text-muted-foreground">{refund.failure_reason}</p>}</div>}
        {order.status === 'paid' && (!refund || !['pending','succeeded'].includes(refund.status)) && <ActionForm action={requestRefundAction} submitLabel="طلب استرداد كامل" variant="outline" className="space-y-2"><input type="hidden" name="orderId" value={order.id} /><Field label="سبب الاسترداد" htmlFor={`refund-reason-${order.id}`}><Input id={`refund-reason-${order.id}`} name="reason" minLength={5} maxLength={500} required placeholder="اشرح سبب الطلب باختصار" /></Field><p className="text-xs text-muted-foreground">{order.provider === 'wallet' ? 'بعد موافقة الإدارة يُعاد المبلغ إلى المحفظة وتُلغى صلاحية الكورس.' : 'الطلبات الخارجية تحتاج مراجعة الإدارة وتنفيذ الاسترداد في مزود الدفع الأصلي. قد تُلغى صلاحية الكورس بعد التوثيق.'} يدعم الطلب الحالي شراء كورس واحد فقط.</p></ActionForm>}
      </CardBody></Card>;
    }) : <Card><CardBody><p className="text-sm text-muted-foreground">لا توجد طلبات شراء مسجلة.</p></CardBody></Card>}</div></section>

    <section className="space-y-3"><h2 className="text-xl font-semibold">سجل المعاملات المالية</h2><div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-start">التاريخ</th><th className="p-3 text-start">الوصف</th><th className="p-3 text-start">الحركة</th><th className="p-3 text-start">الرصيد بعد الحركة</th></tr></thead><tbody>{transactions?.map((tx) => { const w = wallets?.find((item) => item.id === tx.wallet_id); return <tr key={tx.id} className="border-t border-border"><td className="whitespace-nowrap p-3">{new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(new Date(tx.created_at))}</td><td className="p-3">{tx.description || tx.kind}</td><td className={`p-3 font-semibold ${tx.amount_cents > 0 ? 'text-emerald-600' : 'text-red-500'}`} dir="ltr">{tx.amount_cents > 0 ? '+' : ''}{money(tx.amount_cents, w?.currency ?? '')}</td><td className="p-3" dir="ltr">{money(tx.balance_after_cents, w?.currency ?? '')}</td></tr>; })}</tbody></table>{!transactions?.length && <p className="p-5 text-sm text-muted-foreground">لا توجد معاملات حتى الآن.</p>}</div></section>
  </div>;
}
