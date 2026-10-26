/** Pure upload rules (no secrets, unit-tested). */
import { randomUUID } from 'node:crypto';

export const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

export const RESOURCE_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export function sanitizeFilename(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/\.{2,}/g, '.').replace(/^[.-]+/, '');
  return cleaned.slice(0, 80) || 'file';
}

export function videoKey(courseId: string, lessonId: string, contentType: string) {
  const ext = VIDEO_TYPES[contentType];
  if (!ext) throw new Error('unsupported video type');
  return `videos/${courseId}/${lessonId}/${randomUUID()}.${ext}`;
}

export function resourceKey(courseId: string, lessonId: string, filename: string) {
  return `resources/${courseId}/${lessonId}/${randomUUID()}-${sanitizeFilename(filename)}`;
}

/** Magic-byte check of the first bytes of an uploaded video (cheap defence against mislabelled files). */
export function sniffVideo(bytes: Uint8Array): 'mp4' | 'webm' | null {
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') return 'mp4'; // also covers MOV
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  return null;
}

export function sniffMatchesType(sniffed: 'mp4' | 'webm' | null, contentType: string) {
  if (!sniffed) return false;
  return sniffed === 'webm' ? contentType === 'video/webm' : contentType === 'video/mp4' || contentType === 'video/quicktime';
}


export const COVER_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function sniffCover(bytes: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}
