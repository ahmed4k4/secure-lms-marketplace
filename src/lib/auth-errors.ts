export type AuthErrorLike = { code?: string; status?: number; message?: string; name?: string };

export function authErrorMessage(error: AuthErrorLike, ar: boolean): string {
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  if (code === "invalid_credentials" || code === "invalid_login_credentials" || message.includes("invalid login credentials"))
    return ar ? "البريد الإلكتروني أو كلمة المرور غير صحيحة، أو لم يتم تعيين كلمة مرور للحساب بعد. لو حساب المدرّس اتعمل بدعوة، افتح رابط الدعوة وأكمل تعيين كلمة المرور أولًا، أو استخدم «نسيت كلمة المرور» للحصول على رابط جديد. تأكد أيضًا أن الحساب تابع لنفس مشروع Supabase." : "We could not sign in with those details. If this instructor account was created by invitation, open the invitation link and set a password first, or use Forgot password to request a fresh reset link. Also verify that the account belongs to this Supabase project.";
  if (code === "email_not_confirmed" || message.includes("email not confirmed"))
    return ar ? "يجب تأكيد بريدك الإلكتروني قبل تسجيل الدخول. راجع صندوق الوارد أو اطلب رسالة تأكيد جديدة." : "Confirm your email before signing in. Check your inbox or request a new confirmation email.";
  if (message.includes("invalid api key") || message.includes("invalid supabaseurl") || message.includes("invalid supabase url") || error.status === 401 && message.includes("api key"))
    return ar ? "إعدادات Supabase غير صحيحة. تحقق من رابط المشروع والمفتاح العام في إعدادات البيئة ثم أعد تشغيل الموقع." : "Supabase configuration is invalid. Check the project URL and public key, then restart the app.";
  if (code === "user_banned" || code === "user_disabled" || error.status === 403)
    return ar ? "الحساب غير مسموح له بتسجيل الدخول حاليًا. تواصل مع إدارة المنصة." : "This account is not allowed to sign in right now. Contact platform support.";
  if (code.includes("rate_limit") || code === "too_many_requests" || code === "over_email_send_rate_limit" || error.status === 429)
    return ar ? "محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول مرة أخرى." : "Too many attempts. Wait a little and try again.";
  if (code === "otp_expired" || code === "token_expired" || message.includes("expired"))
    return ar ? "انتهت صلاحية رابط البريد. اطلب رابطًا جديدًا واستخدم أحدث رسالة وصلتك فقط." : "This email link has expired. Request a new link and use only the newest email.";
  if (code === "weak_password" || code === "validation_failed" || code === "email_address_invalid")
    return ar ? "بيانات تسجيل الدخول غير مقبولة. راجع البريد وكلمة المرور." : "The sign-in details were rejected. Check the email and password.";
  if (error.name === "AuthRetryableFetchError" || message.includes("fetch failed") || message.includes("network") || message.includes("failed to fetch"))
    return ar ? "تعذر الاتصال بخدمة تسجيل الدخول. تحقق من الإنترنت ورابط Supabase ثم حاول مجددًا." : "Could not reach the authentication service. Check your network and Supabase URL, then try again.";
  return ar ? "رفضت خدمة تسجيل الدخول الطلب. راجع البريد وكلمة المرور وتأكيد البريد، وإذا استمرت المشكلة افحص كود الخطأ في أدوات المطور." : "Supabase rejected the sign-in request. Check credentials and email confirmation; if it persists, inspect the Auth error code in developer tools.";
}
