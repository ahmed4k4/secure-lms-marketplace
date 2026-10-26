"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SetupAccountForm({ locale, email }: { locale: string; email: string }) {
  const ar = locale === "ar";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 12 || password.length > 128) {
      setError(ar ? "كلمة المرور يجب أن تكون من 12 إلى 128 حرفًا." : "Password must be between 12 and 128 characters."); return;
    }
    if (password !== confirm) { setError(ar ? "كلمتا المرور غير متطابقتين." : "Passwords do not match."); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("invite_session_missing");
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword(""); setConfirm("");
      router.replace(`/${locale}/dashboard?welcome=1`); router.refresh();
    } catch (caught) {
      const err = caught as { code?: string; message?: string; status?: number };
      const code = (err.code ?? "").toLowerCase(); const message = (err.message ?? "").toLowerCase();
      if (message.includes("invite_session_missing")) setError(ar ? "جلسة الدعوة غير موجودة أو انتهت. افتح أحدث رسالة دعوة أو استخدم نسيت كلمة المرور." : "The invitation session is missing or expired. Open the latest invitation email or use Forgot password.");
      else if (code === "weak_password" || message.includes("password should")) setError(ar ? "كلمة المرور لا تحقق سياسة الأمان المطلوبة. استخدم 12 حرفًا على الأقل مع حروف وأرقام ورموز." : "Password does not meet the security policy. Use at least 12 characters and a mix of letters, numbers, and symbols.");
      else setError(ar ? "تعذر حفظ كلمة المرور. افتح أحدث رابط دعوة أو استعادة، وتأكد من إعدادات Auth في Supabase." : "Could not save the password. Open the newest invitation or recovery link and check Supabase Auth settings.");
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="auth-form">
    <div className="account-email-chip"><span className="account-email-dot" /> <span>{email}</span></div>
    <label className="form-field"><span>{ar ? "كلمة المرور الجديدة" : "Create a password"}</span><span className="password-field"><input id="new-password" name="new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? (ar ? "إخفاء كلمة المرور" : "Hide password") : (ar ? "إظهار كلمة المرور" : "Show password")}>{showPassword ? (ar ? "إخفاء" : "Hide") : (ar ? "إظهار" : "Show")}</button></span><small className="form-hint">{ar ? "12 حرفًا على الأقل. لا تستخدم كلمة مرور سبق استخدامها." : "At least 12 characters. Do not reuse a password from another site."}</small></label>
    <label className="form-field"><span>{ar ? "تأكيد كلمة المرور" : "Confirm password"}</span><input id="confirm-new-password" name="confirm-new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    <button className="button button-primary auth-submit" disabled={busy} style={{ width: "100%" }}>{busy ? (ar ? "جارٍ حفظ كلمة المرور…" : "Saving password…") : (ar ? "تفعيل الحساب والمتابعة" : "Set password and continue")}</button>
  </form>;
}
