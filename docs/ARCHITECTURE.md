# Architecture

## Shape

```
Browser ──► Next.js (Vercel, Node runtime)
              ├─ Server Components / Actions  ──► Supabase (user-scoped client ⇒ RLS applies)
              ├─ Route Handlers (/api/*)      ──► Supabase (user client for auth; service role only where noted)
              └─ lib/media, lib/r2            ──► Cloudflare R2 (S3 API, presigned URLs)
Browser ──(signed PUT / GET, direct)──────────► private Cloudflare R2 (large media bypasses Next.js)
Browser ──(multipart same-origin POST)────────► Next.js ──► public covers bucket (4 MB image limit)
```

Business logic is organised in `src/lib` modules (auth, api, media, entitlements-in-SQL, rate-limit, audit, settings, payments contract) so it can later be extracted to a NestJS/Node service without rewriting the UI.

**Two Supabase clients, strictly separated**

- `lib/supabase/server.ts` — acts *as the signed-in user*; Row Level Security is the final authority. Used for nearly everything.
- `lib/supabase/admin.ts` — service role, bypasses RLS, `import 'server-only'`. Used for: upload/playback bookkeeping, rate limiting, audit log, auth admin API, admin screens (handed out by `requirePermission()` only after the permission was verified in Postgres).

## Data model (migrations 0001–0014)

All 31 entities from the specification exist, plus `lesson_contents`, `lesson_videos`, `question_keys`, `platform_settings`, `playback_sessions`, `rate_limits` and `role_permissions`.

- **Identity/authorization:** `profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`, `instructor_profiles`. Roles: `super_admin` (implicit all permissions), `admin` (all but `admins.manage`), `instructor`, `student`. Accounts have exactly one platform role; permission checks are role/permission based and no MFA gate is used by product decision.
- **Catalogue/authoring:** `categories`, `courses` (draft → in_review → published | rejected | suspended | archived), `course_instructors`, `sections`, `lessons`, `lesson_contents`, `lesson_videos`, `lesson_resources`.
- **Monetisation (modelled separately, as required):** `products` → `pricing_plans` → `plan_items`; `orders` → `order_items`; `subscriptions`; **`entitlements`** (source, status, product/course, `starts_at`, `expires_at`, revocation fields); `enrollments`.
- **Learning:** `lesson_progress`, `quizzes`, `questions`, `question_keys`, `quiz_attempts`, `assignments`, `submissions`, `reviews`, `certificates`, `notifications`.
- **Phase 2 structures:** `payment_events` (unique `(provider, event_id)` ⇒ idempotent webhooks), `refunds`, `instructor_earnings`.
- **Platform:** `audit_logs` (append-only trigger), `platform_settings`.

### Access = entitlement

`has_course_access(course)` is true only if the course is `published`/`archived` **and** the caller has an entitlement with `status='active'`, not revoked, `starts_at ≤ now()` and (`expires_at` null or in the future). `can_access_lesson(lesson)` adds free previews (published courses, signed-in users only) and manager preview. Because evaluation is time-based in SQL, expiry is enforced even if the nightly sweep hasn't run.

Policies that follow from this (all covered by tests):

- Changing a course's price/model creates a **new** `pricing_plans` row and deactivates the old one. Entitlements are never touched ⇒ purchased lifetime access survives.
- Membership/subscription cancellation follows paid-through-date: `subscriptions.cancel_at_period_end` + the entitlement's `expires_at` = period end.
- Refund/chargeback/admin revocation set `status='revoked'` with `revoked_reason`, `revoked_by`, `revoked_at`.
- Suspended course ⇒ nobody (except managers) can consume it; archived ⇒ existing entitlements keep working.
- Free enrolment is an RPC (`enroll_free_course`) that re-checks the course is free & published and respects admin revocations.

### Row Level Security strategy

`0003_rls.sql` revokes everything from `anon`/`authenticated`, then grants the minimum **per table and per column**, then adds policies. Notable choices:

- Secrets are separate tables/columns: `lesson_videos.object_key` (managers only), `lesson_resources.object_key` (column not granted to clients), `question_keys` (managers only; grading is the `submit_quiz_attempt` RPC).
- `profiles.status`, role assignments, entitlements, enrollments, orders, audit logs, playback sessions, rate limits are **not writable by clients at all**.
- Authors can only move courses draft/rejected → in_review → draft (trigger `enforce_course_status`); publishing/rejecting/suspending needs `courses.review`.
- Writes to `lesson_progress` require `can_access_lesson` in the policy itself, so revoked users are cut off at the database.

### Learning experience tables (migration 0006)

`discussions` + `discussion_replies` (Q&A), `lesson_notes` (private timestamped notes), `announcements`, and `courses.outcomes / requirements / audience` (landing page). RLS: members of a course (active entitlement) and its managers read and post; authors/managers resolve or delete; notes are visible only to their author; announcements are written only by managers. `discussion_replies.course_id` and `lesson_notes.course_id` are derived by triggers, never trusted from the client. `course_catalog` is a view limited to `status='published'` that also exposes safe aggregates (student count, total duration), the public cover URL, and pricing cadence (`price_kind`, `billing_interval`).

