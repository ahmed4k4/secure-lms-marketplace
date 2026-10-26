import { requireInstructor } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { createCourseAction } from '@/actions/instructor';
import { CourseFields } from '@/components/course-fields';
import { ActionForm } from '@/components/action-form';

export const metadata = { title: 'New course' };

export default async function NewCoursePage() {
  const { supabase } = await requireInstructor();
  const { t, locale } = await getT();
  const { data: categories } = await supabase.from('categories').select('id, name_en, name_ar').order('position');
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-3xl">{t('instr.new_course')}</h1>
      <ActionForm action={createCourseAction} submitLabel={t('instr.create_draft')}>
        <CourseFields categories={categories ?? []} locale={locale} t={t} />
      </ActionForm>
    </div>
  );
}
