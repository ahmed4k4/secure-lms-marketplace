import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
export default async function LocaleLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) { const { locale } = await params; if (locale !== "ar" && locale !== "en") notFound(); return <div lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}><SiteHeader locale={locale} /><main id="main-content">{children}</main><SiteFooter locale={locale} /></div>; }
