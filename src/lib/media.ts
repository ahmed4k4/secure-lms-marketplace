import 'server-only';
import { ApiError, type ApiUser } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { enforceRateLimit, rateLimit } from '@/lib/rate-limit';
import { getSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { serverEnv } from '@/lib/env';
import { clientIp, hashIp, watermarkId } from '@/lib/security';
import { RESOURCE_TYPES, VIDEO_TYPES, resourceKey, sniffMatchesType, sniffVideo, videoKey } from '@/lib/media-rules';
import { deleteObject, headObject, presignGet, presignPut, readHead } from '@/lib/r2';
import type { z } from 'zod';
import type { uploadRequestSchema } from '@/lib/validation';

const MB = 1024 * 1024;
type UploadRequest = z.infer<typeof uploadRequestSchema>;

async function assertCanManageLesson(ctx: ApiUser, lessonId: string) {
  const { data: lesson } = await ctx.supabase.from('lessons').select('id, course_id, type').eq('id', lessonId).maybeSingle();
  if (!lesson) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');
  const { data: ok } = await ctx.supabase.rpc('can_manage_course', { p_course_id: lesson.course_id });
  if (!ok) throw new ApiError(403, 'FORBIDDEN', 'You cannot manage this course.');
  return lesson as { id: string; course_id: string; type: 'video' | 'text' };
}

/** Step 1 of an upload: authorize, validate, record a pending row, and return a short-lived signed PUT URL. */
export async function createUploadSession(ctx: ApiUser, input: UploadRequest) {
  await enforceRateLimit(`upload:${ctx.user.id}`, 3600, 40);
  const lesson = await assertCanManageLesson(ctx, input.lessonId);
  const settings = await getSettings();
  const admin = createAdminClient();

  if (input.kind === 'video') {
    if (lesson.type !== 'video') throw new ApiError(422, 'WRONG_LESSON_TYPE', 'This lesson is not a video lesson.');
    if (!VIDEO_TYPES[input.contentType]) throw new ApiError(415, 'UNSUPPORTED_TYPE', 'Use MP4, WebM or MOV video.');
    if (input.sizeBytes > settings.max_video_mb * MB) throw new ApiError(413, 'FILE_TOO_LARGE', `Maximum video size is ${settings.max_video_mb} MB.`);
    if (input.durationSeconds && input.durationSeconds > settings.max_video_minutes * 60) {
      throw new ApiError(422, 'VIDEO_TOO_LONG', `Maximum video length is ${settings.max_video_minutes} minutes.`);
    }
    const { data: mine } = await admin.from('lesson_videos').select('lesson_id, size_bytes, object_key').eq('uploaded_by', ctx.user.id);
    const used = (mine ?? []).filter((v) => v.lesson_id !== input.lessonId).reduce((n, v) => n + Number(v.size_bytes), 0);
    if (used + input.sizeBytes > settings.instructor_storage_quota_mb * MB) {
      throw new ApiError(413, 'QUOTA_EXCEEDED', 'Your storage quota would be exceeded.');
    }
    const existing = (mine ?? []).find((v) => v.lesson_id === input.lessonId);
    if (existing) {
      await deleteObject(existing.object_key).catch(() => undefined);
      await admin.from('lesson_videos').delete().eq('lesson_id', input.lessonId);
    }
    const key = videoKey(lesson.course_id, input.lessonId, input.contentType);
    const { error } = await admin.from('lesson_videos').insert({
      lesson_id: input.lessonId, object_key: key, content_type: input.contentType, size_bytes: input.sizeBytes,
      duration_seconds: input.durationSeconds ?? null, status: 'pending_upload', uploaded_by: ctx.user.id,
    });
    if (error) throw new ApiError(500, 'DB_ERROR', 'Could not start the upload.');
    const url = await presignPut({ key, contentType: input.contentType, sizeBytes: input.sizeBytes, expiresIn: 900 });
    await audit({ actorId: ctx.user.id, action: 'media.upload_started', entityType: 'lesson', entityId: input.lessonId, metadata: { kind: 'video', sizeBytes: input.sizeBytes } });
    return { uploadId: input.lessonId, url, headers: { 'Content-Type': input.contentType }, expiresInSeconds: 900 };
  }

  // resource
  if (!RESOURCE_TYPES[input.contentType]) throw new ApiError(415, 'UNSUPPORTED_TYPE', 'This file type is not allowed.');
  if (input.sizeBytes > settings.max_resource_mb * MB) throw new ApiError(413, 'FILE_TOO_LARGE', `Maximum file size is ${settings.max_resource_mb} MB.`);
  const { count } = await admin.from('lesson_resources').select('id', { count: 'exact', head: true }).eq('lesson_id', input.lessonId);
  if ((count ?? 0) >= 20) throw new ApiError(422, 'TOO_MANY_RESOURCES', 'A lesson can have at most 20 attachments.');
  const key = resourceKey(lesson.course_id, input.lessonId, input.filename);
  const { data: row, error } = await admin.from('lesson_resources').insert({
    lesson_id: input.lessonId, course_id: lesson.course_id, title: input.filename.slice(0, 200), object_key: key,
    content_type: input.contentType, size_bytes: input.sizeBytes, status: 'pending_upload', uploaded_by: ctx.user.id,
  }).select('id').single();
  if (error || !row) throw new ApiError(500, 'DB_ERROR', 'Could not start the upload.');
  const url = await presignPut({ key, contentType: input.contentType, sizeBytes: input.sizeBytes, expiresIn: 900 });
  return { uploadId: row.id as string, url, headers: { 'Content-Type': input.contentType }, expiresInSeconds: 900 };
}

/** Step 2: verify what actually landed in R2 (size, type, magic bytes) before marking it usable. */
export async function confirmUpload(ctx: ApiUser, kind: 'video' | 'resource', id: string, durationSeconds?: number) {
  const admin = createAdminClient();
  const settings = await getSettings();
  const table = kind === 'video' ? 'lesson_videos' : 'lesson_resources';
  const { data: row } = await admin.from(table).select('*').eq(kind === 'video' ? 'lesson_id' : 'id', id).maybeSingle();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Upload not found.');
  await assertCanManageLesson(ctx, kind === 'video' ? id : row.lesson_id);
  if (row.status === 'ready') return { status: 'ready' as const };

  const fail = async (status: number, code: string, message: string): Promise<never> => {
    await deleteObject(row.object_key).catch(() => undefined);
    await admin.from(table).update({ status: 'failed' }).eq(kind === 'video' ? 'lesson_id' : 'id', id);
    throw new ApiError(status, code, message);
  };

  let head: { size: number; contentType: string };
  try {
    head = await headObject(row.object_key);
  } catch {
    throw new ApiError(409, 'UPLOAD_NOT_FOUND', 'The file has not arrived in storage yet.');
  }
  const maxBytes = (kind === 'video' ? settings.max_video_mb : settings.max_resource_mb) * MB;
  if (head.size !== Number(row.size_bytes) || head.size > maxBytes) await fail(422, 'SIZE_MISMATCH', 'Uploaded file size does not match.');
  if (head.contentType !== row.content_type) await fail(422, 'TYPE_MISMATCH', 'Uploaded file type does not match.');
  if (kind === 'video' && !sniffMatchesType(sniffVideo(await readHead(row.object_key)), row.content_type)) {
    await fail(422, 'NOT_A_VIDEO', 'The file does not look like a valid video.');
  }

  await admin.from(table).update(kind === 'video' ? { status: 'ready', verified_at: new Date().toISOString() } : { status: 'ready' }).eq(kind === 'video' ? 'lesson_id' : 'id', id);
  if (kind === 'video' && durationSeconds && durationSeconds <= settings.max_video_minutes * 60) {
    await admin.from('lesson_videos').update({ duration_seconds: durationSeconds }).eq('lesson_id', id);
    await admin.from('lessons').update({ duration_seconds: durationSeconds }).eq('id', id);
  }
  await audit({ actorId: ctx.user.id, action: 'media.upload_verified', entityType: kind, entityId: id });
  return { status: 'ready' as const };
}

/** Removes every stored object for a lesson (used before deleting the lesson). */
export async function deleteLessonMedia(lessonId: string) {
  const admin = createAdminClient();
  const [{ data: v }, { data: r }] = await Promise.all([
    admin.from('lesson_videos').select('object_key').eq('lesson_id', lessonId),
    admin.from('lesson_resources').select('object_key').eq('lesson_id', lessonId),
  ]);
  await Promise.all([...(v ?? []), ...(r ?? [])].map((o) => deleteObject(o.object_key).catch(() => undefined)));
}

/**
 * Issues a short-lived signed playback URL after re-verifying, in Postgres, that THIS user may
 * access THIS lesson right now. Also enforces concurrent-stream limits and flags account sharing.
 */
export async function issuePlayback(ctx: ApiUser, lessonId: string, sessionId: string, headers: Headers) {
  const secret = serverEnv().PLAYBACK_HMAC_SECRET;
  await enforceRateLimit(`playback:${ctx.user.id}`, 60, 40);

  const { data: allowed } = await ctx.supabase.rpc('can_access_lesson', { p_lesson_id: lessonId });
  if (!allowed) throw new ApiError(403, 'NO_ACCESS', 'You do not have access to this lesson.');

  const admin = createAdminClient();
  const { data: lessonWindow } = await admin.from('lessons').select('availability_starts_at, availability_ends_at, watermark_enabled, seek_allowed').eq('id', lessonId).maybeSingle();
  const now = Date.now();
  if (lessonWindow?.availability_starts_at && now < Date.parse(lessonWindow.availability_starts_at)) throw new ApiError(403, 'LESSON_NOT_OPEN', 'This lesson is not available yet.');
  if (lessonWindow?.availability_ends_at && now >= Date.parse(lessonWindow.availability_ends_at)) throw new ApiError(403, 'LESSON_CLOSED', 'The availability window for this lesson has ended.');
  const { data: video } = await admin.from('lesson_videos').select('object_key, status').eq('lesson_id', lessonId).maybeSingle();
  if (!video || video.status !== 'ready') throw new ApiError(409, 'VIDEO_NOT_READY', 'This video is not available yet.');

  const settings = await getSettings();
  const ipHash = hashIp(clientIp(headers), secret);

  const activeSince = new Date(Date.now() - 90_000).toISOString();
  const { data: active } = await admin.from('playback_sessions').select('session_id').eq('user_id', ctx.user.id).gte('last_seen_at', activeSince);
  const known = (active ?? []).some((s) => s.session_id === sessionId);
  if (!known && (active?.length ?? 0) >= settings.max_concurrent_streams) {
    await audit({ actorId: ctx.user.id, action: 'playback.concurrency_denied', entityType: 'lesson', entityId: lessonId });
    throw new ApiError(429, 'TOO_MANY_STREAMS', 'Too many devices are watching with this account.');
  }

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data: recent } = await admin.from('playback_sessions').select('ip_hash').eq('user_id', ctx.user.id).gte('last_seen_at', dayAgo).limit(500);
  const distinctIps = new Set([...(recent ?? []).map((r) => r.ip_hash), ipHash]).size;
  if (distinctIps >= settings.sharing_ip_threshold) {
    if (await rateLimit(`sharing:${ctx.user.id}`, 3600, 1)) {
      await audit({ actorId: ctx.user.id, action: 'security.suspicious_sharing', entityType: 'user', entityId: ctx.user.id, metadata: { distinctIps24h: distinctIps } });
    }
    if (settings.sharing_block) throw new ApiError(403, 'SUSPICIOUS_SHARING', 'Playback is blocked pending review.');
  }

  if (known) {
    await admin.from('playback_sessions').update({ last_seen_at: new Date().toISOString(), lesson_id: lessonId }).eq('session_id', sessionId).eq('user_id', ctx.user.id);
  } else {
    await admin.from('playback_sessions').insert({ user_id: ctx.user.id, lesson_id: lessonId, session_id: sessionId, ip_hash: ipHash });
    // Only the grant event is logged — never the signed URL.
    await audit({ actorId: ctx.user.id, action: 'playback.grant', entityType: 'lesson', entityId: lessonId });
  }

  const ttl = settings.signed_url_ttl_seconds;
  const url = await presignGet({ key: video.object_key, expiresIn: ttl, disposition: 'inline' });
  return { url, ttlSeconds: ttl, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), watermark: lessonWindow?.watermark_enabled === false ? '' : `ID-${watermarkId(ctx.user.id, secret)}`, seekAllowed: lessonWindow?.seek_allowed !== false };
}
