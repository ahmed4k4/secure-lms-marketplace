type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();
/** Local fallback only. Use a shared Redis/Upstash or edge WAF rate limiter in production. */
export function localRateLimit(key: string, limit = 12, windowMs = 60_000): { allowed: boolean; retryAfterSeconds: number } {
 const now = Date.now(); const existing = buckets.get(key);
 if (!existing || existing.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return { allowed: true, retryAfterSeconds: 0 }; }
 if (existing.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt-now)/1000)) };
 existing.count += 1; return { allowed: true, retryAfterSeconds: 0 };
}
