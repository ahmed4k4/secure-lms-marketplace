import "server-only";
import type { AppRole } from "@/lib/server/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CourseRow = { id: string; owner_id: string; status: string; slug: string; title_ar: string; title_en: string };
export type SectionRow = { id: string; course_id: string };
export type LessonRow = {
  id: string;
  section_id: string;
  kind: string;
  is_preview: boolean;
  is_published: boolean;
  processing_status: string;
  r2_object_key: string | null;
  r2_size_bytes: number | null;
  duration_seconds: number | null;
  stream_uid: string | null;
  title_ar: string;
  title_en: string;
};

export async function getCourseForSection(admin: SupabaseClient, sectionId: string) {
  const { data: section, error: sectionError } = await admin.from("sections")
    .select("id,course_id").eq("id", sectionId).maybeSingle();
  if (sectionError || !section) return null;
  const { data: course, error: courseError } = await admin.from("courses")
    .select("id,owner_id,status,slug,title_ar,title_en").eq("id", section.course_id).maybeSingle();
  if (courseError || !course) return null;
  return { section: section as SectionRow, course: course as CourseRow };
}

export async function getCourseForLesson(admin: SupabaseClient, lessonId: string) {
  const { data: lessonData, error: lessonError } = await admin.from("lessons")
    .select("id,section_id,kind,is_preview,is_published,processing_status,r2_object_key,r2_size_bytes,duration_seconds,stream_uid,title_ar,title_en")
    .eq("id", lessonId).maybeSingle();
  if (lessonError || !lessonData) return null;
  const lesson = lessonData as LessonRow;
  const parent = await getCourseForSection(admin, lesson.section_id);
  if (!parent) return null;
  return { ...parent, lesson };
}

export function canManageCourse(course: CourseRow, userId: string, roles: AppRole[]): boolean {
  return course.owner_id === userId || roles.includes("super_admin");
}

export async function canReadLessonContent(input: {
  admin: SupabaseClient;
  userSupabase: SupabaseClient;
  userId: string;
  roles: AppRole[];
  course: CourseRow;
  lesson: LessonRow;
}): Promise<boolean> {
  if (canManageCourse(input.course, input.userId, input.roles)) return true;
  if (input.course.status !== "published" || !input.lesson.is_published) return false;
  if (input.lesson.is_preview) return true;

  const { data: activeEntitlement, error: entitlementError } = await input.userSupabase
    .rpc("has_active_entitlement", { _user_id: input.userId, _course_id: input.course.id });
  if (!entitlementError && activeEntitlement === true) return true;

  // Fail closed: a historical enrollment row must not override an expired or revoked entitlement.
  // The free-enrollment workflow creates both records, so current access should be expressed by the entitlement.
  return false;
}
