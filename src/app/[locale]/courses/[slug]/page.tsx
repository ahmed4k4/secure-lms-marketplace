import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CoursePricingPanel } from "@/components/course-pricing-panel";
export default async function CourseDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params; const ar = locale === "ar"; const supabase = await createClient();
  const { data: course, error } = await supabase.from("courses").select("id,slug,title_ar,title_en,summary_ar,summary_en,description_ar,description_en,owner_id,thumbnail_url,level,language,category_id").eq("slug", slug).eq("status", "published").maybeSingle();
  if (error || !course) notFound();
  const admin = createAdminClient();
  const [{ data: product }, { data: sections }, { data: instructorProfile }, { data: instructor }] = await Promise.all([
    supabase.from("products").select("id").eq("course_id", course.id).eq("kind", "course").eq("is_active", true).maybeSingle(),
    admin.from("sections").select("id,title_ar,title_en,sort_order,lessons(id,title_ar,title_en,kind,is_preview,is_published,sort_order)").eq("course_id", course.id).order("sort_order", { ascending: true }),
    admin.from("instructor_profiles").select("slug,headline").eq("user_id", course.owner_id).eq("is_approved", true).maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", course.owner_id).eq("status", "active").maybeSingle(),
  ]);
  const { data: plans } = product ? await supabase.from("pricing_plans").select("id,name_ar,name_en,currency,amount_minor,billing_period,access_duration,access_days").eq("product_id", product.id).eq("is_active", true).order("amount_minor", { ascending: true }) : { data: [] };
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const lessons = (sections ?? []).flatMap((section) => (section.lessons ?? []).filter((lesson) => lesson.is_published).map((lesson) => ({ ...lesson, sectionId: section.id, sectionTitle: ar ? section.title_ar : section.title_en }))).sort((a, b) => a.sort_order - b.sort_order);
  return <section className="section"><div className="container course-detail-layout">
    <div className="course-detail-main"><Link href={`/${locale}/courses`} className="muted">← {t("All courses", "كل الكورسات")}</Link>
      <div className="course-detail-hero" style={course.thumbnail_url ? { backgroundImage: `linear-gradient(135deg,rgba(17,24,39,.55),rgba(79,70,229,.42)),url("${course.thumbnail_url}")` } : undefined}><span className="eyebrow">{t("PUBLISHED COURSE", "كورس منشور")}</span><h1>{ar ? course.title_ar : course.title_en}</h1><p>{ar ? course.summary_ar : course.summary_en}</p><div className="course-detail-meta"><span>{course.language === "both" ? t("Arabic + English", "العربية والإنجليزية") : course.language === "en" ? "English" : t("Arabic", "العربية")}</span><span>{course.level === "all_levels" ? t("All levels", "كل المستويات") : course.level}</span><span>{lessons.length} {t("published lessons", "درس منشور")}</span></div></div>
      {instructorProfile && instructor && <Link className="instructor-mini-card" href={`/${locale}/instructors/${instructorProfile.slug}`}><span className="instructor-avatar instructor-avatar-small">{(instructor.display_name || "I").slice(0, 1).toUpperCase()}</span><span><small>{t("INSTRUCTOR", "المدرس")}</small><strong>{instructor.display_name}</strong>{instructorProfile.headline && <span className="muted">{instructorProfile.headline}</span>}</span><span className="instructor-mini-arrow">↗</span></Link>}
      <article className="panel course-description-panel"><h2>{t("About this course", "عن الكورس")}</h2><p className="course-description-text">{ar ? course.description_ar : course.description_en}</p></article>
      <section className="panel curriculum-panel"><div className="section-heading-row"><div><h2>{t("Course curriculum", "محتوى الكورس")}</h2><p className="muted">{t("Review the published sections and lesson previews.", "تعرّف على الأقسام المنشورة ومعاينات الدروس.")}</p></div><span className="catalog-count">{lessons.length} {t("lessons", "درس")}</span></div>
        {!lessons.length ? <div className="empty">{t("The curriculum is being prepared.", "يجري تجهيز محتوى الكورس.")}</div> : (sections ?? []).map((section) => { const sectionLessons = lessons.filter((lesson) => lesson.sectionId === section.id); if (!sectionLessons.length) return null; return <div className="curriculum-section" key={section.id}><h3>{ar ? section.title_ar : section.title_en}</h3>{sectionLessons.map((lesson) => <div className="curriculum-lesson" key={lesson.id}><span className="lesson-kind-icon">{lesson.kind === "video" ? "▶" : "≡"}</span><span className="curriculum-lesson-title">{ar ? lesson.title_ar : lesson.title_en}</span>{lesson.is_preview ? <Link className="preview-link" href={`/${locale}/lessons/${lesson.id}`}>{t("Preview", "معاينة")}</Link> : <span className="lesson-lock" aria-label={t("Access required", "يتطلب صلاحية وصول")}>⌑</span>}</div>)}</div>; })}
      </section>
    </div>
    <aside className="course-detail-sidebar"><CoursePricingPanel courseId={course.id} courseSlug={course.slug} plans={(plans ?? []) as Array<{ id: string; name_ar: string; name_en: string; currency: string; amount_minor: number | string; billing_period: string; access_duration: string; access_days: number | null }>} locale={locale} /><div className="course-security-note"><span>⌑</span><p>{t("Access is checked on the server. Paid checkout is not enabled yet; prices are shown transparently without simulated charges.", "يتم التحقق من الوصول على الخادم. الدفع المدفوع غير مفعّل بعد؛ الأسعار معروضة بوضوح دون تحصيل وهمي.")}</p></div></aside>
  </div></section>;
}
