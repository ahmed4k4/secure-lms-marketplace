'use server';
import { revalidatePath } from 'next/cache';
import { requireInstructor, requirePermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import type { ActionState } from '@/lib/validation';

export async function requestInstructorPayoutAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireInstructor();
  const amount = Number(formData.get('amount') ?? 0);
  const currency = String(formData.get('currency') ?? 'USD').toUpperCase();
  const method = String(formData.get('method') ?? 'bank_transfer');
  const recipient = String(formData.get('recipient') ?? '').trim().slice(0, 160);
  const details = String(formData.get('details') ?? '').trim().slice(0, 1000);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000 || !/^[A-Z]{3}$/.test(currency) || !['bank_transfer','paypal','wise','other'].includes(method) || recipient.length < 3) {
    return { error: 'تحقق من المبلغ والعملة وطريقة السحب وبيانات المستلم.' };
  }
  const { data, error } = await supabase.rpc('create_instructor_payout', {
    p_amount_cents: Math.round(amount * 100), p_currency: currency, p_method: method,
    p_details: { recipient, details },
  });
  if (error) {
    const msg = /insufficient_balance/.test(error.message) ? 'رصيد المحفظة غير كافٍ.'
      : /insufficient_settled_earnings/.test(error.message) ? 'المبلغ يتجاوز الأرباح التي تمت تسويتها وإتاحتها للسحب.'
      : /invalid_payout/.test(error.message) ? 'بيانات طلب السحب غير صالحة.' : 'تعذر إنشاء طلب السحب.';
    return { error: msg };
  }
  await audit({ actorId: user.id, action: 'payout.requested', entityType: 'payout_request', entityId: String(data), metadata: { amount, currency, method } });
  revalidatePath('/instructor/finance'); revalidatePath('/wallet'); revalidatePath('/admin/finance');
  return { ok: true, message: 'تم حجز المبلغ وإرسال طلب السحب للمراجعة. ستظهر حالة الطلب هنا.' };
}

export async function reviewPayoutAction(payoutId: string, decision: 'approve' | 'reject' | 'paid', _: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, user } = await requirePermission('users.manage');
  const note = String(formData.get('note') ?? '').trim().slice(0, 1000);
  const transferReference = String(formData.get('transferReference') ?? '').trim().slice(0, 200);
  const { error } = await admin.rpc('review_payout_request', {
    p_payout_id: payoutId, p_decision: decision, p_actor_id: user.id,
    p_note: note || null, p_transfer_reference: transferReference || null,
  });
  if (error) {
    const message = /payout_not_approved/.test(error.message) ? 'يجب اعتماد طلب السحب قبل تسجيل الدفع.'
      : /transfer_reference_required/.test(error.message) ? 'أدخل مرجع التحويل الفعلي قبل تسجيل الدفع.'
      : /payout_not_pending|payout_not_rejectable/.test(error.message) ? 'حالة طلب السحب تغيرت بالفعل.' : 'تعذر تحديث طلب السحب.';
    return { error: message };
  }
  await audit({ actorId: user.id, action: `payout.${decision}`, entityType: 'payout_request', entityId: payoutId, metadata: { transferReference: transferReference || null } });
  revalidatePath('/admin/finance'); revalidatePath('/instructor/finance'); revalidatePath('/wallet');
  return { ok: true, message: decision === 'paid' ? 'تم تسجيل التحويل المالي الخارجي كمدفوع.' : decision === 'approve' ? 'تم اعتماد طلب السحب؛ نفّذ التحويل خارج المنصة ثم سجله كمدفوع.' : 'تم رفض الطلب وإرجاع المبلغ إلى محفظة المدرس.' };
}

