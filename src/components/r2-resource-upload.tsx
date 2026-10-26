"use client";
import { useState, type ChangeEvent, type FormEvent } from "react";

type Resource = { id: string; lesson_id: string; title: string; mime_type: string | null; size_bytes: number | null };

function getUploadContentType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExtension: Record<string, string> = {
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    txt: "text/plain", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return byExtension[extension] ?? "application/octet-stream";
}

export function R2ResourceUpload({ lessonId, locale, initialResources }: { lessonId: string; locale: string; initialResources: Resource[] }) {
  const ar = locale === "ar";
  const [resources, setResources] = useState(initialResources);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError("");
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const contentType = getUploadContentType(file);
      const prepare = await fetch("/api/r2/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "resource", lessonId, title: title.trim() || file.name, fileName: file.name, contentType, sizeBytes: file.size }),
      });
      const prepared = await prepare.json() as { uploadId?: string; uploadUrl?: string; requiredHeaders?: Record<string, string>; error?: string };
      if (!prepare.ok || !prepared.uploadId || !prepared.uploadUrl) throw new Error(prepared.error || "Could not prepare the upload");
      const put = await fetch(prepared.uploadUrl, { method: "PUT", headers: prepared.requiredHeaders, body: file });
      if (!put.ok) throw new Error(ar ? "فشل رفع الملف إلى R2. راجع إعدادات CORS في الدلو." : "R2 upload failed. Check bucket CORS settings.");
      const complete = await fetch("/api/r2/complete-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId: prepared.uploadId }) });
      const completed = await complete.json() as { resourceId?: string; error?: string };
      if (!complete.ok || !completed.resourceId) throw new Error(completed.error || "Could not finalize uploaded file");
      setResources((current) => [...current, { id: completed.resourceId!, lesson_id: lessonId, title: title.trim() || file.name, mime_type: contentType, size_bytes: file.size }]);
      setTitle(""); setFile(null); setNotice(ar ? "تم رفع الملف بأمان." : "File uploaded securely.");
      const input = document.getElementById(`r2-file-${lessonId}`) as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (ar ? "فشل رفع الملف." : "Upload failed."));
    } finally { setBusy(false); }
  }

  async function remove(resourceId: string) {
    setError(""); setNotice("");
    try {
      const response = await fetch("/api/r2/delete-resource", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId }) });
      const data = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "Could not delete resource");
      setResources((current) => current.filter((resource) => resource.id !== resourceId));
      setNotice(ar ? "تم حذف الملف." : "File deleted.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Delete failed"); }
  }

  async function download(resourceId: string) {
    setError("");
    try {
      const response = await fetch("/api/r2/download-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId }), cache: "no-store" });
      const data = await response.json() as { downloadUrl?: string; error?: string };
      if (!response.ok || !data.downloadUrl) throw new Error(data.error || "Download is unavailable");
      window.location.assign(data.downloadUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Download failed"); }
  }

  return <div className="r2-resources" style={{ marginTop: 14, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
    <h4>{ar ? "ملفات الدرس" : "Lesson files"}</h4>
    {resources.length > 0 ? <ul style={{ display: "grid", gap: 6, paddingInlineStart: 20 }}>
      {resources.map((resource) => <li key={resource.id} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <span>{resource.title} {resource.size_bytes ? <small className="muted">({(resource.size_bytes / (1024 * 1024)).toFixed(2)} MB)</small> : null}</span>
        <button type="button" className="button button-secondary" onClick={() => void download(resource.id)}>{ar ? "تنزيل" : "Download"}</button><button type="button" className="button button-secondary" onClick={() => void remove(resource.id)}>{ar ? "حذف" : "Delete"}</button>
      </li>)}
    </ul> : <p className="muted">{ar ? "لا توجد ملفات مرفقة." : "No attachments yet."}</p>}
    <form onSubmit={(event) => void upload(event)} style={{ display: "grid", gap: 10, marginTop: 10 }}>
      <label className="form-field"><span>{ar ? "اسم الملف (اختياري)" : "File title (optional)"}</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} /></label>
      <label className="form-field"><span>{ar ? "اختر PDF أو صورة أو مستند Office" : "Choose a PDF, image, or Office document"}</span><input id={`r2-file-${lessonId}`} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.docx,.xlsx,.pptx" onChange={onFileChange} /></label>
      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      <div><button className="button button-secondary" type="submit" disabled={busy || !file}>{busy ? (ar ? "جارٍ الرفع..." : "Uploading...") : (ar ? "رفع ملف إلى R2" : "Upload file to R2")}</button></div>
      <small className="muted">{ar ? "الحد الافتراضي 25MB للملف. الروابط الموقعة مؤقتة ولا يتم نشر الدلو للعامة." : "Default maximum: 25 MB. Download URLs are temporary; the bucket stays private."}</small>
    </form>
  </div>;
}
