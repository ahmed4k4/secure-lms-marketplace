import { describe, it, expect, vi, beforeEach } from 'vitest';

const rateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
  cookies: async () => ({ get: () => undefined }),
}));

beforeEach(() => { rateLimit.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });

describe('auth throttle', () => {
  it('blocks when the limit is exceeded', async () => {
    rateLimit.mockResolvedValue(false);
    const { throttle } = await import('@/actions/helpers');
    expect(await throttle('login')).toEqual({ error: expect.stringContaining('Too many') });
  });
  it('allows when under the limit', async () => {
    rateLimit.mockResolvedValue(true);
    const { throttle } = await import('@/actions/helpers');
    expect(await throttle('login')).toBeNull();
  });
  it('fails open (does not 500 sign-in) if the limiter backend is unavailable', async () => {
    rateLimit.mockRejectedValue(new Error('schema cache reloading'));
    const { throttle } = await import('@/actions/helpers');
    expect(await throttle('login')).toBeNull();
  });
});
