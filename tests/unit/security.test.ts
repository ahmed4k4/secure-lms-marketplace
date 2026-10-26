import { describe, it, expect } from 'vitest';
import { hashIp, isSameOrigin, watermarkId } from '@/lib/security';

const base = { siteOrigin: 'https://lms.example.com', requestOrigin: 'https://preview.vercel.app' };

describe('isSameOrigin (CSRF)', () => {
  it('accepts the site and request origin', () => {
    expect(isSameOrigin({ ...base, origin: 'https://lms.example.com', secFetchSite: 'same-origin' })).toBe(true);
    expect(isSameOrigin({ ...base, origin: 'https://preview.vercel.app', secFetchSite: null })).toBe(true);
  });
  it('rejects foreign origins, missing Origin and cross-site fetches', () => {
    expect(isSameOrigin({ ...base, origin: 'https://evil.example', secFetchSite: 'cross-site' })).toBe(false);
    expect(isSameOrigin({ ...base, origin: 'https://evil.example', secFetchSite: null })).toBe(false);
    expect(isSameOrigin({ ...base, origin: null, secFetchSite: null })).toBe(false);
    expect(isSameOrigin({ ...base, origin: 'https://lms.example.com', secFetchSite: 'cross-site' })).toBe(false);
  });
  it('does not accept look-alike origins', () => {
    expect(isSameOrigin({ ...base, origin: 'https://lms.example.com.evil.io', secFetchSite: null })).toBe(false);
  });
});

describe('watermark / ip hashing', () => {
  const secret = 'x'.repeat(40);
  it('is deterministic, pseudonymous and secret-dependent', () => {
    const a = watermarkId('11111111-1111-4111-8111-111111111111', secret);
    expect(a).toMatch(/^[0-9A-F]{10}$/);
    expect(watermarkId('11111111-1111-4111-8111-111111111111', secret)).toBe(a);
    expect(watermarkId('11111111-1111-4111-8111-111111111111', 'y'.repeat(40))).not.toBe(a);
    expect(a).not.toContain('1111');
  });
  it('different users get different watermarks', () => {
    expect(watermarkId('a', secret)).not.toBe(watermarkId('b', secret));
  });
  it('never stores raw IPs', () => {
    const h = hashIp('203.0.113.9', secret);
    expect(h).toMatch(/^[0-9a-f]{24}$/);
    expect(h).not.toContain('203');
  });
});
