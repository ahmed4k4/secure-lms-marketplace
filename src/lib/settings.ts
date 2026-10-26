import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export const SETTING_DEFAULTS = {
  max_concurrent_streams: 2,
  sharing_ip_threshold: 4,
  sharing_block: false,
  signed_url_ttl_seconds: 900,
  max_video_mb: 1024,
  max_video_minutes: 240,
  max_resource_mb: 50,
  instructor_storage_quota_mb: 5120,
  commission_percent: 0,
} as const;

export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : number };

export async function getSettings(): Promise<Settings> {
  const { data } = await createAdminClient().from('platform_settings').select('key, value');
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const row of data ?? []) {
    if (row.key in SETTING_DEFAULTS && typeof row.value === typeof (SETTING_DEFAULTS as Record<string, unknown>)[row.key]) out[row.key] = row.value;
  }
  return out as Settings;
}
