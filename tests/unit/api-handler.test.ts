import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://lms.example.com';
});

const req = (method: string, headers: Record<string, string> = {}) => new NextRequest('https://lms.example.com/api/x', { method, headers });

describe('route handler wrapper', () => {
  it('blocks cross-origin and origin-less mutations (CSRF) before running the handler', async () => {
    const { handle } = await import('@/lib/api');
    let ran = false;
    const h = handle(async () => { ran = true; return new Response('ok'); });
    expect((await h(req('POST'), undefined)).status).toBe(403);
    expect((await h(req('POST', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), undefined)).status).toBe(403);
    expect(ran).toBe(false);
    expect((await h(req('POST', { origin: 'https://lms.example.com' }), undefined)).status).toBe(200);
    expect(ran).toBe(true);
  });
  it('lets GET through and maps errors to a uniform shape without leaking details', async () => {
    const { handle, ApiError } = await import('@/lib/api');
    const forbidden = handle(async () => { throw new ApiError(403, 'NO_ACCESS', 'nope'); });
    const res = await forbidden(req('GET'), undefined);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'NO_ACCESS', message: 'nope' } });
    expect(res.headers.get('cache-control')).toContain('no-store');
    const boom = handle(async () => { throw new Error('db password is hunter2'); });
    const r2 = await boom(req('GET'), undefined);
    expect(r2.status).toBe(500);
    expect(JSON.stringify(await r2.json())).not.toContain('hunter2');
  });
  it('maps validation errors to 400', async () => {
    const { handle } = await import('@/lib/api');
    const { playbackSchema } = await import('@/lib/validation');
    const h = handle(async () => { playbackSchema.parse({ sessionId: '!' }); return new Response('x'); });
    const res = await h(req('GET'), undefined);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
