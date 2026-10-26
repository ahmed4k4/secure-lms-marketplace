import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupAccountForm } from "@/components/setup-account-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = { robots: { index: false, follow: false } };

export default async function SetupAccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === "ar";
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect(`/${locale}/sign-in?account=invite_failed`);
  return <section className="auth-wrap"><div className="container auth-layout"><aside className="auth-aside"><span className="eyebrow">{ar ? "خطوة أخيرة" : "ONE LAST STEP"}</span><h1>{ar ? "فعّل حسابك بأمان." : "Secure your account."}</h1><p>{ar ? "وصلت إلى المنصة من رابط دعوة صالح. عيّن كلمة مرور خاصة بك لإكمال إعداد الحساب." : "You opened a valid account invitation. Create your own password to finish setting up your account."}</p><div className="auth-aside-points"><span>✓ {ar ? "كلمة مرور خاصة بك" : "Your own password"}</span><span>✓ {ar ? "جلسة آمنة" : "Secure session"}</span><span>✓ {ar ? "الصلاحيات تحددها الإدارة" : "Roles remain admin-controlled"}</span></div></aside><div className="auth-card"><div className="auth-card-brand"><span className="brand-mark">L</span><span>{ar ? "إكمال إعداد الحساب" : "Finish account setup"}</span></div><h2>{ar ? "أنشئ كلمة مرور" : "Create your password"}</h2><p className="muted">{ar ? "لن يتم تغيير دورك أو صلاحياتك بهذه الخطوة." : "This step does not change your role or permissions."}</p><SetupAccountForm locale={locale} email={user.email ?? ""}/><p className="auth-bottom-link"><Link href={`/${locale}/forgot-password`}>{ar ? "الرابط لا يعمل؟ اطلب رابط استعادة جديدًا" : "Link not working? Request a fresh recovery link"}</Link></p></div></div></section>;
}
