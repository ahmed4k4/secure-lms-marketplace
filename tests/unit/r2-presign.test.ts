import { describe, it, expect, beforeAll } from 'vitest';

describe('R2 presigned URLs', () => {
  beforeAll(() => {
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
      R2_ACCOUNT_ID: 'acct123', R2_ACCESS_KEY_ID: 'AKIAEXAMPLE', R2_SECRET_ACCESS_KEY: 'super-secret-value-do-not-leak', R2_BUCKET: 'lms-private',
      PLAYBACK_HMAC_SECRET: 'h'.repeat(40),
    });
  });

  it('upload URL is short-lived and binds content-type and length', async () => {
    const { presignPut } = await import('@/lib/r2');
    const url = new URL(await presignPut({ key: 'videos/c/l/x.mp4', contentType: 'video/mp4', sizeBytes: 12345, expiresIn: 900 }));
    expect(url.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/lms-private/videos/c/l/x.mp4');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.toString()).not.toContain('super-secret-value');
  });

  it('playback URL expires, forces inline disposition and is not cacheable', async () => {
    const { presignGet } = await import('@/lib/r2');
    const url = new URL(await presignGet({ key: 'videos/c/l/x.mp4', expiresIn: 600 }));
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
    expect(url.searchParams.get('response-cache-control')).toBe('private, no-store');
    expect(url.toString()).not.toContain('super-secret-value');
  });

  it('attachment URLs carry a sanitized filename', async () => {
    const { presignGet } = await import('@/lib/r2');
    const url = new URL(await presignGet({ key: 'resources/c/l/a.pdf', expiresIn: 60, disposition: 'attachment', filename: 'a"b\r\n.pdf' }));
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="a_b__.pdf"');
  });
});
