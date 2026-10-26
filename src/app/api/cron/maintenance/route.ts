import { timingSafeEqual } from 'node:crypto';
import { ApiError, handle, json } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { deleteObject } from '@/lib/r2';
import { serverEnv } from '@/lib/env';

function authorized(header: string | null) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Daily housekeeping (Vercel Cron, free tier): expire entitlements, purge abandoned uploads and old telemetry. */
export const GET = handle(
  async (req) => {
    if (!authorized(req.headers.get('authorization'))) throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid cron credentials.');
    const admin = createAdminClient();
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

    const { data: expired } = await admin.rpc('expire_entitlements');

    let purged = 0;
    for (const table of ['lesson_videos', 'lesson_resources'] as const) {
      const { data } = await admin.from(table).select('object_key').in('status', ['pending_upload', 'failed']).lt('created_at', day(1));
      for (const o of data ?? []) {
        await deleteObject(o.object_key).catch(() => undefined);
        purged++;
      }
      await admin.from(table).delete().in('status', ['pending_upload', 'failed']).lt('created_at', day(1));
    }
    await admin.from('playback_sessions').delete().lt('last_seen_at', day(2));
    await admin.from('rate_limits').delete().lt('window_start', day(1));
    await admin.from('audit_logs').delete().eq('action', 'playback.grant').lt('created_at', day(90));
    return json({ ok: true, expiredEntitlements: expired ?? 0, purgedUploads: purged });
  },
  { csrf: false },
);
