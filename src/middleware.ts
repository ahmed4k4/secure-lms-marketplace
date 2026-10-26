import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/csp';

const PROTECTED = ['/admin', '/instructor', '/dashboard', '/account', '/notifications', '/learn'];

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({ nonce, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', isDev: process.env.NODE_ENV !== 'production', upgradeInsecure: (process.env.NEXT_PUBLIC_SITE_URL ?? '').startsWith('https://') });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  // Optimistic gate: anonymous visitors never reach protected pages. Real authorization is still enforced
  // in every page/route (requireUser / requirePermission) and by Postgres RLS — this only avoids pointless renders.
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith('sb-'));
  const { pathname, search } = request.nextUrl;
  if (!hasSession && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(url);
    redirect.headers.set('Content-Security-Policy', csp);
    return redirect;
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Refresh the Supabase session cookie, but only when a session cookie exists (saves a round trip for anonymous visitors).
  // API routes call requireApiUser() themselves and can refresh cookies in the Route Handler.
  // Skipping this duplicate remote auth lookup cuts an extra Supabase round-trip from each API call.
  const isApiRoute = pathname === '/api' || pathname.startsWith('/api/');
  if (hasSession && !isApiRoute) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    try {
      await supabase.auth.getUser();
    } catch {
      /* Supabase unreachable: continue as anonymous */
    }
  }

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
