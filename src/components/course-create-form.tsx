"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Category = { id: string; nameEn: string; nameAr: string };
type UploadResponse = { uploadId?: string; publicUrl?: string; error?: string; categoryApprovalPending?: boolean };

export function CourseCreateForm({ locale, categories = [] }: { locale: string; categories?: Category[] }) {
  const ar = locale === "ar";
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const [form, setForm] = useState({ slug: "", titleEn: "", titleAr: "", summaryEn: "", summaryAr: "", descriptionEn: "", descriptionAr: "", language: "ar", level: "all_levels", categoryId: "", thumbnailUrl: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [coverUploadedUrl, setCoverUploadedUrl] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);
  const [categorySuggestion, setCategorySuggestion] = useState({ nameEn: "", nameAr: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => () => { if (coverPreview.startsWith("blob:")) URL.revokeObjectURL(coverPreview); }, [coverPreview]);

  function slugify(value: string) { return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100); }
  function update(key: keyof typeof form, value: string) { setForm((old) => ({ ...old, [key]: value, ...(key === "titleEn" && !slugTouched ? { slug: slugify(value) } : {}) })); }

  async function uploadCoverFile(file: File): Promise<string> {
    if (file.size > 4 * 1024 * 1024) throw new Error(t("The cover image must be 4 MB or smaller.", "يجب ألا يتجاوز حجم صورة الغلاف 4 ميجابايت."));
    const contentType = file.type.toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error(t("Choose a JPG, PNG, or WebP image.", "اختر صورة JPG أو PNG أو WebP."));
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch("/api/r2/upload-cover", { method: "POST", body: formData });
    const result = await response.json() as UploadResponse;
    if (!response.ok || !result.publicUrl) throw new Error(result.error || t("Could not upload the cover image.", "تعذر رفع صورة الغلاف."));
    setCoverUploadedUrl(result.publicUrl);
    setCoverPreview(result.publicUrl);
    setForm((old) => ({ ...old, thumbnailUrl: result.publicUrl! }));
    return result.publicUrl;
  }

  async function uploadCover() {
    if (!coverFile) return;
    setError(""); setCoverBusy(true);
    try { await uploadCoverFile(coverFile); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t("Could not upload the cover image.", "تعذر رفع صورة الغلاف.")); }
    finally { setCoverBusy(false); }
  }


  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      let thumbnailUrl = form.thumbnailUrl;
      if (coverFile && !coverUploadedUrl) thumbnailUrl = await uploadCoverFile(coverFile);
      const proposalComplete = categorySuggestion.nameEn.trim().length >= 2 && categorySuggestion.nameAr.trim().length >= 2;
      const proposalPartial = Boolean(categorySuggestion.nameEn.trim()) !== Boolean(categorySuggestion.nameAr.trim());
      if (proposalPartial) throw new Error(t("Enter the proposed category name in both languages, or clear both fields.", "اكتب اسم التصنيف باللغتين أو اترك الحقلين فارغين."));
      const payloadInput = { ...form, thumbnailUrl, ...(proposalComplete && !form.categoryId ? { proposedCategory: { nameEn: categorySuggestion.nameEn.trim(), nameAr: categorySuggestion.nameAr.trim() } } : {}) };
      const response = await fetch("/api/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payloadInput) });
      const payload = await response.json() as { error?: string; issues?: Array<{ path?: Array<string | number>; message: string }>; categoryApprovalPending?: boolean; course?: { id: string; slug: string; status: string } };
      if (!response.ok) throw new Error(payload.issues?.[0]?.message || payload.error || t("Could not create course", "تعذر إنشاء الكورس"));
      router.push(payload.course?.id ? `/${locale}/instructor/courses/${payload.course.id}` : `/${locale}/instructor/courses`); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("Could not create course", "تعذر إنشاء الكورس")); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="course-create-form">
    <div className="course-form-section"><div><span className="step-number">01</span></div><div className="course-form-section-content"><h2>{t("Course identity", "بيانات الكورس")}</h2><p className="muted">{t("Give your course a clear title and a clean URL.", "اكتب عنوانًا واضحًا ورابطًا مختصرًا مناسبًا.")}</p><div className="editor-grid"><label className="form-field"><span>{t("Course title (English)", "عنوان الكورس بالإنجليزية")}</span><input value={form.titleEn} onChange={(e) => update("titleEn", e.target.value)} required minLength={3} maxLength={180} /></label><label className="form-field"><span>{t("Course title (Arabic)", "عنوان الكورس بالعربية")}</span><input value={form.titleAr} onChange={(e) => update("titleAr", e.target.value)} required minLength={3} maxLength={180} /></label><label className="form-field"><span>{t("Course URL slug", "الرابط المختصر للكورس")}</span><input value={form.slug} onChange={(e) => { setSlugTouched(true); update("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/--+/g, "-").replace(/^-|-$/g, "").slice(0, 100)); }} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" minLength={3} maxLength={100} dir="ltr" /><small className="form-hint">{t("Use English letters, numbers, and hyphens only.", "استخدم الحروف الإنجليزية والأرقام والشرطة فقط.")}</small></label><label className="form-field"><span>{t("Course language", "لغة الكورس")}</span><select value={form.language} onChange={(e) => update("language", e.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="both">{t("Arabic and English", "العربية والإنجليزية")}</option></select></label></div></div></div>

    <div className="course-form-section"><div><span className="step-number">02</span></div><div className="course-form-section-content"><h2>{t("Audience & discovery", "الجمهور واكتشاف الكورس")}</h2><p className="muted">{t("Help students find the right course and understand its level.", "ساعد الطلاب على إيجاد الكورس المناسب وفهم مستواه.")}</p><div className="editor-grid"><label className="form-field"><span>{t("Category", "التصنيف")}</span><select value={form.categoryId} onChange={(e) => { update("categoryId", e.target.value); if (e.target.value) setCategorySuggestion({ nameEn: "", nameAr: "" }); }}><option value="">{t("Choose a category", "اختر تصنيفًا")}</option>{categories.map((category) => <option key={category.id} value={category.id}>{ar ? category.nameAr : category.nameEn}</option>)}</select></label><div className="form-field full-span category-request-box"><strong>{t("Can't find your category? Add a proposal", "لم تجد التصنيف المناسب؟ اقترح تصنيفًا")}</strong><p className="form-hint">{t("Choose either an existing category above or suggest a new one here. Continue creating the entire course normally. If the category is new, the course can be prepared and submitted for review, but it cannot be published until an administrator approves the category.", "أكمل إنشاء الكورس وكل تفاصيله بشكل طبيعي. إذا كان التصنيف جديدًا، يمكنك تجهيز الكورس وإرساله للمراجعة، لكن لن يُنشر قبل موافقة الإدارة على التصنيف.")}</p><div className="editor-grid"><label className="form-field"><span>{t("Proposed category (English)", "التصنيف المقترح بالإنجليزية")}</span><input value={categorySuggestion.nameEn} disabled={Boolean(form.categoryId)} onChange={(e) => setCategorySuggestion((v) => ({ ...v, nameEn: e.target.value }))} maxLength={120} /></label><label className="form-field"><span>{t("التصنيف المقترح بالعربية", "التصنيف المقترح بالعربية")}</span><input value={categorySuggestion.nameAr} disabled={Boolean(form.categoryId)} onChange={(e) => setCategorySuggestion((v) => ({ ...v, nameAr: e.target.value }))} maxLength={120} /></label></div></div><label className="form-field"><span>{t("Difficulty level", "مستوى الكورس")}</span><select value={form.level} onChange={(e) => update("level", e.target.value)}><option value="all_levels">{t("All levels", "كل المستويات")}</option><option value="beginner">{t("Beginner", "مبتدئ")}</option><option value="intermediate">{t("Intermediate", "متوسط")}</option><option value="advanced">{t("Advanced", "متقدم")}</option></select></label>
      <div className="form-field full-span cover-upload-field"><span>{t("Course cover image", "صورة غلاف الكورس")}</span><label className="cover-dropzone" htmlFor="course-cover-file">{coverPreview ? <img src={coverPreview} alt={t("Course cover preview", "معاينة غلاف الكورس")} /> : <span className="cover-placeholder"><strong>＋</strong><b>{t("Choose a cover image", "اختر صورة الغلاف")}</b><small>{t("JPG, PNG, WebP · up to 4 MB", "JPG أو PNG أو WebP · حتى 4 ميجابايت")}</small></span>}<input id="course-cover-file" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={coverBusy || busy} onChange={(e) => { const file = e.target.files?.[0] ?? null; setCoverFile(file); setCoverUploadedUrl(""); setForm((old) => ({ ...old, thumbnailUrl: "" })); setCoverPreview(file ? URL.createObjectURL(file) : ""); }} /></label><div className="cover-upload-actions"><small className="form-hint">{t("The image is stored in a separate public R2 bucket; video files stay in private storage.", "تُحفظ الصورة في دلو R2 عام منفصل، بينما تظل ملفات الفيديو في التخزين الخاص.")}</small><button type="button" className="button button-secondary" onClick={() => void uploadCover()} disabled={!coverFile || coverBusy || Boolean(coverUploadedUrl)}>{coverBusy ? t("Uploading cover…", "جارٍ رفع الغلاف…") : coverUploadedUrl ? t("Cover uploaded ✓", "تم رفع الغلاف ✓") : t("Upload cover", "رفع الغلاف")}</button></div>{!coverFile && <label className="form-field cover-url-fallback"><span>{t("Or use an existing HTTPS image URL", "أو استخدم رابط صورة HTTPS موجودًا")}</span><input type="url" dir="ltr" placeholder="https://example.com/course-cover.webp" value={form.thumbnailUrl} onChange={(e) => update("thumbnailUrl", e.target.value)} maxLength={2048} /></label>}</div>
    </div></div></div>

    <div className="course-form-section"><div><span className="step-number">03</span></div><div className="course-form-section-content"><h2>{t("Course description", "وصف الكورس")}</h2><p className="muted">{t("Explain the outcome students should expect.", "اشرح النتيجة التي سيحققها الطالب من الكورس.")}</p><div className="editor-grid"><label className="form-field"><span>{t("Short summary (English)", "ملخص قصير بالإنجليزية")}</span><textarea rows={3} maxLength={500} value={form.summaryEn} onChange={(e) => update("summaryEn", e.target.value)} /></label><label className="form-field"><span>{t("الملخص القصير بالعربية", "الملخص القصير بالعربية")}</span><textarea rows={3} maxLength={500} value={form.summaryAr} onChange={(e) => update("summaryAr", e.target.value)} /></label><label className="form-field"><span>{t("Full description (English)", "الوصف الكامل بالإنجليزية")}</span><textarea rows={6} maxLength={20000} value={form.descriptionEn} onChange={(e) => update("descriptionEn", e.target.value)} /></label><label className="form-field"><span>{t("الوصف الكامل بالعربية", "الوصف الكامل بالعربية")}</span><textarea rows={6} maxLength={20000} value={form.descriptionAr} onChange={(e) => update("descriptionAr", e.target.value)} /></label></div></div></div>

    {error && <div role="alert" className="notice notice-error">{error}</div>}
    <div className="course-create-footer"><p className="muted">{t("Your course is saved as a draft. You can prepare the content while your instructor profile is awaiting approval, but public submission still requires platform approval and course review.", "سيُحفظ الكورس كمسودة. يمكنك تجهيز المحتوى حتى لو كان اعتماد حساب المدرس قيد الانتظار، لكن الإرسال للنشر العام يتطلب اعتماد الحساب ومراجعة الكورس.")}</p><button className="button button-primary" type="submit" disabled={busy || coverBusy}>{busy ? t("Saving draft…", "جارٍ حفظ المسودة…") : t("Save course draft", "حفظ مسودة الكورس")}</button></div>
  </form>;
}
