import 'server-only';
import { ApiError, type ApiUser } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { getObjectText, presignGet } from '@/lib/r2';
import { enforceRateLimit } from '@/lib/rate-limit';

const SAFE_ASSET = /^(?:master\.m3u8|(?:144|240|270|360|480|540|720|1080)p\/(?:index\.m3u8|segment_\d{5,8}\.ts))$/;
const SESSION_ID = /^[a-f0-9]{32}$/i;

export async function serveHlsAsset(ctx: ApiUser, lessonId: string, assetPathParts: string[], sessionId: string) {
  if (!SAFE_ASSET.test(assetPathParts.join('/')) || !SESSION_ID.test(sessionId)) throw new ApiError(404, 'NOT_FOUND', 'Media asset not found.');
  await enforceRateLimit(`hls:${ctx.user.id}`, 60, 180);
  const { data: allowed } = await ctx.supabase.rpc('can_access_lesson', { p_lesson_id: lessonId });
  if (!allowed) throw new ApiError(403, 'NO_ACCESS', 'Course access is no longer available.');
  const admin = createAdminClient();
  const [{ data: lesson }, { data: video }, { data: session }] = await Promise.all([
    admin.from('lessons').select('availability_starts_at,availability_ends_at').eq('id', lessonId).maybeSingle(),
    admin.from('lesson_videos').select('stream_manifest_key,processing_status,status').eq('lesson_id', lessonId).maybeSingle(),
    admin.from('playback_sessions').select('session_id').eq('session_id', sessionId).eq('user_id', ctx.user.id).eq('lesson_id', lessonId).maybeSingle(),
  ]);
  const now = Date.now();
  if (!lesson) throw new ApiError(404, 'NOT_FOUND', 'Lesson not found.');
  if (lesson.availability_starts_at && now < Date.parse(lesson.availability_starts_at)) throw new ApiError(403, 'LESSON_NOT_OPEN', 'This lesson is not available yet.');
  if (lesson.availability_ends_at && now >= Date.parse(lesson.availability_ends_at)) throw new ApiError(403, 'LESSON_CLOSED', 'This lesson is no longer available.');
  if (!video || video.status !== 'ready' || video.processing_status !== 'ready' || !video.stream_manifest_key) throw new ApiError(409, 'VIDEO_NOT_READY', 'Adaptive video is not ready.');
  if (!session) throw new ApiError(403, 'PLAYBACK_SESSION_INVALID', 'Playback session expired. Reload the lesson.');

  const baseKey = video.stream_manifest_key.slice(0, video.stream_manifest_key.lastIndexOf('/') + 1);
  const rel = assetPathParts.join('/');
  if (rel.endsWith('.m3u8')) {
    const key = rel === 'master.m3u8' ? video.stream_manifest_key : `${baseKey}${rel}`;
    let manifest = await getObjectText(key);
    if (!manifest.startsWith('#EXTM3U')) throw new ApiError(502, 'INVALID_HLS_MANIFEST', 'The video manifest is invalid.');
    manifest = manifest.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      if (rel === 'master.m3u8') {
        if (!/^(?:144|240|270|360|480|540|720|1080)p\/index\.m3u8$/.test(trimmed)) throw new ApiError(502, 'INVALID_HLS_MANIFEST', 'The master playlist contains an invalid rendition path.');
      } else if (!/^segment_\d{5,8}\.ts$/.test(trimmed)) {
        throw new ApiError(502, 'INVALID_HLS_MANIFEST', 'The rendition playlist contains an invalid segment path.');
      }
      const prefix = rel === 'master.m3u8' ? '' : `${rel.split('/')[0]}/`;
      return `/api/lessons/${lessonId}/hls/${prefix}${trimmed}?sessionId=${encodeURIComponent(sessionId)}`;
    }).join('\n');
    return new Response(manifest, { status: 200, headers: {
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Vary': 'Cookie',
    } });
  }

  const key = `${baseKey}${rel}`;
  const url = await presignGet({ key, expiresIn: 75, disposition: 'inline' });
  // R2 CORS must permit this site's origin for signed GETs. Redirects are short-lived; the R2 bucket remains private.
  return Response.redirect(url, 307);
}
