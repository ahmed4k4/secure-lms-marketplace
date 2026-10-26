import { describe, it, expect } from 'vitest';
import { buildCsp } from '@/lib/csp';

describe('CSP', () => {
  const prod = buildCsp({ nonce: 'abc123', supabaseUrl: 'https://proj.supabase.co/', isDev: false });
  it('uses a nonce with strict-dynamic and no unsafe script sources in production', () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
  });
  it('blocks framing, plugins and foreign form posts', () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain('upgrade-insecure-requests');
  });
  it('only allows Supabase and R2 for network/media', () => {
    expect(prod).toContain("connect-src 'self' https://proj.supabase.co https://*.r2.cloudflarestorage.com");
    expect(prod).toContain("media-src 'self' blob: https://*.r2.cloudflarestorage.com");
  });
  it('does not force https upgrades when the site is served over plain http (local production run)', () => {
    expect(buildCsp({ nonce: 'n', supabaseUrl: '', isDev: false, upgradeInsecure: false })).not.toContain('upgrade-insecure-requests');
  });
  it('relaxes eval only in development', () => {
    expect(buildCsp({ nonce: 'n', supabaseUrl: '', isDev: true })).toContain("'unsafe-eval'");
  });
});
