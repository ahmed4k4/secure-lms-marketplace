import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api-error';

/** Returns true when the call is allowed. Backed by Postgres (rate_limit_hit), so it works on serverless for free. */
export async function rateLimit(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds, p_max: max });
  if (error) throw new Error(`rate limit backend error: ${error.message}`);
  return data === true;
}

export async function enforceRateLimit(key: string, windowSeconds: number, max: number) {
  if (!(await rateLimit(key, windowSeconds, max))) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', { 'Retry-After': String(windowSeconds) });
  }
}
