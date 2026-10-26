import 'server-only';
import { headers } from 'next/headers';
import { getT } from '@/lib/i18n';
import { clientIp } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import type { ActionState } from '@/lib/validation';

export async function ipKey() {
  return clientIp(await headers());
}

/** Per-IP throttle for auth-style actions. Returns an ActionState when blocked. */
export async function throttle(bucket: string, max = 10, windowSeconds = 600): Promise<ActionState | null> {
  const { t } = await getT();
  try {
    const ok = await rateLimit(`${bucket}:${await ipKey()}`, windowSeconds, max);
    return ok ? null : { error: t('err.rate_limited') };
  } catch (e) {
    // Sign-in must not break because the limiter backend is briefly unavailable; Supabase Auth enforces its own limits too.
    console.error('[throttle] limiter unavailable, allowing request:', (e as Error).message);
    return null;
  }
}

export async function fail(key: Parameters<Awaited<ReturnType<typeof getT>>['t']>[0]): Promise<ActionState> {
  const { t } = await getT();
  return { error: t(key) };
}

export async function ok(key: Parameters<Awaited<ReturnType<typeof getT>>['t']>[0]): Promise<ActionState> {
  const { t } = await getT();
  return { ok: true, message: t(key) };
}
