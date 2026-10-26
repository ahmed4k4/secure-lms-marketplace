/**
 * HTTP-level security tests. They hit the real route handlers directly (no UI), exactly like an attacker would.
 * They need no Supabase data: unauthenticated and cross-origin requests must be refused before any data access.
 * Browser-driven flows (login, upload, playback) require a live Supabase + R2 project: see docs/TESTING.md.
 */
import { test, expect } from '@playwright/test';

const uuid = '3f2a1c9e-8b7d-4e6f-9a10-1234567890ab';
const sameOrigin = (baseURL: string | undefined) => ({ origin: baseURL ?? 'http://localhost:3000' });

test.describe('API authorization (no session)', () => {
  test('health is public', async ({ request }) => {
    expect((await request.get('/api/health')).status()).toBe(200);
  });

  test('upload session creation requires authentication', async ({ request, baseURL }) => {
    const r = await request.post('/api/uploads', { headers: sameOrigin(baseURL), data: { kind: 'video', lessonId: uuid, contentType: 'video/mp4', sizeBytes: 10 } });
    expect(r.status()).toBe(401);
    expect((await r.json()).error.code).toBe('UNAUTHENTICATED');
  });

  test('upload confirmation requires authentication', async ({ request, baseURL }) => {
    expect((await request.post('/api/uploads/confirm', { headers: sameOrigin(baseURL), data: { kind: 'video', id: uuid } })).status()).toBe(401);
  });

  test('lesson Q&A is deferred but still requires a signed-in course user', async ({ request }) => {
    const r = await request.get(`/api/lessons/${uuid}/qa?scope=lesson`);
    expect(r.status()).toBe(401);
    expect((await r.json()).error.code).toBe('UNAUTHENTICATED');
    expect(r.headers()['cache-control']).toContain('no-store');
  });

  test('playback tokens are never issued to anonymous callers', async ({ request, baseURL }) => {
    const r = await request.post(`/api/lessons/${uuid}/playback`, { headers: sameOrigin(baseURL), data: { sessionId: 'abcdef123456' } });
    expect(r.status()).toBe(401);
    expect(r.headers()['cache-control']).toContain('no-store');
    expect(JSON.stringify(await r.json())).not.toMatch(/X-Amz|signature|token/i);
  });

  test('playback with a malformed lesson id is a 404, not a 500', async ({ request, baseURL }) => {
    expect((await request.post('/api/lessons/not-a-uuid/playback', { headers: sameOrigin(baseURL), data: { sessionId: 'abcdef123456' } })).status()).toBe(404);
  });

  test('progress, quiz attempts and attachment downloads require authentication', async ({ request, baseURL }) => {
    expect((await request.put(`/api/lessons/${uuid}/progress`, { headers: sameOrigin(baseURL), data: { positionSeconds: 1 } })).status()).toBe(401);
    expect((await request.post(`/api/quizzes/${uuid}/attempt`, { headers: sameOrigin(baseURL), data: { answers: {} } })).status()).toBe(401);
    expect((await request.get(`/api/resources/${uuid}/download`, { maxRedirects: 0 })).status()).toBe(401);
  });

  test('cron endpoint rejects missing or wrong credentials', async ({ request }) => {
    expect((await request.get('/api/cron/maintenance')).status()).toBe(401);
    expect((await request.get('/api/cron/maintenance', { headers: { authorization: 'Bearer wrong' } })).status()).toBe(401);
  });

  test('payment webhook is disabled in phase 1', async ({ request }) => {
    const r = await request.post('/api/webhooks/payments', { data: { type: 'payment.succeeded' } });
    expect(r.status()).toBe(501);
  });
});

test.describe('CSRF', () => {
  test('cross-origin mutations are blocked before authentication runs', async ({ request }) => {
    const r = await request.post('/api/uploads', { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, data: {} });
    expect(r.status()).toBe(403);
    expect((await r.json()).error.code).toBe('CSRF_BLOCKED');
  });
  test('mutations without an Origin header are blocked', async ({ request }) => {
    expect((await request.post('/api/uploads/confirm', { data: {} })).status()).toBe(403);
  });
});

test.describe('page protection and headers', () => {
  for (const path of ['/admin', '/admin/users', '/instructor', '/dashboard', '/account', '/notifications', `/learn/some-course/${uuid}`]) {
    test(`${path} redirects anonymous visitors to sign-in`, async ({ request }) => {
      const r = await request.get(path, { maxRedirects: 0 });
      expect([302, 303, 307, 308]).toContain(r.status());
      expect(r.headers().location).toContain('/login');
    });
  }

  test('responses carry a nonce-based CSP and hardening headers', async ({ request }) => {
    const r = await request.get('/login');
    expect(r.status()).toBe(200);
    const h = r.headers();
    expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[\w+/=]+' 'strict-dynamic'/);
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('no server secrets leak into HTML', async ({ request }) => {
    const html = await (await request.get('/login')).text();
    for (const secret of ['placeholder-service', 'sk', 'PLAYBACK_HMAC_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'R2_SECRET_ACCESS_KEY']) {
      if (secret.length > 3) expect(html).not.toContain(secret);
    }
  });

  test('public pages degrade gracefully when the database is unreachable', async ({ request }) => {
    for (const path of ['/', '/courses', '/courses?q=%27%3Bdrop--']) expect((await request.get(path)).status()).toBe(200);
  });
});

test.describe('localization and RTL', () => {
  test('defaults to English LTR', async ({ request }) => {
    const html = await (await request.get('/login')).text();
    expect(html).toMatch(/<html[^>]*lang="en"[^>]*dir="ltr"/);
  });
  test('Arabic cookie switches to RTL with Arabic copy', async ({ request }) => {
    const html = await (await request.get('/login', { headers: { cookie: 'locale=ar' } })).text();
    expect(html).toMatch(/<html[^>]*lang="ar"[^>]*dir="rtl"/);
    expect(html).toContain('تسجيل الدخول');
  });
});
