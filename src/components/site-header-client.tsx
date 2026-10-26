"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, Compass, LayoutDashboard, LogIn, Menu, Search, ShieldCheck, X, type LucideIcon } from "lucide-react";

type Props = { locale: string; email: string | null; roles: string[] };
type NavLinkItem = { href: string; label: string; exact?: boolean; icon: LucideIcon };

export function SiteHeaderClient({ locale, email, roles }: Props) {
  const ar = locale === "ar";
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const isAdmin = roles.includes("super_admin") || roles.includes("admin");
  const isInstructor = roles.includes("instructor");
  const links: NavLinkItem[] = [
    { href: `/${locale}`, label: ar ? "الرئيسية" : "Home", exact: true, icon: Compass },
    { href: `/${locale}/courses`, label: ar ? "الكورسات" : "Courses", icon: BookOpen },
    ...(email ? [{ href: `/${locale}/dashboard`, label: ar ? "مساحة التعلّم" : "My learning", icon: LayoutDashboard }] : []),
    ...(isInstructor ? [{ href: `/${locale}/instructor/courses`, label: ar ? "التدريس" : "Teach", icon: BookOpen }] : []),
    ...(isAdmin ? [{ href: `/${locale}/admin`, label: ar ? "الإدارة" : "Admin", icon: ShieldCheck }] : []),
  ];
  const active = (href: string, exact?: boolean) => exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const languageHref = pathname.startsWith("/ar") ? pathname.replace(/^\/ar(?=\/|$)/, "/en") : pathname.replace(/^\/en(?=\/|$)/, "/ar");
  const t = (en: string, arabic: string) => ar ? arabic : en;

  return <>
    <a className="skip-link" href="#main-content">{t("Skip to content", "تخطّي إلى المحتوى")}</a>
    <header className="site-header">
      <div className="container nav">
        <Link className="brand" href={`/${locale}`} aria-label={ar ? "LearnSpace الرئيسية" : "LearnSpace home"} onClick={() => setOpen(false)}>
          <span className="brand-symbol" aria-hidden="true"><BookOpen size={19} strokeWidth={1.8}/><i /></span>
          <span className="brand-lockup"><span className="brand-word">Learn<span>Space</span></span><span className="brand-descriptor">{t("LEARN · BUILD · GROW", "تعلّم · طبّق · تطوّر")}</span></span>
        </Link>

        <form className="nav-search" action={`/${locale}/courses`} method="get" role="search">
          <Search size={17} aria-hidden="true" />
          <label className="visually-hidden" htmlFor={`nav-search-${locale}`}>{t("Search courses", "ابحث عن كورسات")}</label>
          <input id={`nav-search-${locale}`} type="search" name="q" maxLength={80} placeholder={t("Search courses or skills", "ابحث عن كورس أو مهارة")} />
          <kbd aria-hidden="true">⌕</kbd>
        </form>

        <nav id="site-navigation" className={`nav-links${open ? " nav-links-open" : ""}`} aria-label={ar ? "التنقل الرئيسي" : "Main navigation"}>
          {links.map(({ href, label, exact, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} className={active(href, exact) ? "nav-link nav-link-active" : "nav-link"} aria-current={active(href, exact) ? "page" : undefined}><Icon size={16} aria-hidden="true"/><span>{label}</span></Link>)}
          <Link className="mobile-nav-language" href={languageHref} onClick={() => setOpen(false)}>{ar ? "English" : "العربية"}</Link>
          {email && <div className="mobile-nav-user"><span className="nav-avatar">{email.slice(0,1).toUpperCase()}</span><span dir="ltr">{email}</span></div>}
        </nav>

        <div className="nav-actions">
          <Link className="nav-language" href={languageHref} aria-label={ar ? "Switch to English" : "التبديل إلى العربية"}>{ar ? "EN" : "ع"}<ChevronDown size={13}/></Link>
          {email ? <Link className="button button-primary nav-account" href={`/${locale}/dashboard`}><span className="nav-avatar">{email.slice(0,1).toUpperCase()}</span><span>{ar ? "مساحتي" : "My space"}</span></Link> : <><Link className="nav-sign-in" href={`/${locale}/sign-in`}><LogIn size={16}/><span>{ar ? "دخول" : "Sign in"}</span></Link><Link className="button button-primary nav-cta" href={`/${locale}/sign-up`}>{ar ? "ابدأ التعلّم" : "Start learning"}<span aria-hidden="true">↗</span></Link></>}
          <button type="button" className="nav-menu-button" aria-label={open ? (ar ? "إغلاق القائمة" : "Close navigation") : (ar ? "فتح القائمة" : "Open navigation")} aria-expanded={open} aria-controls="site-navigation" onClick={() => setOpen((value) => !value)}>{open ? <X size={21}/> : <Menu size={21}/>}</button>
        </div>
      </div>
    </header>
  </>;
}
