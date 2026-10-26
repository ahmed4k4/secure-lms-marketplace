# LearnSpace — Secure Multi-Instructor LMS Marketplace

**Source version: 1.2.0**

A bilingual (Arabic RTL / English LTR) learning platform built with Next.js App Router, React, TypeScript, Tailwind CSS, Supabase Auth/PostgreSQL, and Cloudflare R2. The current media workflow uses **private R2 storage for course videos and lesson resources**, plus an optional **separate public R2 bucket for course-cover images**. The private media bucket must never be public. Paid checkout is deliberately disabled in Phase 1.

## Current capabilities

- LearnSpace Design System 2.0 presentation: Carbon/Panel/Steel dark foundation, Arc Blue primary action color, restrained Copper accents, and Readex Pro / IBM Plex Sans Arabic / Sora / JetBrains Mono typography. The design tokens and responsive shared shell are in `src/app/globals.css`.

- Supabase Auth sign-in/registration, email confirmation callback, password recovery and reset.
- Server-verified identity, server-side roles, account-status checks, delegated administrator permissions, same-origin mutation checks, rate limits, audit logging, and PostgreSQL RLS.
- Arabic/English catalog and instructor workspace; course drafts with bilingual titles/descriptions, category, level, language, and an uploadable JPG/PNG/WebP cover image.
- Instructors awaiting approval can create and edit drafts and upload draft content. **They cannot submit drafts for public review until approved**; only an authorized platform administrator can publish a reviewed course.
- Course videos and lesson resources upload directly to private R2 using short-lived signed PUT URLs; Next.js never proxies large video bytes. Small course covers upload through a same-origin Next.js route to avoid browser-to-R2 CORS preflight. Private video/resource objects receive generated object keys and are checked server-side after upload.
- Playback requires a fresh server authorization check (published course/lesson and preview or learner entitlement/enrollment), then returns a short-lived signed R2 GET URL with `no-store` headers. The private media bucket remains non-public.
- Separate public covers bucket so course thumbnails can be shown in the public catalog without exposing private lesson media. Lesson-resource metadata is read under RLS and write-protected from browser roles by migration 0011.
- Course sections/lessons, resources, instructor profiles, pricing plans (free, one-time, limited days, monthly/yearly), free enrollment, student progress, admin moderation, categories, settings, and audit console foundations.
- Payment database foundations are present, but paid checkout, real subscriptions, refunds, provider webhooks, instructor payouts, and automatic recurring billing are **not enabled**.
- Vitest and Playwright scaffolding, schema migrations, setup/security/recovery documentation, and static source checks.

## Stack

- Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4.
- Supabase Auth and PostgreSQL with RLS.
- Cloudflare R2 S3-compatible API (`@aws-sdk/client-s3` and presigned requests).
- Zod, Vitest, React Testing Library, Playwright, ESLint, TypeScript.

## Local setup

1. Use Node.js 22 LTS. Copy `.env.example` to `.env.local` and fill in Supabase and R2 values. Never commit `.env.local`.
2. Create two R2 buckets: a private `lms-private-media` bucket for videos/resources, and a separate `lms-public-covers` bucket for cover images. Only the covers bucket may be exposed through an HTTPS public custom domain or enabled `r2.dev` URL. Details: [R2 setup](docs/R2_SETUP.md).
3. Apply migrations in numeric order, `supabase/migrations/0001_initial_schema.sql` through `0015_single_role_signup_trigger_fix.sql`, to a backed-up **development/staging** Supabase project. If migrations `0001`–`0008` are already applied, apply `0009`–`0012` only if each is missing; if `0009` and `0010` are already applied, apply `0011` and `0012` only if missing, then apply `0013` and `0014` if missing, then apply `0015` to align new-account creation with the single-role key; never reapply an already-recorded migration. Apply only missing migrations in order; do not reset a database to install this update. See [database recovery](docs/DATABASE_RECOVERY.md).
4. Configure Supabase Auth email templates, SMTP, and exact redirect URLs for `/{locale}/auth/callback` and `/{locale}/reset-password`.
5. Install dependencies and run checks:

```bash
npm install
npm run verify:static
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

6. Provision the initial Super Admin using [the one-time bootstrap guide](supabase/BOOTSTRAP_ADMIN.md), after verifying the Supabase URL and server-only service-role key. Remove the bootstrap password from `.env.local` immediately after successful bootstrap.

## Environment variables

Browser-visible values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_APP_URL`.

