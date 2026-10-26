"use client";
import Link from "next/link";
import { useState } from "react";
type Plan = { id: string; name_ar: string; name_en: string; currency: string; amount_minor: number | string; billing_period: string; access_duration: string; access_days: number | null };
export function CoursePricingPanel({ courseId, courseSlug, plans, locale }: { courseId: string; courseSlug: string; plans: Plan[]; locale: string }) {
  const ar = locale === "ar";
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const freePlan = plans.find((plan) => Number(plan.amount_minor) === 0 && plan.billing_period === "one_time" && plan.access_duration === "lifetime");
  async function enrollFree() {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/enrollments/free", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId }) });
      const data = await response.json() as { error?: string };
      if (response.status === 401) { window.location.assign(`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/courses/${courseSlug}`)}`); return; }
      if (!response.ok) throw new Error(data.error || (ar ? "تعذر التسجيل في الكورس" : "Could not enroll in this course"));
      setMessage(ar ? "تم تسجيلك في الكورس المجاني. افتح لوحة تعلمي للمتابعة." : "You are enrolled. Open My Learning to continue.");
    } catch (e) { setError(e instanceof Error ? e.message : "Enrollment failed"); }
    finally { setBusy(false); }
  }
  const money = (plan: Plan) => new Intl.NumberFormat(locale, { style: "currency", currency: plan.currency, maximumFractionDigits: 2 }).format(Number(plan.amount_minor) / 100);
  return <section className="course-pricing-card" aria-labelledby="course-pricing-heading">
    <div className="pricing-card-heading"><span className="eyebrow">{ar ? "خطط الوصول" : "ACCESS OPTIONS"}</span><h2 id="course-pricing-heading">{ar ? "اختر طريقة الوصول" : "Choose your access"}</h2><p className="muted">{ar ? "تفاصيل السعر وسياسة الوصول موضحة قبل التسجيل." : "Pricing and access terms are shown before enrollment."}</p></div>
    {!plans.length ? <div className="empty">{ar ? "لم يحدد المدرس سعرًا لهذا الكورس بعد." : "The instructor has not published a pricing plan yet."}</div> : <div className="public-plan-list">{plans.map((plan) => <article key={plan.id} className={`public-plan ${plan.id === freePlan?.id ? "public-plan-featured" : ""}`}><div><strong>{ar ? plan.name_ar : plan.name_en}</strong><div className="public-plan-price">{money(plan)} <small>{plan.billing_period === "monthly" ? (ar ? "/ شهريًا" : "/ month") : plan.billing_period === "yearly" ? (ar ? "/ سنويًا" : "/ year") : (ar ? "دفعة واحدة" : "one-time")}</small></div><p className="muted">{plan.access_duration === "lifetime" ? (ar ? "وصول مدى الحياة" : "Lifetime access") : plan.access_duration === "fixed_days" ? (ar ? `وصول لمدة ${plan.access_days} يوم` : `${plan.access_days} days access`) : (ar ? "الوصول خلال فترة الاشتراك النشط" : "Access while subscription is active")}</p></div>{plan.id === freePlan?.id ? <button type="button" className="button button-primary" onClick={() => void enrollFree()} disabled={busy}>{busy ? (ar ? "جارٍ التسجيل…" : "Enrolling…") : (ar ? "التحق مجانًا" : "Enroll for free")}</button> : <span className="status-chip status-pending">{ar ? "الدفع في المرحلة الثانية" : "Checkout in Phase 2"}</span>}</article>)}</div>}
    {message && <div className="notice" role="status">{message} <Link href={`/${locale}/my-learning`}>{ar ? "تعلماتي" : "My Learning"}</Link></div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {plans.some((plan) => Number(plan.amount_minor) > 0) && <p className="pricing-disclaimer">{ar ? "الأسعار معروضة للتوضيح. لا يتم تحصيل أموال أو منح وصول مدفوع حتى ربط مزود دفع حقيقي في المرحلة الثانية." : "Prices are displayed for planning only. No payment is collected and paid access is not granted until a real payment provider is integrated in Phase 2."}</p>}
  </section>;
}
