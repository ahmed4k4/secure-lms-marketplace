import { Field } from '@/components/action-form';
import { Input, Select, Textarea } from '@/components/ui/primitives';
import { CourseCoverField } from '@/components/course-cover-field';
import { CourseCategoryField } from '@/components/course-category-field';
import type { DictKey, Locale } from '@/lib/i18n/shared';

type Course = {
  outcomes?: string[]; requirements?: string[]; audience?: string[]; title?: string; subtitle?: string | null;
  description?: string; category_id?: string | null; category_request_id?: string | null; cover_url?: string | null; language?: string; level?: string;
};

export function CourseFields({ course = {}, categories, locale, t }: {
  course?: Course; categories: { id: string; name_en: string; name_ar: string }[]; locale: Locale; t: (k: DictKey) => string;
}) {
  return (
    <>
      <Field label={t('course.f_title')} htmlFor="title"><Input id="title" name="title" required minLength={3} maxLength={140} defaultValue={course.title} /></Field>
      <Field label={t('course.f_subtitle')} htmlFor="subtitle"><Input id="subtitle" name="subtitle" maxLength={200} defaultValue={course.subtitle ?? ''} /></Field>
      <Field label={t('course.f_description')} htmlFor="description"><Textarea id="description" name="description" maxLength={20000} className="min-h-40" defaultValue={course.description} /></Field>
      <CourseCoverField currentUrl={course.cover_url} label={t('course.cover')} chooseLabel={t('course.cover_choose')} hint={t('course.cover_hint')} uploadingLabel={t('course.cover_uploading')} uploadedLabel={t('course.cover_uploaded')} uploadFailedLabel={t('course.cover_upload_failed')} invalidFileLabel={t('course.cover_invalid')} uploadAgainLabel={t('course.cover_upload_again')} />
      <CourseCategoryField
        categories={categories} locale={locale} selectedCategoryId={course.category_id} categoryRequestId={course.category_request_id}
        categoryLabel={t('catalog.category')} proposalHint={t('course.new_category_hint')}
        englishLabel={t('course.new_category_en')} arabicLabel={t('course.new_category_ar')}
      />
      <Field label={t('course.f_outcomes')} htmlFor="outcomes" hint={t('course.f_lines_hint')}><Textarea id="outcomes" name="outcomes" className="min-h-32" defaultValue={(course.outcomes ?? []).join('\n')} /></Field>
      <Field label={t('course.f_requirements')} htmlFor="requirements" hint={t('course.f_lines_hint')}><Textarea id="requirements" name="requirements" defaultValue={(course.requirements ?? []).join('\n')} /></Field>
      <Field label={t('course.f_audience')} htmlFor="audience" hint={t('course.f_lines_hint')}><Textarea id="audience" name="audience" defaultValue={(course.audience ?? []).join('\n')} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('catalog.language')} htmlFor="language">
          <Select id="language" name="language" defaultValue={course.language ?? locale}><option value="en">English</option><option value="ar">العربية</option></Select>
        </Field>
        <Field label={t('course.f_level')} htmlFor="level">
          <Select id="level" name="level" defaultValue={course.level ?? 'all'}>
            {(['all', 'beginner', 'intermediate', 'advanced'] as const).map((l) => <option key={l} value={l}>{t(`level.${l}`)}</option>)}
          </Select>
        </Field>
      </div>
    </>
  );
}