## Video and file flow (R2)

**Upload** (`POST /api/uploads` → browser `PUT` to R2 → `POST /api/uploads/confirm`)
1. Server verifies: authenticated, account active, `can_manage_course` for the lesson's course (RLS lookup + RPC), lesson type, MIME allow-list, size ≤ `max_video_mb`, client-reported duration ≤ `max_video_minutes`, per-instructor storage quota, rate limit (40/h).
2. Inserts `lesson_videos(status='pending_upload')` with a random key `videos/{course}/{lesson}/{uuid}.ext`; returns a **15-minute presigned PUT** that signs `Content-Type` and `Content-Length`.
3. Browser uploads directly to R2 (progress via XHR).
4. Confirm: `HeadObject` (size and type must match), ranged `GetObject` of the first bytes (magic-byte sniff: MP4/MOV `ftyp`, WebM EBML), then `status='ready'`. Any mismatch deletes the object and marks the row `failed`. A daily cron purges abandoned `pending_upload`/`failed` objects.

**Playback** (`POST /api/lessons/:id/playback`)
1. Same-origin check, session, account status, rate limit (40/min).
2. **`can_access_lesson` is evaluated by Postgres for this user right now.**
3. Concurrency: max active sessions (default 2; a session is "active" if heartbeat < 90 s) → 429 `TOO_MANY_STREAMS`.
4. Sharing detection: distinct hashed IPs in 24 h ≥ threshold → `security.suspicious_sharing` audit event (optionally block).
5. Returns a presigned GET (default 900 s TTL, `Cache-Control: no-store` on the API response) + a pseudonymous watermark `ID-<10 hex of HMAC(user)>`.
6. The player renders the moving watermark, disables download/context-menu/PiP deterrents, refreshes the URL at 80 % of TTL (re-authorizing), recovers once on playback error, and heartbeats every 20 s through `PUT /api/lessons/:id/progress` (RLS re-checks access; a 403 stops playback).

**Course covers:** `POST /api/uploads/cover` rate-limits the active instructor/admin, validates raster-image signatures, writes only to a separate public covers bucket, and returns its public URL. Browser-to-R2 CORS is not used for cover uploads.

**Attachments:** `GET /api/resources/:id/download` authorizes (RLS + `can_access_lesson`) then 302-redirects to a 60-second presigned URL with `attachment` disposition.

## Authentication & sessions

Supabase Auth (cookie sessions via `@supabase/ssr`, refreshed in `src/middleware.ts`). Email confirmation, instructor invitation, password reset, and "sign out other devices"; no MFA by product decision. Account suspension sets `profiles.status='suspended'` (checked on every request and inside RLS helpers) **and** bans the auth user so no new tokens are issued.

## Internationalisation

Cookie-based locale (`en`/`ar`), `<html lang dir>` set server-side, logical Tailwind utilities (`ms-/me-/ps-/pe-/text-start`) for RTL. Dictionaries are type-checked for key parity and covered by a unit test (identical keys and placeholders).

Course pricing now allows a free plan, one-time purchase, monthly subscription or yearly subscription. The checkout remains a placeholder and does not charge or grant paid access until a payment provider, verified webhooks and entitlement lifecycle are implemented.

## Payments — phase 2 plan

Not implemented in phase 1 and nothing simulates a payment. `src/lib/payments/provider.ts` defines the contract; `/api/webhooks/payments` currently returns 501. To enable:

1. Choose provider and complete the business/compliance decisions (tax, payouts, commission, refund policy).
2. Implement `PaymentProvider` (checkout session creation with an `idempotency_key` on `orders`).
3. Webhook: verify signature on the raw body + timestamp tolerance → insert `payment_events` (duplicate ⇒ no-op) → in one transaction update `orders`/`subscriptions`, create `entitlements` (source `purchase`/`subscription`/`membership`/`bundle` via `plan_items`) and `instructor_earnings` (gross = commission + net).
4. Refund/chargeback handlers revoke the matching entitlements; cancellation sets `cancel_at_period_end`.
5. Enable checkout UI (the placeholder never grants access).

## Key decisions

| Decision | Why |
|---|---|
| R2 + presigned URLs instead of Stream | Cost: no per-minute fees and no egress fees. Trade-off: no transcoding/HLS/DRM. |
| RLS + SECURITY DEFINER helpers | Authorization lives next to data; UI/route bugs can't leak rows. |
| Quiz grading in SQL | Answer keys never leave the database. |
| DB-backed rate limiting | Works on serverless with no paid Redis. |
| Server Actions for CRUD forms, Route Handlers for media/playback/quiz/progress | Actions are concise for forms; the sensitive flows are plain HTTP endpoints that can be tested directly. |
| Custom i18n (no library) | ~40 lines, type-safe keys, zero dependency. |
