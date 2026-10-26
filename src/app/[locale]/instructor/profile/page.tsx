import { requireAnyRole } from "@/lib/server/auth";
import { InstructorProfileForm } from "@/components/instructor-profile-form";
export const metadata = { robots: { index: false, follow: false } };

export default async function InstructorProfilePage({ params }: { params: Promise<{ locale: string }> }) { const { locale } = await params; const ar = locale === "ar"; await requireAnyRole(locale, ["instructor", "super_admin"]); return <section className="section"><div className="container"><span className="eyebrow">{ar ? "ملف المدرس" : "INSTRUCTOR PROFILE"}</span><h1>{ar ? "عرّف الطلاب بخبرتك" : "Introduce your expertise"}</h1><p className="muted">{ar ? "أنشئ ملفًا عامًا واضحًا يساعد الطلاب على التعرف عليك." : "Create a clear public profile to help learners get to know you."}</p><div style={{ maxWidth: 900, marginTop: 22 }}><InstructorProfileForm locale={locale}/></div></div></section>; }
