'use client';

import { useState } from 'react';
import { Field } from '@/components/action-form';
import { Input, Select } from '@/components/ui/primitives';
import type { Locale } from '@/lib/i18n/shared';

type Category = { id: string; name_en: string; name_ar: string };

/** Makes existing-category selection and new-category proposals mutually exclusive in the form itself. */
export function CourseCategoryField({
  categories, locale, selectedCategoryId, categoryRequestId, categoryLabel, proposalHint, englishLabel, arabicLabel,
}: {
  categories: Category[];
  locale: Locale;
  selectedCategoryId?: string | null;
  categoryRequestId?: string | null;
  categoryLabel: string;
  proposalHint: string;
  englishLabel: string;
  arabicLabel: string;
}) {
  const [categoryId, setCategoryId] = useState(selectedCategoryId ?? '');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');

  function proposeEnglish(value: string) {
    setNameEn(value);
    if (value) setCategoryId('');
  }
  function proposeArabic(value: string) {
    setNameAr(value);
    if (value) setCategoryId('');
  }
  function chooseCategory(value: string) {
    setCategoryId(value);
    if (value) { setNameEn(''); setNameAr(''); }
  }

  return (
    <div className="rounded-xl border border-border bg-deep/70 p-4">
      <input type="hidden" name="existingCategoryRequestId" value={categoryRequestId ?? ''} />
      <h3 className="font-semibold text-silver">{categoryLabel}</h3>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">{proposalHint}</p>
      <Field label={categoryLabel} htmlFor="categoryId">
        <Select id="categoryId" name="categoryId" value={categoryId} onChange={(event) => chooseCategory(event.currentTarget.value)}>
          <option value="">—</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{locale === 'ar' ? category.name_ar : category.name_en}</option>)}
        </Select>
      </Field>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={englishLabel} htmlFor="newCategoryNameEn">
          <Input id="newCategoryNameEn" name="newCategoryNameEn" value={nameEn} onChange={(event) => proposeEnglish(event.currentTarget.value)} maxLength={120} dir="ltr" />
        </Field>
        <Field label={arabicLabel} htmlFor="newCategoryNameAr">
          <Input id="newCategoryNameAr" name="newCategoryNameAr" value={nameAr} onChange={(event) => proposeArabic(event.currentTarget.value)} maxLength={120} />
        </Field>
      </div>
    </div>
  );
}
