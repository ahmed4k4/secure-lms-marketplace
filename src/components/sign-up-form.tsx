"use client";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
export function SignUpForm({ locale }: { locale: string }) {
  const ar = locale === "ar"; const t = (en: string, arabic: string) => ar ? arabic : en;
  const router = useRouter(); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [showPassword, setShowPassword] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const strength = useMemo(() => [password.length >= 12, /[a-z]/.test(password) && /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length, [password]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setError("");
    if (password !== confirm) { setError(t("Passwords do not match.", "كلمتا المرور غير متطابقتين.")); return; }
    if (strength < 3) { setError(t("Use at least 12 characters and combine letters, numbers, or symbols.", "استخدم 12 حرفًا على الأقل وامزج الحروف والأرقام أو الرموز.")); return; }
    setBusy(true);
    try {
      const supabase = createClient(); const emailRedirectTo = `${window.location.origin}/${locale}/auth/callback?next=${encodeURIComponent(`/${locale}/dashboard`)}`;
      const { data: signUpData, error: signupError } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() }, emailRedirectTo } });
      if (signupError) throw signupError;
      setPassword(""); setConfirm("");
      if (signUpData.session) { router.replace(`/${locale}/dashboard`); router.refresh(); return; }
      setMessage(t("Registration started. Check your inbox and spam folder to confirm your email before signing in.", "بدأ التسجيل. راجع البريد الوارد والرسائل غير المرغوب فيها لتأكيد البريد قبل تسجيل الدخول."));
    } catch (caught) {
      const err = caught as { code?: string; status?: number; message?: string }; const code = (err?.code ?? "").toLowerCase(); const msg = (err?.message ?? "").toLowerCase();
      if (code.includes("rate_limit") || err?.status === 429) setError(t("Too many sign-up attempts. Wait a little and try again.", "طلبات تسجيل كثيرة. انتظر قليلًا ثم حاول مجددًا."));
      else if (msg.includes("invalid api key")) setError(t("Supabase configuration is invalid. Check the project URL and public key.", "إعدادات Supabase غير صحيحة. تحقق من رابط المشروع والمفتاح العام."));
      else if (msg.includes("fetch failed") || msg.includes("network") || msg.includes("failed to fetch")) setError(t("Could not reach the sign-up service. Check your connection and Supabase settings.", "تعذر الاتصال بخدمة التسجيل. تحقق من الإنترنت وإعدادات Supabase."));
      else setError(t("Supabase rejected the sign-up request. Check the email, password policy, and Auth settings.", "رفضت خدمة التسجيل الطلب. راجع البريد وسياسة كلمة المرور وإعدادات Auth."));
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="auth-form">
    <label className="form-field"><span>{t("Full name", "الاسم بالكامل")}</span><input id="name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required autoComplete="name" /></label>
    <label className="form-field"><span>{t("Email address", "البريد الإلكتروني")}</span><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} /></label>
    <label className="form-field"><span>{t("Password", "كلمة المرور")}</span><span className="password-field"><input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? t("Hide", "إخفاء") : t("Show", "إظهار")}</button></span><span className="password-strength" aria-live="polite"><span className={`strength-meter strength-${strength}`}><i /></span><small>{password.length === 0 ? t("Use 12+ characters", "استخدم 12 حرفًا أو أكثر") : strength <= 1 ? t("Weak password", "كلمة مرور ضعيفة") : strength <= 2 ? t("Fair password", "كلمة مرور متوسطة") : strength === 3 ? t("Good password", "كلمة مرور جيدة") : t("Strong password", "كلمة مرور قوية")}</small></span></label>
    <label className="form-field"><span>{t("Confirm password", "تأكيد كلمة المرور")}</span><input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" /></label>
    {error && <div role="alert" className="notice notice-error">{error}</div>}{message && <div role="status" className="notice">{message}</div>}
    <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? t("Creating account…", "جارٍ إنشاء الحساب…") : t("Create student account", "إنشاء حساب طالب")}</button>
    <p className="auth-privacy-note">{t("New accounts start with student access only. Instructor and administrator privileges require approval.", "كل الحسابات الجديدة تبدأ بصلاحية طالب فقط. صلاحيات المدرس والمدير تتطلب موافقة الإدارة.")}</p>
  </form>;
}
