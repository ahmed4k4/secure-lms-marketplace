/** Content-Security-Policy builder (pure, unit-tested). */
export function buildCsp(opts: { nonce: string; supabaseUrl: string; isDev: boolean; upgradeInsecure?: boolean }) {
  let supabaseOrigin = '';
  try {
    supabaseOrigin = new URL(opts.supabaseUrl).origin;
  } catch {
    /* unset in some build contexts */
  }
  const r2 = 'https://*.r2.cloudflarestorage.com';
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${opts.nonce}'`, "'strict-dynamic'", ...(opts.isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", supabaseOrigin, r2, ...(opts.isDev ? ['ws:'] : [])].filter(Boolean),
    'media-src': ["'self'", 'blob:', r2],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  const body = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
  // Only upgrade when the site itself is served over https; on plain-http localhost it would break same-origin fetches.
  return !opts.isDev && (opts.upgradeInsecure ?? true) ? `${body}; upgrade-insecure-requests` : body;
}
