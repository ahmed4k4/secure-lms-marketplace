import { requirePermission } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { getAdminDirectory } from '@/lib/admin-directory';
import { createCourseForInstructorAction } from '@/actions/instructor';
import { CourseFields } from '@/components/course-fields';
import { ActionForm, Field } from '@/components/action-form';
import { Select } from '@/components/ui/primitives';
import Link from 'next/link';

export const metadata = { title: 'Create course' };

export default async function AdminCreateCoursePage() {
  const { admin, supabase } = await requirePermission('courses.manage');
  const { t, locale } = await getT();
  const [{ data: categories, error: categoryError }, directory] = await Promise.all([
    supabase.from('categories').select('id,name_en,name_ar').order('position'),
    getAdminDirectory(admin),
  ]);
  const instructors = directory.users.filter((u) => u.roles.includes('instructor') && u.instructor_status === 'active' && u.status === 'active');
  if (directory.error || categoryError) {
    return <div className="space-y-4"><h1 className="text-3xl">{locale === 'ar' ? 'إضافة كورس' : 'Create course'}</h1><div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">{locale === 'ar' ? `تعذر تحميل المدرسين أو التصنيفات: ${directory.error ?? categoryError?.message}` : `Could not load instructors or categories: ${directory.error ?? categoryError?.message}`}</div></div>;
  }
  if (!instructors.length) return <div className="space-y-4"><h1 className="text-3xl">{locale === 'ar' ? 'إضافة كورس' : 'Create course'}</h1><p className="rounded-lg border border-border bg-card p-4">{locale === 'ar' ? 'لا يوجد مدرس نشط. أنشئ أو فعّل حساب مدرس أولًا.' : 'No active instructor is available. Create or activate an instructor account first.'}</p><Link href="/admin/instructors" className="text-primary underline">{t('admin.instructors')}</Link></div>;
  return <div className="mx-auto max-w-3xl space-y-5"><div><h1 className="text-3xl">{locale === 'ar' ? 'إضافة كورس جديد' : 'Create a course'}</h1><p className="mt-2 text-sm text-muted-foreground">{locale === 'ar' ? 'سيُنشأ الكورس كمسودة باسم المدرس المحدد. لن يتم نشره تلقائيًا.' : 'The course will be created as a draft under the selected instructor. It will not be published automatically.'}</p></div>
    <ActionForm action={createCourseForInstructorAction} submitLabel={locale === 'ar' ? 'إنشاء المسودة وفتح المحرر' : 'Create draft and open editor'}>
      <Field label={locale === 'ar' ? 'مالك الكورس (المدرس)' : 'Course owner (instructor)'} htmlFor="ownerInstructorId"><Select id="ownerInstructorId" name="ownerInstructorId" required defaultValue=""><option value="" disabled>{locale === 'ar' ? 'اختر مدرسًا' : 'Select an instructor'}</option>{instructors.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email} — {u.email}</option>)}</Select></Field>
      <div className="rounded-xl border border-border bg-card p-4"><CourseFields categories={categories ?? []} locale={locale} t={t} /></div>
    </ActionForm>
  </div>;
}
