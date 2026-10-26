# Security

## Honest limitations (read first)

- **No DRM, no anti-recording guarantee.** Browsers cannot prevent screen capture or external cameras. Signed URLs, hidden controls, disabled right-click, `nodownload` and the watermark are **deterrents and attribution aids only**.
- A presigned playback URL is a **bearer link** for its TTL (default 15 min). Anyone holding it can fetch the file until it expires. Concurrency and sharing checks run when URLs are *issued*, not on raw R2 requests. Revocation takes effect at the next grant/refresh/heartbeat (≤ TTL; shorten `signed_url_ttl_seconds` to tighten).
- If you need studio-grade protection, evaluate a DRM-capable platform (Widevine/FairPlay/PlayReady via a provider such as Stream, Mux, VdoCipher) — that is a different cost profile.
- Video duration is client-reported (R2 cannot probe media). Size, type, magic bytes and storage quota *are* verified server-side.

## Threat → control map (OWASP-oriented)

| Risk | Controls (where) |
|---|---|
| **Broken access control / IDOR / BOLA** | RLS on every table with minimal grants (`0003_rls.sql`); `can_manage_course`, `has_course_access`, `can_access_lesson` in SQL; server checks repeated in `lib/media.ts`; ids never trusted (uuid-validated, re-authorized). Tests: `tests/db/rls.test.ts`, `tests/e2e/security.spec.ts`. |
| **Privilege escalation / mass assignment** | Role tables not client-writable; column-level `UPDATE` grants; zod schemas strip unknown keys; `enforce_course_status` trigger; super admins can't be modified from the UI. |
| **Authentication failures** | Supabase Auth, email confirmation, generic login/reset responses (no user enumeration), per-IP throttles, password ≥ 10, single-role authorization and explicit permission checks (MFA intentionally omitted), session revocation on password change. |
| **Injection** | Parameterised PostgREST/SQL only; PostgREST filter input sanitised (`catalog`, `admin/users`, `audit`); no `dangerouslySetInnerHTML`; user text rendered as text (`whitespace-pre-wrap`). |
| **XSS** | Nonce-based CSP with `strict-dynamic` (no `unsafe-inline`/`eval` for scripts in production), React escaping, uploads restricted to an allow-list (no HTML/SVG/JS) and served as attachments. |
| **CSRF** | Supabase cookies are `SameSite=Lax`; mutating route handlers additionally require a same-origin `Origin` and reject `Sec-Fetch-Site: cross-site` (`lib/security.ts`); Server Actions use Next's built-in Origin/Host check. |
| **SSRF / open redirect** | No server-side fetch of user URLs; `safeNext()` allows only same-site relative redirects. |
| **Sensitive data exposure** | Service-role key, R2 keys, HMAC secret are server-only (`server-only` guard); validated lazily by `lib/env.ts`; objects private; keys never returned to clients; signed URLs never logged; `Cache-Control: no-store` on API responses; IPs stored only as keyed hashes; tests assert no secrets in HTML. |
| **Abuse / DoS** | DB-backed rate limits (login, register, reset, upload, playback, progress, download, quiz); size/quota/duration limits; per-account stream cap. |
| **Webhook replay/forgery (phase 2)** | `payment_events` unique `(provider,event_id)`; endpoint disabled (501) until a verified implementation exists. |
| **Auditability** | `audit_logs` (append-only trigger; no client write access) for role changes, suspensions, approvals, grants/revocations, settings, uploads, playback grants, concurrency denials, sharing alerts. |
| **Supply chain** | Exact pins + committed lockfile, `npm audit` in CI (fails on critical), Dependabot recommended. Known residual: PostCSS advisory inside Next's bundled build tooling (build-time only; needs Next major upgrade). |

## Community features

Q&A, notes and announcements are plain text (rendered with React escaping, no HTML/Markdown). Posting needs an active entitlement or manager rights, checked by RLS; `user_id` must equal the caller; replies and notes derive `course_id` server-side; per-user rate limits apply (questions 8/5 min, replies 15, notes 30). Only first names of students are shown to other students (instructors see full names). Notes are never readable by instructors.

## Security headers

Set in `next.config.mjs` (HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP) and `src/middleware.ts` (per-request-nonce CSP: `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`, `connect-src`/`media-src` limited to self, Supabase and `*.r2.cloudflarestorage.com`). R2 CORS should list only your origins.

## Pre-launch checklist

- [ ] All secrets set only in Vercel/host env; `.env.local` never committed; service-role key rotated if ever exposed.
- [ ] R2 bucket private; token scoped to the bucket; CORS lists only your domains.
- [ ] Supabase: confirm email on, redirect URLs exact, custom SMTP, password min length ≥ 10, backups understood (see OPERATIONS).
- [ ] Super Admin created via script and has only the `super_admin` role. MFA is not included in this build; compensate with a unique strong password, custom SMTP/verified recovery URLs, rate limiting, session revocation, account suspension, audit logs, and least privilege.
- [ ] Run the manual checklist in `TESTING.md` on staging with two instructors and two students; attempt cross-tenant access directly via API.
- [ ] Spend/usage alerts on Cloudflare, Supabase, Vercel.
- [ ] Decide TTL / concurrent streams / sharing-block settings for your risk appetite.
- [ ] External penetration test before enabling payments.

## Responding to leaks

Pirated footage with a visible `ID-XXXXXXXXXX` → `npm run watermark:resolve -- ID-XXXXXXXXXX` → review the account in Admin → suspend (bans auth, blocks all requests immediately) and revoke entitlements (also drops live playback sessions). Rotate `PLAYBACK_HMAC_SECRET` only if you accept that previously issued watermark IDs stop resolving.
