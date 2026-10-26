'use server';
import { revalidatePath } from 'next/cache';
import { requireUser, requirePermission } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import type { ActionState } from '@/lib/validation';

export async function buyCourseWithWalletAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const planId = String(formData.get('planId') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return { error: 'اختيار الخطة غير صالح.' };
  const { error } = await supabase.rpc('purchase_course_with_wallet', { p_plan_id: planId });
  if (error) {
    const message = /insufficient_balance/.test(error.message) ? 'رصيد المحفظة غير كافٍ.'
      : /already_enrolled/.test(error.message) ? 'أنت مسجل بالفعل في هذا الكورس.'
      : /cannot_buy_own_course/.test(error.message) ? 'لا يمكنك شراء كورسك الخاص.'
      : /course_unavailable|plan_not_purchasable/.test(error.message) ? 'الكورس أو خطة السعر غير متاحة.' : 'تعذر إتمام الشراء من المحفظة.';
    return { error: message };
  }
  revalidatePath('/wallet'); revalidatePath('/dashboard'); revalidatePath('/courses');
  return { ok: true, message: 'تم الشراء بنجاح وإضافة الكورس إلى حسابك.' };
}

export async function creditWalletAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, user } = await requirePermission('users.manage');
  const userId = String(formData.get('userId') ?? '');
  const amount = Number(formData.get('amount') ?? 0);
  const currency = String(formData.get('currency') ?? 'USD').toUpperCase();
  const description = String(formData.get('description') ?? '').trim().slice(0, 300);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000 || !/^[A-Z]{3}$/.test(currency)) return { error: 'تحقق من بيانات شحن المحفظة.' };
  const { data: profile } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (!profile) return { error: 'الحساب غير موجود.' };
  const { error } = await admin.rpc('admin_credit_wallet', { p_user_id: userId, p_amount_cents: Math.round(amount * 100), p_currency: currency, p_description: description || 'Admin wallet credit', p_actor_id: user.id });
  if (error) { console.error('[wallet.credit]', error.message); return { error: 'تعذر إضافة الرصيد.' }; }
  await audit({ actorId: user.id, action: 'wallet.admin_credit', entityType: 'user', entityId: userId, metadata: { amount, currency } });
  revalidatePath('/admin/wallets'); revalidatePath('/wallet');
  return { ok: true, message: 'تمت إضافة الرصيد بنجاح.' };
}

export async function buySubscriptionWithWalletAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const planId = String(formData.get('planId') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return { error: 'اختيار الاشتراك غير صالح.' };
  const { error } = await supabase.rpc('purchase_subscription_with_wallet', { p_plan_id: planId });
  if (error) {
    const message = /insufficient_balance/.test(error.message) ? 'رصيد المحفظة غير كافٍ للاشتراك.'
      : /subscription_already_active/.test(error.message) ? 'لديك اشتراك فعال بالفعل في هذا الكورس.'
      : /cannot_buy_own_course/.test(error.message) ? 'لا يمكنك الاشتراك في كورسك الخاص.'
      : /course_unavailable|plan_not_purchasable/.test(error.message) ? 'الكورس أو خطة الاشتراك غير متاحة.' : 'تعذر تفعيل الاشتراك من المحفظة.';
    return { error: message };
  }
  revalidatePath('/wallet'); revalidatePath('/dashboard'); revalidatePath('/courses');
  return { ok: true, message: 'تم تفعيل الاشتراك من المحفظة. سيتم تجديده تلقائيًا عند حلول الموعد ما دام الرصيد كافيًا.' };
}

export async function requestRefundAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireUser('/wallet');
  const orderId = String(formData.get('orderId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || reason.length < 5) return { error: 'اختر طلبًا صالحًا واكتب سبب الاسترداد (5 أحرف على الأقل).' };
  const admin = createAdminClient();
  const { data: order } = await admin.from('orders').select('id,user_id,status,provider,total_cents,currency,order_items(id,product_id,plan_id)').eq('id', orderId).eq('user_id', user.id).maybeSingle();
  if (!order || order.status !== 'paid' || !order.provider) return { error: 'هذا الطلب غير قابل لطلب الاسترداد.' };
  if ((order.order_items ?? []).length !== 1) return { error: 'طلبات الاسترداد متاحة حاليًا للطلبات التي تحتوي كورسًا واحدًا فقط.' };
  const { data: old } = await admin.from('refunds').select('id,status').eq('order_id', orderId).in('status', ['pending', 'succeeded']).maybeSingle();
  if (old) return { error: old.status === 'pending' ? 'يوجد طلب استرداد قيد المراجعة بالفعل.' : 'تم استرداد هذا الطلب من قبل.' };
  const { error } = await admin.from('refunds').insert({ order_id: orderId, amount_cents: order.total_cents, currency: order.currency, reason, requested_by: user.id });
  if (error) return { error: 'تعذر إنشاء طلب الاسترداد. حدّث الصفحة وحاول مرة أخرى.' };
  await audit({ actorId: user.id, action: 'refund.requested', entityType: 'order', entityId: orderId, metadata: { amountCents: order.total_cents, currency: order.currency } });
  revalidatePath('/wallet'); revalidatePath('/admin/finance');
  return { ok: true, message: order.provider === 'wallet' ? 'تم إرسال طلب الاسترداد إلى إدارة المنصة للمراجعة. سيُعاد رصيد المحفظة إذا تمت الموافقة.' : 'تم إرسال طلب الاسترداد إلى الإدارة. للمدفوعات الخارجية يلزم تنفيذ الاسترداد في مزود الدفع الأصلي قبل تسجيل مرجعه.' };
}

export async function cancelWalletSubscriptionAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser('/wallet');
  const subscriptionId = String(formData.get('subscriptionId') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) return { error: 'رقم الاشتراك غير صالح.' };
  const { data: subscription, error: readError } = await supabase.from('subscriptions').select('id,status,provider,cancel_at_period_end,current_period_end').eq('id', subscriptionId).eq('user_id', user.id).maybeSingle();
  if (readError || !subscription || subscription.provider !== 'wallet' || subscription.status !== 'active') return { error: 'لم يتم العثور على اشتراك نشط يمكن إلغاؤه.' };
  if (subscription.cancel_at_period_end) return { ok: true, message: 'تم تسجيل إلغاء التجديد بالفعل.' };
  const { error } = await supabase.from('subscriptions').update({ cancel_at_period_end: true }).eq('id', subscriptionId).eq('user_id', user.id);
  if (error) return { error: 'تعذر إلغاء التجديد التلقائي.' };
  await audit({ actorId: user.id, action: 'subscription.cancel_at_period_end', entityType: 'subscription', entityId: subscriptionId });
  revalidatePath('/wallet');
  return { ok: true, message: `تم إلغاء التجديد التلقائي. يظل الوصول متاحًا حتى ${new Date(subscription.current_period_end ?? Date.now()).toLocaleDateString('ar-EG')}.` };
}
