import { createHash, createHmac } from 'node:crypto';

/** CSRF defence for cookie-authenticated route handlers: Origin must match this site. */
export function isSameOrigin(args: {
  origin: string | null;
  secFetchSite: string | null;
  siteOrigin: string;
  requestOrigin: string;
}): boolean {
  if (args.secFetchSite === 'cross-site') return false;
  if (!args.origin) return false; // browsers always send Origin on non-GET fetches
  return args.origin === args.siteOrigin || args.origin === args.requestOrigin;
}

/** Stable pseudonymous reference shown in the video watermark. Not reversible without the secret. */
export function watermarkId(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`wm:${userId}`).digest('hex').slice(0, 10).toUpperCase();
}

/** Keyed hash for IPs so raw addresses are never stored. */
export function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(`ip:${ip}`).digest('hex').slice(0, 24);
}

export function sha256(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  return (fwd?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown').slice(0, 64);
}