Server-only values: `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, and `CLOUDFLARE_R2_SECRET_ACCESS_KEY`. Cover uploads also require `CLOUDFLARE_R2_COVERS_BUCKET` and `CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL` (HTTPS, configured for the covers bucket only). Size/expiry overrides are documented in `.env.example` and [R2 setup](docs/R2_SETUP.md).

Never prefix a service-role key, R2 secret, bootstrap password, or other privileged value with `NEXT_PUBLIC_`. If a secret was exposed, rotate it.

## Instructor course workflow

1. A user assigned the `instructor` role can create a draft even if their instructor profile awaits approval. Course creation saves the course as `draft`; it does not grant publication rights.
2. Add a cover image by selecting a local JPG/PNG/WebP file and clicking **Upload cover**, or let the draft form upload the selected image before saving. The file is stored in the dedicated covers bucket through the same-origin server route, not the private video bucket. Set `CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL` to that bucket’s actual public custom domain or enabled `r2.dev` URL (never the S3 API endpoint). HTTPS image URLs are an optional fallback.
3. Add sections and lessons. Video files upload directly to private R2; lesson creation links a one-time upload intent to the lesson. Text lessons can be created without a video file.
4. Configure at least one active pricing plan (a free plan is supported; paid checkout remains disabled).
5. After the instructor profile is approved, submit the draft for review. An authorized Super Admin approves/publishes the course. Approval publishes its lessons only after checking that content and pricing are ready.

## Existing Stream videos

Earlier releases used Cloudflare Stream. This update switches all new uploads/playback to R2, but it cannot move existing provider files automatically. Legacy Stream UIDs remain in the database for reference, while legacy Stream API routes now return HTTP 410. Any existing course video without `lessons.r2_object_key` must be re-uploaded to R2 before its course can pass review or its lesson can play. Do not delete old Stream assets until you intentionally decide they are no longer needed.

## Security boundaries and known limitations

- Private video requests check current user state and effective access server-side before issuing a signed URL. The URL remains a bearer capability until its expiration; revocation cannot invalidate an already-issued URL instantly. Keep its lifetime short and do not log or cache it.
- A visible pseudonymous watermark and disabled download controls are deterrents, not DRM. No browser-only player guarantees prevention of screen recording or external-camera capture.
- R2 direct PUT validates approved MIME/size metadata and checks initial file-signature bytes for supported images/videos/documents, but that is not antivirus or complete media decoding. For public launch, add malware scanning, image re-encoding, upload quotas, shared distributed rate limiting, monitoring/alerts, and operational backups.
- Current rate limiting is in-process and is not shared across serverless instances. Use an edge WAF or shared rate limiter for production.
- R2 object URL delivery depends on your Cloudflare bucket, CORS, public covers domain, and deployment environment being configured correctly. Providers are not provisioned from this archive.
- Schema migration files have not been executed against your live database from this environment. Test the migrations and all roles against staging first.
- The archive does not claim production readiness until dependency installation, lockfile generation, type/lint/test/build checks, SQL migrations, and real Supabase/R2 workflows have been verified. See [verification checklist](docs/VERIFICATION.md).

## Source specification

The original requirements are preserved in [the project specification](docs/PROJECT_SPECIFICATION.md). The explicit R2 requirement in this release overrides the older Stream wording in that source document.

## Project map

- `src/app/[locale]`: localized pages (public, auth, instructor, student, admin).
- `src/app/api`: API routes for courses, admin, R2 uploads/download/playback, enrollments, and progress.
- `src/lib/server`: server authorization, R2 helpers, rate limits, audit logging, and request security.
- `supabase/migrations`: versioned schema, roles, RLS, and media-workflow changes.
- `docs`: R2 setup, API, architecture, security, verification and recovery procedures.


## Current upload limitation

Video uploads show progress but are not resumable yet; interrupted large uploads must be restarted.

## R2 browser uploads and CORS (required)

Browser-to-R2 uploads require an R2 CORS policy on **both** buckets. In Cloudflare Dashboard, open **R2 → bucket → Settings → CORS Policy** and apply a policy with the exact development and production origins (do not use `*` for authenticated production apps). Example for local development:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add your exact deployed HTTPS origin (for example `https://your-domain.example`) to `AllowedOrigins` when deploying. CORS is a bucket configuration and cannot be enabled by Next.js code. The signed upload URL may include `Content-Type` and `If-None-Match`; the browser preflight must allow those headers.

`CLOUDFLARE_R2_COVERS_PUBLIC_BASE_URL` must be a **public custom domain or public bucket URL configured for the covers bucket**, not the S3 API endpoint `https://<account-id>.r2.cloudflarestorage.com/`. The S3 endpoint is for signed API operations and is not a reliable public image-delivery base URL. Keep the videos/resources bucket private; never expose it through a public domain.

## Instructor category proposals

Apply `supabase/migrations/0012_category_requests.sql` after earlier migrations. Instructors can select an existing category or submit a new Arabic/English category proposal. Proposals remain pending and do not appear in the public category list until a Super Admin or an administrator with `categories.manage` approves them. Administrators can review a request with `POST /api/admin/category-requests/{requestId}` and JSON `{ "action": "approve" }` or `{ "action": "reject" }`.

## Super Admin bootstrap

The Super Admin must exist in Supabase Auth and the platform role tables; inserting only a row in `profiles` is not sufficient. Configure `BOOTSTRAP_SUPER_ADMIN_EMAIL`, `BOOTSTRAP_SUPER_ADMIN_PASSWORD`, and `BOOTSTRAP_SUPER_ADMIN_NAME` in `.env.local`, then run `npm run bootstrap:super-admin`. Use a strong temporary password (the bootstrap script enforces its minimum length), sign in, change it, and remove `BOOTSTRAP_SUPER_ADMIN_PASSWORD` from `.env.local`. Do not use `12345678` for an administrator account.

## Authentication & email troubleshooting

Read [`docs/AUTH_EMAIL_SETUP.md`](docs/AUTH_EMAIL_SETUP.md) before testing invitation and password recovery emails, and use [`docs/INSTALLATION_RECOVERY_WINDOWS.md`](docs/INSTALLATION_RECOVERY_WINDOWS.md) if npm keeps using a stale or partial install. Run `npm run auth:email-check` to print the redirect URLs required by the current `NEXT_PUBLIC_APP_URL`, and `npm run auth:diagnose -- instructor@example.com` to verify the target account exists in the configured Supabase Auth project. The diagnostic requires a server-only `SUPABASE_SERVICE_ROLE_KEY`; it never prints it.

Instructor invitations now send users to `/{locale}/setup-account` to choose their first password. Existing invitees who already accepted an old invitation can use Forgot password. Email delivery and Supabase redirect allowlists must be configured in the Supabase dashboard; source code cannot configure provider SMTP for you.
