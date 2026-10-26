import Link from "next/link";
import { ArrowUpLeft, ArrowUpRight, BookOpen, Compass, GraduationCap, ShieldCheck, Sparkles } from "lucide-react";

export function SiteFooter({ locale }: { locale: string }) {
  const ar = locale === "ar";
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const year = new Date().getFullYear();
  const Arrow = ar ? ArrowUpLeft : ArrowUpRight;
  return <footer className="site-footer">
    <div className="container footer-cta">
      <div className="footer-cta-copy">
        <span className="footer-kicker"><Sparkles size={14} aria-hidden="true"/>{t("YOUR NEXT CHAPTER", "خطوتك التعليمية الجاية")}</span>
        <h2>{t("Turn curiosity into a skill you can use.", "حوّل فضولك لمهارة تقدر تستخدمها.")}</h2>
        <p>{t("Explore focused courses, learn from practitioners, and make progress one lesson at a time.", "استكشف كورسات عملية، واتعلم من أصحاب الخبرة، واتقدم درسًا بعد درس.")}</p>
      </div>
      <Link className="button button-primary footer-cta-button" href={`/${locale}/courses`}>{t("Explore courses", "استكشف الكورسات")}<Arrow size={17} aria-hidden="true"/></Link>
      <span className="footer-circuit footer-circuit-one" aria-hidden="true" />
      <span className="footer-circuit footer-circuit-two" aria-hidden="true" />
    </div>

    <div className="container footer-main">
      <div className="footer-brand-column">
        <Link className="footer-brand" href={`/${locale}`} aria-label={t("LearnSpace home", "LearnSpace الرئيسية")}><span className="footer-brand-mark"><BookOpen size={20}/><i /></span><span>Learn<span>Space</span></span></Link>
        <p>{t("A focused learning space for people who want to build practical skills, follow a clear path, and keep growing.", "مساحة تعليمية لكل شخص عايز يبني مهارات عملية، ويمشي في مسار واضح، ويستمر في التقدم.")}</p>
        <div className="footer-trust-note"><span className="footer-live-dot"/><span>{t("Learn with clarity. Grow with purpose.", "اتعلّم بوضوح. وتقدّم بهدف.")}</span></div>
      </div>
      <div className="footer-link-column"><h2>{t("Explore", "اكتشف")}</h2><Link href={`/${locale}/courses`}><Compass size={16}/>{t("All courses", "كل الكورسات")}</Link><Link href={`/${locale}#categories`}><BookOpen size={16}/>{t("Categories", "التصنيفات")}</Link></div>
      <div className="footer-link-column"><h2>{t("Your account", "حسابك")}</h2><Link href={`/${locale}/sign-in`}><GraduationCap size={16}/>{t("Sign in", "تسجيل الدخول")}</Link><Link href={`/${locale}/sign-up`}><ShieldCheck size={16}/>{t("Create account", "إنشاء حساب")}</Link><Link href={`/${locale}/forgot-password`}>{t("Reset password", "استعادة كلمة المرور")}</Link></div>
      <div className="footer-link-column"><h2>{t("Teach with us", "درّس معنا")}</h2><p className="footer-column-copy">{t("Share your expertise and build a course for learners ready to grow.", "شارك خبرتك وابنِ كورسًا للمتعلمين المستعدين للتطور.")}</p><Link href={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/instructor/courses`)}`}><GraduationCap size={16}/>{t("Instructor workspace", "مساحة المدرّس")}<Arrow size={14}/></Link></div>
    </div>
    <div className="container footer-bottom"><span>© {year} LearnSpace. {t("All rights reserved.", "جميع الحقوق محفوظة.")}</span><div className="footer-bottom-meta"><span>{t("Built for learning", "مصمم للتعلّم")}</span><span className="footer-bottom-separator"/><span>{t("Arabic & English", "العربية والإنجليزية")}</span></div></div>
  </footer>;
}
