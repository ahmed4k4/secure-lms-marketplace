import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAnyRole } from "@/lib/server/auth";
import { InstructorCourseEditor } from "@/components/instructor-course-editor";
import { PricingPlanManager } from "@/components/pricing-plan-manager";

export const metadata = { robots: { index: false, follow: false } };

export default async function InstructorCourseEditorPage({ params }: { params: Promise<{ locale: string; courseId: string }> }) {
  const { locale, courseId } = await params;
  const ar = locale === "ar";
  const { user, roles } = await requireAnyRole(locale, ["instructor", "super_admin"]);
  const isAdmin = roles.includes("super_admin");
  const supabase = await createClient();
  const { data: course } = await supabase.from("courses")
    .select("id,owner_id,slug,title_ar,title_en,status").eq("id", courseId).maybeSingle();
  if (!course || (!isAdmin && course.owner_id !== user.id)) notFound();

  // Read holds only after verifying course ownership; the hold table is intentionally unavailable to browser roles.
  const adminDb = createAdminClient();
  const { data: categoryHold } = await adminDb.from("course_category_holds").select("category_request_id,category_requests(name_en,name_ar,status)").eq("course_id", courseId).maybeSingle();
  const heldRequest = Array.isArray(categoryHold?.category_requests) ? categoryHold.category_requests[0] : categoryHold?.category_requests;
  const categoryPending = Boolean(categoryHold && heldRequest && heldRequest.status !== "approved");

  const { data: sectionRows } = await supabase.from("sections")
    .select("id,title_ar,title_en,sort_order").eq("course_id", courseId).order("sort_order", { ascending: true });
  const sectionIds = (sectionRows ?? []).map((section) => section.id);
  const { data: lessonRows } = sectionIds.length ? await supabase.from("lessons")
    .select("id,section_id,title_ar,title_en,kind,is_published,r2_object_key,stream_uid,processing_status,duration_seconds")
    .in("section_id", sectionIds).order("sort_order", { ascending: true }) : { data: [] };
  const lessonIds = (lessonRows ?? []).map((lesson) => lesson.id);
  const { data: resourceRows } = lessonIds.length ? await supabase.from("lesson_resources")
    .select("id,lesson_id,title,mime_type,size_bytes").in("lesson_id", lessonIds).order("created_at", { ascending: true }) : { data: [] };
  const sections = (sectionRows ?? []).map((section) => ({
    id: section.id,
    title_ar: section.title_ar,
    title_en: section.title_en,
    sort_order: section.sort_order,
    lessons: (lessonRows ?? []).filter((lesson) => lesson.section_id === section.id).map((lesson) => ({
      id: lesson.id,
      section_id: lesson.section_id,
      title_ar: lesson.title_ar,
      title_en: lesson.title_en,
      kind: lesson.kind,
      is_published: lesson.is_published,
      r2_object_key: lesson.r2_object_key,
      stream_uid: lesson.stream_uid,
      processing_status: lesson.processing_status,
      duration_seconds: lesson.duration_seconds,
      resources: (resourceRows ?? []).filter((resource) => resource.lesson_id === lesson.id).map((resource) => ({
        id: resource.id,
        lesson_id: resource.lesson_id,
        title: resource.title,
        mime_type: resource.mime_type,
        size_bytes: Number(resource.size_bytes ?? 0),
      })),
    })),
  }));

  return <section className="section"><div className="container">
    <Link className="muted" href={`/${locale}/instructor/courses`}>← {ar ? "العودة إلى كورساتي" : "Back to courses"}</Link>
    <div className="dashboard-head" style={{ marginTop: 14 }}><div><h1>{ar ? course.title_ar : course.title_en}</h1><p className="muted">{ar ? "إدارة الأقسام والدروس ورفع الفيديوهات الخاصة والملفات إلى R2." : "Manage sections, lessons, private R2 videos, and lesson resources."}</p></div><span className="status-chip">{course.status}</span></div>
    <div className="notice" style={{ marginBottom: 20 }}>{ar ? "تُرفع الفيديوهات مباشرة إلى R2 الخاص عبر روابط مؤقتة، ولا يحصل الطالب على رابط تشغيل مؤقت إلا بعد التحقق من صلاحية الوصول. تُحفظ أغلفة الكورسات في دلو عام منفصل ولا تختلط بملفات الفيديو." : "Videos upload directly to private R2 through temporary upload URLs. A temporary playback link is only issued after an access check. Course covers use a separate public bucket."}</div>
    {categoryPending && <div className="notice notice-warning category-hold-notice" role="status"><strong>{ar ? "الكورس بانتظار اعتماد التصنيف" : "Course waiting for category approval"}</strong><p>{ar ? `أكمل الأقسام والدروس والأسعار كالمعتاد. لن يتم نشر الكورس حتى توافق الإدارة على تصنيف ${heldRequest?.name_ar ?? heldRequest?.name_en ?? "المقترح"}، وبعد الموافقة سيتم ربطه بالتصنيف تلقائيًا.` : `Continue adding sections, lessons, and pricing as usual. This course cannot be published until an administrator approves ${heldRequest?.name_en ?? "the proposed category"}; it will then be linked automatically.`}</p><small>{heldRequest?.status === "rejected" ? (ar ? "تم رفض الطلب سابقًا؛ ما زال الكورس معلّقًا ويمكن للإدارة اعتماد الطلب لاحقًا." : "The request was previously rejected; the course remains held and an administrator may still approve it later.") : (ar ? "حالة الطلب: بانتظار المراجعة" : "Request status: pending review")}</small></div>}
    <div className="course-workspace-grid"><div><InstructorCourseEditor courseId={courseId} locale={locale} initialSections={sections} /></div><aside><PricingPlanManager courseId={courseId} locale={locale} /></aside></div>
  </div></section>;
}
