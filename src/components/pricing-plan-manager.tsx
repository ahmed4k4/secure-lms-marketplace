"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Plan = { id: string; name_en: string; name_ar: string; currency: string; amount_minor: number | string; amount: number; billing_period: "one_time" | "monthly" | "yearly"; access_duration: "lifetime" | "fixed_days" | "subscription_period"; access_days: number | null; trial_days: number; is_active: boolean };
type Draft = { nameEn: string; nameAr: string; currency: "EGP" | "USD" | "SAR" | "AED" | "EUR"; amount: string; billingPeriod: "one_time" | "monthly" | "yearly"; accessDuration: "lifetime" | "fixed_days" | "subscription_period"; accessDays: string; trialDays: string; isActive: boolean };
const freshDraft = (): Draft => ({ nameEn: "Full course access", nameAr: "الوصول الكامل للكورس", currency: "EGP", amount: "0", billingPeriod: "one_time", accessDuration: "lifetime", accessDays: "30", trialDays: "0", isActive: true });

export function PricingPlanManager({ courseId, locale }: { courseId: string; locale: string }) {
  const ar = locale === "ar";
  const [plans, setPlans] = useState<Plan[]>([]);
  const [draft, setDraft] = useState<Draft>(freshDraft());
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loaded, setLoaded] = useState(false);
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const request = useCallback(async () => {
    const response = await fetch(`/api/courses/${courseId}/pricing`, { cache: "no-store" });
    const data = await response.json() as { plans?: Plan[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Could not load pricing");
    setPlans(data.plans ?? []);
  }, [courseId]);
  useEffect(() => { let active = true; void (async () => { try { await request(); } catch (e) { if (active) setError(e instanceof Error ? e.message : "Could not load pricing"); } finally { if (active) { setLoading(false); setLoaded(true); } } })(); return () => { active = false; }; }, [request]);
  function startEdit(plan: Plan) {
    setEditingId(plan.id);
    setDraft({ nameEn: plan.name_en, nameAr: plan.name_ar, currency: plan.currency as Draft["currency"], amount: String(plan.amount), billingPeriod: plan.billing_period, accessDuration: plan.access_duration, accessDays: String(plan.access_days ?? 30), trialDays: String(plan.trial_days ?? 0), isActive: plan.is_active });
    setError(""); setSuccess("");
  }
  function reset() { setEditingId(""); setDraft(freshDraft()); setError(""); setSuccess(""); }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((old) => ({ ...old, [key]: value, ...(key === "billingPeriod" ? { accessDuration: value === "one_time" ? "lifetime" : "subscription_period" } : {}) })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess(""); setBusy(true);
    try {
      const response = await fetch(`/api/courses/${courseId}/pricing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(editingId ? { planId: editingId } : {}), nameEn: draft.nameEn, nameAr: draft.nameAr, currency: draft.currency, amount: Number(draft.amount), billingPeriod: draft.billingPeriod, accessDuration: draft.accessDuration, ...(draft.accessDuration === "fixed_days" ? { accessDays: Number(draft.accessDays) } : {}), trialDays: Number(draft.trialDays), isActive: draft.isActive }) });
      const data = await response.json() as { error?: string; issues?: Array<{ message: string }> };
      if (!response.ok) throw new Error(data.issues?.[0]?.message || data.error || "Could not save pricing plan");
      await request(); reset(); setSuccess(t("Pricing plan saved. No payment is collected in Phase 1.", "تم حفظ خطة السعر. لا يتم تحصيل أي مدفوعات في المرحلة الأولى."));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save pricing plan"); }
    finally { setBusy(false); }
  }
  async function deactivate(planId: string) {
    if (!window.confirm(t("Deactivate this pricing plan? Existing entitlements are not deleted.", "هل تريد إيقاف خطة السعر؟ لن يتم حذف صلاحيات الوصول الحالية."))) return;
    setBusy(true); setError(""); setSuccess("");
    try { const response = await fetch(`/api/courses/${courseId}/pricing`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || "Could not deactivate plan"); await request(); setSuccess(t("Pricing plan deactivated.", "تم إيقاف خطة السعر.")); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not deactivate plan"); } finally { setBusy(false); }
  }
  const money = (plan: Plan) => new Intl.NumberFormat(locale, { style: "currency", currency: plan.currency, maximumFractionDigits: 2 }).format(Number(plan.amount_minor) / 100);
  return <section className="panel pricing-manager" aria-labelledby="pricing-heading">
    <div className="dashboard-head"><div><span className="eyebrow">{t("MONETIZATION", "تحقيق الدخل")}</span><h2 id="pricing-heading">{t("Pricing & access", "الأسعار وطرق الوصول")}</h2><p className="muted">{t("Set free access, one-time lifetime access, or recurring membership pricing. Payment processing remains disabled until Phase 2.", "حدد الوصول المجاني أو شراء مرة واحدة أو الاشتراكات الدورية. تحصيل المدفوعات معطّل حتى المرحلة الثانية.")}</p></div></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}{success && <div className="notice" role="status">{success}</div>}
    {loading ? <div className="empty">{t("Loading pricing plans…", "جارٍ تحميل خطط الأسعار…")}</div> : <div className="pricing-plan-list">{plans.length === 0 ? <div className="empty">{t("No plans yet. Add a free or paid plan below.", "لا توجد خطط بعد. أضف خطة مجانية أو مدفوعة أدناه.")}</div> : plans.map((plan) => <article className="pricing-plan-row" key={plan.id}><div><strong>{ar ? plan.name_ar : plan.name_en}</strong><p className="muted">{money(plan)} · {plan.billing_period === "one_time" ? t("one-time", "مرة واحدة") : plan.billing_period === "monthly" ? t("monthly", "شهريًا") : t("yearly", "سنويًا")} · {plan.access_duration === "lifetime" ? t("lifetime access", "وصول مدى الحياة") : plan.access_duration === "fixed_days" ? t(`${plan.access_days} days access`, `وصول لمدة ${plan.access_days} يوم`) : t("while subscription is active", "طوال فترة الاشتراك")}</p><span className={`status-chip ${plan.is_active ? "status-active" : "status-suspended"}`}>{plan.is_active ? t("Active", "نشطة") : t("Inactive", "متوقفة")}</span></div><div className="admin-button-pair"><button type="button" className="button button-small" onClick={() => startEdit(plan)}>{t("Edit", "تعديل")}</button>{plan.is_active && <button type="button" className="button button-small" disabled={busy} onClick={() => void deactivate(plan.id)}>{t("Deactivate", "إيقاف")}</button>}</div></article>)}</div>}
    <form onSubmit={(event) => void submit(event)} className="pricing-form">
      <h3>{editingId ? t("Edit pricing plan", "تعديل خطة السعر") : t("Add a pricing plan", "إضافة خطة سعر")}</h3>
      <div className="editor-grid">
        <label className="form-field"><span>{t("Plan name (English)", "اسم الخطة بالإنجليزية")}</span><input value={draft.nameEn} onChange={(e) => update("nameEn", e.target.value)} required minLength={2} maxLength={100} /></label>
        <label className="form-field"><span>{t("اسم الخطة بالعربية", "اسم الخطة بالعربية")}</span><input value={draft.nameAr} onChange={(e) => update("nameAr", e.target.value)} required minLength={2} maxLength={100} /></label>
        <label className="form-field"><span>{t("Amount", "السعر")}</span><input type="number" min="0" max="10000000" step="0.01" value={draft.amount} onChange={(e) => update("amount", e.target.value)} required /></label>
        <label className="form-field"><span>{t("Currency", "العملة")}</span><select value={draft.currency} onChange={(e) => update("currency", e.target.value as Draft["currency"])}>{["EGP", "USD", "SAR", "AED", "EUR"].map((currency) => <option key={currency}>{currency}</option>)}</select></label>
        <label className="form-field"><span>{t("Billing model", "نظام الدفع")}</span><select value={draft.billingPeriod} onChange={(e) => update("billingPeriod", e.target.value as Draft["billingPeriod"])}><option value="one_time">{t("One-time purchase", "شراء مرة واحدة")}</option><option value="monthly">{t("Monthly subscription", "اشتراك شهري")}</option><option value="yearly">{t("Yearly subscription", "اشتراك سنوي")}</option></select></label>
        <label className="form-field"><span>{t("Access duration", "مدة الوصول")}</span><select value={draft.accessDuration} onChange={(e) => update("accessDuration", e.target.value as Draft["accessDuration"])} disabled={draft.billingPeriod !== "one_time"}><option value="lifetime">{t("Lifetime", "مدى الحياة")}</option><option value="fixed_days">{t("Limited days", "مدة محدودة")}</option><option value="subscription_period">{t("Subscription period", "مدة الاشتراك")}</option></select></label>
        {draft.accessDuration === "fixed_days" && <label className="form-field"><span>{t("Number of days", "عدد الأيام")}</span><input type="number" min="1" max="3650" value={draft.accessDays} onChange={(e) => update("accessDays", e.target.value)} required /></label>}
        {draft.billingPeriod !== "one_time" && <label className="form-field"><span>{t("Trial days (Phase 2 billing only)", "أيام التجربة (الفوترة في المرحلة الثانية)")}</span><input type="number" min="0" max="90" value={draft.trialDays} onChange={(e) => update("trialDays", e.target.value)} /></label>}
      </div>
      <label className="admin-toggle"><input type="checkbox" checked={draft.isActive} onChange={(e) => update("isActive", e.target.checked)} />{t("Plan is active and visible", "الخطة نشطة وتظهر للطلاب")}</label>
      <p className="form-hint">{t("Saving a price does not charge a customer or grant paid access. Checkout will remain disabled until a real payment provider is integrated.", "حفظ السعر لا يخصم أموالًا ولا يمنح وصولًا مدفوعًا. سيظل الدفع معطّلًا حتى دمج مزود دفع حقيقي.")}</p>
      <div className="admin-button-pair"><button className="button button-primary" type="submit" disabled={busy}>{busy ? t("Saving…", "جارٍ الحفظ…") : editingId ? t("Save changes", "حفظ التعديلات") : t("Create plan", "إنشاء الخطة")}</button>{editingId && <button type="button" className="button" onClick={reset}>{t("Cancel", "إلغاء")}</button>}</div>
    </form>
    {loaded && <p className="admin-footnote">{t("Phase 1 stores pricing and access policy only. It does not process charges, renew subscriptions, issue refunds, or pay instructors.", "المرحلة الأولى تحفظ الأسعار وسياسات الوصول فقط، ولا تعالج المدفوعات أو تجديد الاشتراكات أو الاسترداد أو تحويل مستحقات المدرسين.")}</p>}
  </section>;
}
