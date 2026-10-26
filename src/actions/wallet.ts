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