export async function reviewRefundAction(refundId: string, decision: 'approve' | 'reject', _: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, user } = await requirePermission('users.manage');
  const note = String(formData.get('note') ?? '').trim().slice(0, 500);
  const providerReference = String(formData.get('providerRefundReference') ?? '').trim().slice(0, 200);
  const { data: refund, error: readError } = await admin.from('refunds').select('id,order_id,status,amount_cents,currency').eq('id', refundId).maybeSingle();
  if (readError || !refund || refund.status !== 'pending') return { error: 'طلب الاسترداد غير موجود أو تمت مراجعته بالفعل.' };
  const { data: order, error: orderError } = await admin.from('orders').select('id,user_id,status,provider,total_cents,currency').eq('id', refund.order_id).maybeSingle();
  if (orderError || !order || order.status !== 'paid' || Number(order.total_cents) !== Number(refund.amount_cents)) return { error: 'الطلب غير مدفوع أو قيمة الاسترداد لا تطابق إجمالي الطلب.' };
  if (decision === 'reject') {
    const { error } = await admin.from('refunds').update({ status: 'failed', reviewed_by: user.id, reviewed_at: new Date().toISOString(), failure_reason: note || 'Declined by finance administrator' }).eq('id', refundId).eq('status', 'pending');
    if (error) return { error: 'تعذر رفض طلب الاسترداد.' };
  } else if (order.provider === 'wallet') {
    const { error } = await admin.rpc('process_wallet_refund', { p_refund_id: refundId, p_actor_id: user.id });
    if (error) {
      const message = /seller_balance_insufficient/.test(error.message) ? 'تعذر الاسترداد آليًا: رصيد المدرس المتاح أقل من قيمة حصته. أوقف الصرف وراجع الحالة يدويًا.'
        : /platform_balance_insufficient/.test(error.message) ? 'تعذر الاسترداد آليًا: رصيد المنصة غير كافٍ.'
        : /external_provider_refund_required/.test(error.message) ? 'هذا الطلب ليس مدفوعًا من المحفظة؛ يجب تنفيذ الاسترداد من بوابة الدفع الأصلية.'
        : /refund_payout_allocated_requires_manual_review/.test(error.message) ? 'تم حجز أرباح هذا الطلب أو صرفها ضمن طلب سحب؛ لا يمكن عكسه آليًا. جمّد التسوية وراجع استرداد رصيد المدرس يدويًا قبل المتابعة.'
        : /refund_amount_not_supported|refund_multi_item_order_unsupported/.test(error.message) ? 'الاسترداد الآلي يدعم كامل الطلب الذي يحتوي كورسًا واحدًا فقط.' : 'تعذر تنفيذ الاسترداد الآلي.';
      await admin.from('refunds').update({ failure_reason: message }).eq('id', refundId);
      return { error: message };
    }
  } else {
    // For a non-wallet provider, require the finance operator to execute the refund at that provider first.
    if (providerReference.length < 3) return { error: 'نفّذ الاسترداد في بوابة الدفع الأصلية أولًا، ثم أدخل مرجع الاسترداد لتوثيق النتيجة.' };
    const { error } = await admin.rpc('record_external_refund', { p_refund_id: refundId, p_actor_id: user.id, p_provider_refund_id: providerReference, p_note: note || null });
    if (error) {
      const message = /provider_refund_reference_required/.test(error.message) ? 'مرجع الاسترداد الخارجي غير صالح.'
        : /refund_multi_item_order_unsupported/.test(error.message) ? 'التوثيق اليدوي يدعم حاليًا طلبًا يحتوي كورسًا واحدًا فقط.'
        : /refund_not_pending/.test(error.message) ? 'تمت مراجعة طلب الاسترداد بالفعل.'
        : /refund_payout_allocated_requires_manual_review/.test(error.message) ? 'تم حجز أرباح الطلب ضمن عملية سحب أو صُرفت بالفعل؛ أوقف الإجراء وراجع التسوية يدويًا قبل تأكيد الاسترداد.'
        : /refund_amount_not_supported/.test(error.message) ? 'قيمة الطلب لا تطابق قيمة الاسترداد.'
        : /external_provider_refund_required/.test(error.message) ? 'هذا الطلب لا ينتمي إلى مزود دفع خارجي.' : 'تعذر توثيق الاسترداد الخارجي. تأكد أن المرجع لم يُستخدم من قبل.';
      return { error: message };
    }
  }
  await audit({ actorId: user.id, action: `refund.${decision}`, entityType: 'refund', entityId: refundId, metadata: { orderId: refund.order_id, amountCents: refund.amount_cents, currency: refund.currency, providerReference: providerReference || null, note } });
  revalidatePath('/admin/finance'); revalidatePath('/wallet'); revalidatePath('/dashboard');
  return { ok: true, message: decision === 'approve' ? (order.provider === 'wallet' ? 'تم الاسترداد وإبطال صلاحية الكورس المرتبط بالطلب.' : 'تم توثيق الاسترداد الخارجي وإلغاء الوصول. التوثيق لا ينفّذ عملية الدفع بنفسه.') : 'تم رفض الطلب مع حفظ سبب الرفض.' };
}

export async function runSettlementAction(previousState: ActionState, formData: FormData): Promise<ActionState> {
  // This action does not need submitted fields, but the ActionForm contract provides them.
  void previousState;
  void formData;
  const { admin, user } = await requirePermission('users.manage');
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc('settle_instructor_earnings', { p_cutoff: cutoff, p_actor_id: user.id });
  if (error) return { error: 'تعذر تشغيل التسوية المالية. راجع سجلات قاعدة البيانات.' };
  await audit({ actorId: user.id, action: 'finance.settlement_run', entityType: 'financial_reconciliation', metadata: { cutoff, result: data } });
  revalidatePath('/admin/finance'); revalidatePath('/instructor/finance');
  return { ok: true, message: `اكتملت التسوية الدورية. تاريخ الاستحقاق: ${new Date(cutoff).toLocaleDateString('ar-EG')}.` };
}
