import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { ApiError, handle, json, requireApiUser } from '@/lib/api';
import { COVER_TYPES, sniffCover } from '@/lib/media-rules';
import { uploadCoverObject } from '@/lib/r2';
import { enforceRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;
const MAX_COVER_BYTES = 4 * 1024 * 1024;

/** Same-origin, server-side upload to the dedicated public covers bucket; no browser-to-R2 CORS needed. */
export const POST = handle(async (req: NextRequest) => {
  const { supabase, user } = await requireApiUser();
  await enforceRateLimit(`cover-upload:${user.id}`, 3600, 30);
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_COVER_BYTES + 128 * 1024) throw new ApiError(413, 'COVER_TOO_LARGE', 'Cover images must be 4 MB or smaller.');
  const { data: roleRows, error: roleError } = await supabase.from('user_roles').select('roles(key)').eq('user_id', user.id);
  if (roleError) throw new ApiError(503, 'ROLE_CHECK_FAILED', 'Unable to verify account permissions.');
  const roles = (roleRows ?? []).map((row: any) => Array.isArray(row.roles) ? row.roles[0]?.key : row.roles?.key).filter(Boolean);
  const allowed = roles.some((role: string) => ['instructor', 'admin', 'super_admin'].includes(role));
  if (!allowed) throw new ApiError(403, 'COVER_UPLOAD_FORBIDDEN', 'Only course instructors and administrators can upload covers.');
  if (roles.includes('instructor') && !roles.some((role: string) => ['admin', 'super_admin'].includes(role))) {
    const { data: instructor, error } = await supabase.from('instructor_profiles').select('status').eq('user_id', user.id).maybeSingle();
    if (error || instructor?.status !== 'active') throw new ApiError(403, 'INSTRUCTOR_NOT_ACTIVE', 'Instructor approval or activation is required to upload course covers.');
  }

  let form: FormData;
  try { form = await req.formData(); } catch { throw new ApiError(400, 'INVALID_FORM', 'Choose an image file and try again.'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'COVER_REQUIRED', 'Choose a cover image first.');
  if (file.size < 1 || file.size > MAX_COVER_BYTES) throw new ApiError(413, 'COVER_TOO_LARGE', 'Cover images must be between 1 byte and 4 MB.');
  const extension = COVER_TYPES[file.type];
  if (!extension) throw new ApiError(415, 'COVER_TYPE_NOT_ALLOWED', 'Use a JPG, PNG, or WebP image.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffCover(bytes) !== extension) throw new ApiError(415, 'COVER_CONTENT_MISMATCH', 'The selected file content does not match its image type.');
  const key = `covers/${user.id}/${randomUUID()}.${extension}`;
  const result = await uploadCoverObject({ key, bytes, contentType: file.type });
  return json(result, 201);
});
