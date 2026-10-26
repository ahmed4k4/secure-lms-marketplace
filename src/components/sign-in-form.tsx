"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage, type AuthErrorLike } from "@/lib/auth-errors";

export function SignInForm({ locale, nextPath, accountState }: { locale: string; nextPath?: string; accountState?: string }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [showPassword, setShowPassword] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const router = useRouter(); const ar = locale === "ar"; const t = (en: string, arabic: string) => ar ? arabic : en;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (authError) { console.warn("supabase_sign_in_rejected", { code: authError.code ?? "unknown", status: authError.status ?? 0 }); setError(authErrorMessage(authError, ar)); return; }
      const safePrefix = `/${locale}/`;
      const safeNext = nextPath && nextPath.startsWith(safePrefix) && !nextPath.startsWith("//") && !nextPath.includes("\\") && !nextPath.includes("\0") ? nextPath : `/${locale}/dashboard`;
      router.replace(safeNext); router.refresh();
    } catch (caught) { const errorLike = caught && typeof caught === "object" ? caught as AuthErrorLike : { message: String(caught) }; setError(authErrorMessage(errorLike, ar)); }
    finally { setBusy(false); }
  }
  const accountMessages: Record<string, string> = {
    suspended: t("This account is suspended. Contact platform support.", "الحساب موقوف. تواصل مع إدارة المنصة."),
    setup: t("Authentication succeeded, but the profile is missing. Ask the platform administrator to repair account provisioning.", "تم تسجيل الدخول لكن ملف الحساب غير موجود. تواصل مع مسؤول المنصة لإصلاح تهيئة الحساب."),
    profile_error: t("We could not verify account status. Please try again later or contact support.", "تعذر التحقق من حالة الحساب. حاول لاحقًا أو تواصل مع الدعم."),
    pending: t("Your account is awaiting approval.", "الحساب قيد المراجعة ولم يتم تفعيله بعد."),
    invite_expired: t("This invitation or recovery link has expired. Request a new one.", "انتهت صلاحية رابط الدعوة أو الاستعادة. اطلب رابطًا جديدًا."),
    invite_failed: t("The confirmation link could not be verified. Request a new email link.", "تعذر التحقق من رابط التأكيد. اطلب رابطًا جديدًا."),
  };
  return <form onSubmit={submit} className="auth-form">
    {accountState && accountMessages[accountState] && <div role="status" className="notice notice-error">{accountMessages[accountState]}</div>}
    <label className="form-field"><span>{t("Email address", "البريد الإلكتروني")}</span><input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label className="form-field"><span>{t("Password", "كلمة المرور")}</span><span className="password-field"><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t("Hide password", "إخفاء كلمة المرور") : t("Show password", "إظهار كلمة المرور")}>{showPassword ? t("Hide", "إخفاء") : t("Show", "إظهار")}</button></span></label>
    <div className="auth-form-meta"><Link href={`/${locale}/forgot-password`}>{t("Forgot password?", "نسيت كلمة المرور؟")}</Link></div>
    {error && <div role="alert" className="notice notice-error">{error}</div>}
    <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? t("Signing in…", "جارٍ تسجيل الدخول…") : t("Sign in", "تسجيل الدخول")}</button>
    <p className="auth-privacy-note">{t("Your account access is checked on the server. Never share your password or recovery links.", "يتم التحقق من صلاحيات حسابك على الخادم. لا تشارك كلمة المرور أو روابط الاستعادة.")}</p>
  </form>;
}
