export type R2Purpose = "video" | "resource" | "cover";

const RESOURCE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isAllowedR2ContentType(purpose: R2Purpose, contentType: string): boolean {
  const normalized = contentType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  if (purpose === "video") return VIDEO_TYPES.has(normalized);
  if (purpose === "cover") return COVER_TYPES.has(normalized);
  return RESOURCE_TYPES.has(normalized);
}


/** Conservative magic-byte validation for media that will be served publicly or as video.
 * This is not a malware scanner and does not replace decoding/re-encoding on a trusted worker. */
export function matchesFileSignature(purpose: R2Purpose, contentType: string, bytes: Uint8Array): boolean {
  const mime = contentType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (purpose === "cover" || ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) {
    if (mime === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
    if (mime === "image/png") return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    if (mime === "image/webp") return bytes.length >= 12 && startsWith(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (mime === "application/pdf") return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  }
  if (purpose === "video") {
    if (mime === "video/webm") return startsWith(0x1a, 0x45, 0xdf, 0xa3);
    if (mime === "video/mp4" || mime === "video/quicktime") return bytes.length >= 8 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  }
  if (["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(mime)) {
    return startsWith(0x50, 0x4b, 0x03, 0x04);
  }
  if (purpose === "resource" && (mime === "text/plain" || mime === "text/csv")) {
    return bytes.length > 0 && !bytes.some((byte) => byte === 0);
  }
  return false;
}

export function safeFileExtension(fileName: string, contentType: string): string {
  const byType: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  const normalizedType = contentType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  const expected = byType[normalizedType];
  if (expected) return expected;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{1,8}$/.test(extension) ? extension : "bin";
}

export function safeDisplayFileName(fileName: string): string {
  const normalized = fileName.replace(/[\\/\r\n\0]/g, "_").trim().slice(0, 180);
  return normalized || "file";
}
