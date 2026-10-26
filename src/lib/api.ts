import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { ApiError } from '@/lib/api-error';
import { isSameOrigin } from '@/lib/security';
import { publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export { ApiError };

export function assertSameOrigin(req: NextRequest) {
  let siteOrigin = '';
  try {
    siteOrigin = new URL(publicEnv.siteUrl).origin;
  } catch {
    /* ignore */
  }
  const ok = isSameOrigin({
    origin: req.headers.get('origin'),
    secFetchSite: req.headers.get('sec-fetch-site'),
    siteOrigin,
    requestOrigin: req.nextUrl.origin,
  });
  if (!ok) throw new ApiError(403, 'CSRF_BLOCKED', 'Cross-origin request blocked.');
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', Vary: 'Cookie' };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

/** Wraps a route handler: CSRF check on mutations, uniform error shape, no stack leaks. */
export function handle<C = unknown>(fn: (req: NextRequest, ctx: C) => Promise<Response>, opts: { csrf?: boolean } = {}) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      if (opts.csrf !== false && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: { ...NO_STORE, ...e.headers } });
      }
      if (e instanceof ZodError) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid request.', issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
          { status: 400, headers: NO_STORE },
        );
      }
      console.error('[api] unhandled error', (e as Error).message);
      return NextResponse.json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, { status: 500, headers: NO_STORE });
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Body must be valid JSON.');
  }
}

/** Server-verified identity. Never trusts anything sent by the browser. */
export async function requireApiUser() {
  const supabase = await createClient();
  let user = null;
  try {
    user = (await supabase.auth.getUser()).data.user;
  } catch {
    /* treated as unauthenticated */
  }
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required.');
  const { data: profile } = await supabase.from('profiles').select('id, full_name, status').eq('id', user.id).maybeSingle();
  if (!profile) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required.');
  if (profile.status !== 'active') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');
  return { supabase, user, profile };
}
export type ApiUser = Awaited<ReturnType<typeof requireApiUser>>;
