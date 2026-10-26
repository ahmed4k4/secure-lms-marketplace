"use client";
import { useState, type FormEvent } from "react";
import { R2ResourceUpload } from "@/components/r2-resource-upload";

type Resource = { id: string; lesson_id: string; title: string; mime_type: string | null; size_bytes: number | null };
type Lesson = { id: string; section_id: string; title_ar: string; title_en: string; kind: string; is_published: boolean; r2_object_key: string | null; stream_uid?: string | null; processing_status?: string; duration_seconds?: number | null; resources: Resource[] };
type Section = { id: string; title_ar: string; title_en: string; sort_order: number; lessons: Lesson[] };

function getVideoContentType(file: File): "video/mp4" | "video/webm" | "video/quicktime" {
  if (file.type === "video/webm" || file.name.toLowerCase().endsWith(".webm")) return "video/webm";
  if (file.type === "video/quicktime" || /\.(mov|qt)$/i.test(file.name)) return "video/quicktime";
  return "video/mp4";
}

export function InstructorCourseEditor({ courseId, locale, initialSections }: { courseId: string; locale: string; initialSections: Section[] }) {
  const ar = locale === "ar";
  const [sections, setSections] = useState(initialSections);
  const [sectionEn, setSectionEn] = useState(""); const [sectionAr, setSectionAr] = useState("");
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, { en: string; ar: string; bodyEn: string; bodyAr: string; kind: "video" | "text"; file: File | null }>>({});
  const [busyKey, setBusyKey] = useState(""); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [uploadProgress, setUploadProgress] = useState(0);

  function draftFor(sectionId: string) { return lessonDrafts[sectionId] ?? { en: "", ar: "", bodyEn: "", bodyAr: "", kind: "video" as const, file: null }; }
  function updateDraft(sectionId: string, patch: Partial<ReturnType<typeof draftFor>>) { setLessonDrafts((old) => ({ ...old, [sectionId]: { ...(old[sectionId] ?? { en: "", ar: "", bodyEn: "", bodyAr: "", kind: "video" as const, file: null }), ...patch } })); }

  async function readJson(response: Response) {
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Request failed");
    return body;
  }

  function uploadFileWithProgress(url: string, headers: Record<string, string>, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("PUT", url);
      Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) resolve();
        else reject(new Error(ar ? `فشل رفع الفيديو (HTTP ${request.status}). راجع CORS وإعدادات R2.` : `Video upload failed (HTTP ${request.status}). Check R2 CORS and bucket settings.`));
      };
      request.onerror = () => reject(new Error(ar ? "انقطع الاتصال أثناء رفع الفيديو. اترك الصفحة مفتوحة وأعد المحاولة." : "The connection failed during upload. Keep this page open and retry."));
      request.onabort = () => reject(new Error(ar ? "تم إلغاء رفع الفيديو." : "Video upload was canceled."));
      request.send(file);
    });
  }

  async function addSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusyKey("section"); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/courses/${courseId}/sections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titleEn: sectionEn, titleAr: sectionAr, sortOrder: sections.length }) });
      const payload = await readJson(response); const section = payload.section as { id: string; title_en: string; title_ar: string; sort_order: number };
      setSections((old) => [...old, { id: section.id, title_en: section.title_en, title_ar: section.title_ar, sort_order: section.sort_order, lessons: [] }]);
      setSectionEn(""); setSectionAr(""); setSuccess(ar ? "تم إنشاء القسم." : "Section created.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create section"); }
    finally { setBusyKey(""); }
  }

  async function addLesson(event: FormEvent<HTMLFormElement>, section: Section) {
    event.preventDefault(); const draft = draftFor(section.id); setBusyKey(section.id); setError(""); setSuccess(""); setUploadProgress(0);
    try {
      let r2UploadId: string | undefined;
      if (draft.kind === "video") {
        if (!draft.file) throw new Error(ar ? "اختَر ملف فيديو أولًا." : "Choose a video file first.");
        const contentType = getVideoContentType(draft.file);
        if (draft.file.size > 1024 * 1024 * 1024) throw new Error(ar ? "الحد الأقصى لحجم الفيديو 1 جيجابايت." : "The maximum video size is 1 GB.");
        const prepareResponse = await fetch("/api/r2/upload-url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: "video", sectionId: section.id, title: draft.ar.trim() || draft.en.trim() || draft.file.name, fileName: draft.file.name, contentType, sizeBytes: draft.file.size }),
        });
        const prepare = await readJson(prepareResponse) as { uploadId: string; uploadUrl: string; requiredHeaders: Record<string, string> };
        await uploadFileWithProgress(prepare.uploadUrl, prepare.requiredHeaders, draft.file);
        setUploadProgress(100);
        await readJson(await fetch("/api/r2/complete-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId: prepare.uploadId }) }));
        r2UploadId = prepare.uploadId;
      }
      const lessonResponse = await fetch(`/api/sections/${section.id}/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titleEn: draft.en, titleAr: draft.ar, kind: draft.kind, bodyEn: draft.bodyEn, bodyAr: draft.bodyAr, r2UploadId, sortOrder: section.lessons.length }) });
      const payload = await readJson(lessonResponse); const lesson = payload.lesson as { id: string; title_en: string; title_ar: string; kind: string; is_published: boolean; processing_status?: string };
      setSections((old) => old.map((item) => item.id !== section.id ? item : { ...item, lessons: [...item.lessons, { id: lesson.id, section_id: section.id, title_en: lesson.title_en, title_ar: lesson.title_ar, kind: lesson.kind, is_published: lesson.is_published, r2_object_key: null, stream_uid: null, processing_status: lesson.processing_status ?? "ready", resources: [] }] }));
      updateDraft(section.id, { en: "", ar: "", bodyEn: "", bodyAr: "", file: null }); setSuccess(ar ? "تم إنشاء الدرس." : "Lesson created.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create lesson"); }
    finally { setBusyKey(""); setUploadProgress(0); }
  }

  return <div className="course-editor">
    {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
    {success ? <div className="notice" role="status">{success}</div> : null}
    <div className="panel" style={{ marginBottom: 20 }}>
      <h2>{ar ? "إضافة قسم" : "Add section"}</h2>
      <form onSubmit={(event) => void addSection(event)} className="editor-grid">
        <label className="form-field"><span>English title</span><input value={sectionEn} onChange={(event) => setSectionEn(event.target.value)} required maxLength={180} /></label>
        <label className="form-field"><span>العنوان بالعربية</span><input value={sectionAr} onChange={(event) => setSectionAr(event.target.value)} required maxLength={180} /></label>
        <button className="button button-primary" type="submit" disabled={busyKey === "section"}>{busyKey === "section" ? (ar ? "جارٍ الحفظ..." : "Saving...") : (ar ? "إنشاء القسم" : "Create section")}</button>
      </form>
    </div>

    {sections.length === 0 ? <div className="empty">{ar ? "أنشئ القسم الأول ثم أضف دروسًا إليه." : "Create a section, then add lessons to it."}</div> : sections.map((section) => {
      const draft = draftFor(section.id);
      return <section key={section.id} className="panel" style={{ marginBottom: 18 }}>
        <div className="dashboard-head"><div><h2>{ar ? section.title_ar : section.title_en}</h2><p className="muted">{section.lessons.length} {ar ? "درس" : "lessons"}</p></div></div>
        {section.lessons.map((lesson) => <article key={lesson.id} className="lesson-editor-row" style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14, marginTop: 14 }}>
          <div><strong>{ar ? lesson.title_ar : lesson.title_en}</strong><p className="muted">{lesson.kind} · {lesson.is_published ? (ar ? "منشور" : "Published") : (ar ? "مسودة" : "Draft")}</p>{lesson.kind === "video" && <div className="lesson-processing-line"><span className={`status-chip ${lesson.processing_status === "ready" ? "status-active" : lesson.processing_status === "error" ? "status-suspended" : "status-pending"}`}>{lesson.processing_status === "ready" ? (ar ? "تم الرفع إلى R2" : "Uploaded to R2") : lesson.processing_status === "error" ? (ar ? "تعذر قراءة الملف" : "Media error") : (ar ? "قيد التجهيز" : "Preparing")}</span><small className="muted">{ar ? "تُخزَّن النسخة الأصلية في الدلو الخاص ولا تُعرض إلا بعد التحقق من صلاحية المشاهدة." : "Stored privately and served only after a server-side access check."}</small></div>}</div>
          {lesson.kind !== "video" ? <p className="muted">{ar ? "محتوى الدرس محفوظ في قاعدة البيانات." : "Lesson text is stored in the database."}</p> : null}
          <R2ResourceUpload lessonId={lesson.id} locale={locale} initialResources={lesson.resources} />
        </article>)}
        <form onSubmit={(event) => void addLesson(event, section)} className="editor-grid" style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid #e2e8f0" }}>
          <h3>{ar ? "إضافة درس جديد" : "Add a lesson"}</h3>
          <label className="form-field"><span>English title</span><input value={draft.en} onChange={(event) => updateDraft(section.id, { en: event.target.value })} required maxLength={180} /></label>
          <label className="form-field"><span>العنوان بالعربية</span><input value={draft.ar} onChange={(event) => updateDraft(section.id, { ar: event.target.value })} required maxLength={180} /></label>
          <label className="form-field"><span>{ar ? "نوع الدرس" : "Lesson type"}</span><select value={draft.kind} onChange={(event) => updateDraft(section.id, { kind: event.target.value as "video" | "text" })}><option value="video">{ar ? "فيديو خاص عبر R2" : "Private R2 video"}</option><option value="text">{ar ? "درس نصي" : "Text lesson"}</option></select></label>
          {draft.kind === "video" ? <><label className="form-field"><span>{ar ? "ملف فيديو MP4 أو WebM أو MOV (حتى 1GB)" : "MP4, WebM, or MOV video (up to 1 GB)"}</span><input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" onChange={(event) => updateDraft(section.id, { file: event.target.files?.[0] ?? null })} required /><small className="form-hint">{ar ? "الرفع مباشر إلى R2 مع مؤشر تقدم. لا تغلق الصفحة أثناء الرفع؛ استكمال الرفع بعد انقطاع الاتصال غير مدعوم بعد." : "Uploads directly to R2 with progress. Keep this page open; resuming an interrupted upload is not supported yet."}</small></label>{busyKey === section.id && draft.file ? <div className="upload-progress-field" role="status" aria-live="polite"><div className="upload-progress-heading"><span>{ar ? "تقدم رفع الفيديو" : "Video upload progress"}</span><strong>{uploadProgress}%</strong></div><progress max={100} value={uploadProgress} aria-label={ar ? "تقدم رفع الفيديو" : "Video upload progress"} /></div> : null}</> : <>
            <label className="form-field"><span>English body</span><textarea rows={3} value={draft.bodyEn} onChange={(event) => updateDraft(section.id, { bodyEn: event.target.value })} maxLength={50000} /></label>
            <label className="form-field"><span>المحتوى بالعربية</span><textarea rows={3} value={draft.bodyAr} onChange={(event) => updateDraft(section.id, { bodyAr: event.target.value })} maxLength={50000} /></label>
          </>}
          <button type="submit" className="button button-primary" disabled={busyKey === section.id}>{busyKey === section.id ? (ar ? "جارٍ الرفع والحفظ..." : "Uploading and saving...") : (ar ? "إنشاء الدرس" : "Create lesson")}</button>
        </form>
      </section>;
    })}
  </div>;
}
