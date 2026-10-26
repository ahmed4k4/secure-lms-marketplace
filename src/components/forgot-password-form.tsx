"use client";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm({ locale, initialError }: { locale: string; initialError?: string }) {
  const ar = locale === "ar";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [lastSentAt, setLastSentAt] = useState(0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSent(false);
    if (Date.now() - lastSentAt < 20_000) {
      setError(ar ? "انتظر 20 ثانية قبل إرسال طلب آخر." : "Please wait 20 seconds before requesting another email.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const redirectTo = `${origin}/${locale}/auth/callback?flow=recovery&next=${encodeURIComponent(`/${locale}/reset-password`)}`;
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
      if (authError) {
        const code = (authError.code ?? "").toLowerCase();
        const message = (authError.message ?? "").toLowerCase();
        console.warn("password_recovery_request_rejected", { code: code || "unknown", status: authError.status ?? 0 });
        if (authError.status === 429 || code.includes("rate_limit") || code === "over_email_send_rate_limit") {
          setError(ar ? "تم تجاوز حد إرسال الرسائل مؤقتًا. انتظر قليلًا ثم حاول مرة أخرى." : "The email sending limit was reached. Wait before trying again.");
        } else if (message.includes("redirect") || message.includes("allow list") || message.includes("allowlist")) {
          setError(ar ? "رابط إعادة التوجيه غير مسموح في Supabase. أضف عنوان هذا الموقع ومسار /ar/auth/callback و/en/auth/callback إلى قائمة Redirect URLs." : "Supabase rejected the redirect URL. Add this app origin and the /ar/auth/callback and /en/auth/callback paths to Auth Redirect URLs.");
        } else if (message.includes("smtp") || message.includes("email provider") || message.includes("sending email")) {
          setError(ar ? "إعداد البريد في Supabase لا يسمح بالإرسال حاليًا. راجع إعداد SMTP وقوالب البريد وحدود الإرسال." : "Supabase email delivery is not configured for this request. Check SMTP, email templates, and email rate limits.");
        } else {
          setError(ar ? "تعذر طلب رابط الاستعادة. راجع إعدادات Auth وSMTP وRedirect URLs في Supabase ثم حاول مجددًا." : "Could not request a recovery link. Check Supabase Auth, SMTP, and Redirect URLs settings, then try again.");
        }
        return;
      }
      setLastSentAt(Date.now());
      setSent(true);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message.toLowerCase() : "";
      setError(msg.includes("fetch") || msg.includes("network")
        ? (ar ? "تعذر الاتصال بخدمة المصادقة. تحقق من الإنترنت ورابط Supabase." : "Could not reach Supabase Auth. Check your connection and project URL.")
        : (ar ? "حدث خطأ غير متوقع. حاول مرة أخرى." : "An unexpected error occurred. Please try again."));
    } finally { setBusy(false); }
  }

  const queryError = initialError === "expired"
    ? (ar ? "انتهت صلاحية الرابط أو استُخدم من قبل. اطلب رابطًا جديدًا." : "That link has expired or was already used. Request a new one.")
    : initialError === "link"
      ? (ar ? "تعذر التحقق من رابط الاستعادة. اطلب رسالة جديدة وافتح أحدث رابط." : "The recovery link could not be verified. Request a new email and open the newest link.")
      : "";

  return <form onSubmit={submit} className="auth-form">
    {queryError && <div className="notice notice-error" role="alert">{queryError}</div>}
    <label className="form-field"><span>{ar ? "البريد الإلكتروني" : "Email address"}</span><input id="recovery-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} inputMode="email" maxLength={254} required /></label>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {sent && <div className="notice" role="status">{ar ? "إذا كان البريد مرتبطًا بحساب، فستصلك رسالة بخطوات الاستعادة. افتح أحدث رسالة فقط، وافحص Spam. عند فتح الرابط يجب أن تعود إلى نفس الدومين الذي طلبت منه الاستعادة." : "If an account exists for this email, recovery instructions will be sent. Open only the newest email and check spam. The link should return to the same domain where you requested recovery."}</div>}
    <button className="button button-primary auth-submit" disabled={busy} style={{ width: "100%" }}>{busy ? (ar ? "جارٍ الإرسال…" : "Sending…") : (ar ? "إرسال رابط الاستعادة" : "Send recovery link")}</button>
    <p className="auth-privacy-note">{ar ? "لأسباب أمنية، لا نكشف ما إذا كان البريد مسجلًا. يجب إضافة عنوان الموقع إلى Redirect URLs في إعدادات Supabase Auth." : "For security, we do not reveal whether an email is registered. The app origin must be allowlisted in Supabase Auth Redirect URLs."}</p>
  </form>;
}
