import 'server-only';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { clientIp, hashIp } from '@/lib/security';

/** Append-only security/admin audit trail. Never throws; never log tokens or secrets in metadata. */
export async function audit(entry: {
  actorId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    let ipHash: string | null = null;
    try {
      ipHash = hashIp(clientIp(await headers()), serverEnv().PLAYBACK_HMAC_SECRET);
    } catch {
      /* outside a request (scripts/cron) */
    }
    const { error } = await createAdminClient().from('audit_logs').insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
      ip_hash: ipHash,
    });
    if (error) console.error('[audit] insert failed', error.message);
  } catch (e) {
    console.error('[audit] failed', (e as Error).message);
  }
}
