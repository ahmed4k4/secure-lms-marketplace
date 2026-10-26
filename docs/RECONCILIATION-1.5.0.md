# LMS merge and regression review — 1.5.0

## Merge decision

The merged baseline is the newer 1.4.1 codebase because it contains the later security and workflow work: rate-limited same-origin cover upload, course-category approval holds, lesson Q&A, media authorization, subscription-ready pricing configuration, and newer database migrations. The older `lms-marketplace(2)` baseline is retained as a visual/behavior regression reference, not blindly overlaid, because several server actions, schema assumptions, and auth contracts differ between versions.

## What was retained from the older system

- The Archai Academy visual direction, hero composition, branded surfaces, course catalog/card layout, responsive navigation, and bilingual Arabic/English structure already present in both codebases.
- The old project's screenshot set is included under `docs/screenshots/` as visual regression references for home (Arabic/English), catalog, course detail, login, and dashboard.
- Older UI components were not copied wholesale where their assumptions conflict with the newer schema or access-control behavior.

## What remains from the newer system

- Newer server-side upload and authorization flows, category approval workflow, Q&A, responsive loading state, R2 upload checks, current SQL migration sequence, and current static verification.
- MFA UI and application flows remain excluded as requested.

## Authentication fixes in 1.5.0

- Provider failures are distinguished: disabled Google/GitHub, rejected redirect URL, and generic OAuth startup errors no longer all look like an expired email link.
- Auth actions log only a short error code/status, not secrets or email contents.
- Email send failures now distinguish rate limiting and redirect allow-list problems from general SMTP/delivery failures.
- Arabic and English messages now give dashboard navigation and actionable configuration steps.
- Added `npm run auth:config` to print the app callback URLs and provider callback URI expected by Google/GitHub. It does not modify Supabase settings.
- Expanded `docs/AUTH_AND_STORAGE_SETUP.md` with exact separation between Google/GitHub's Supabase callback URI and the app's `/auth/callback` route.

## Important external setup requirement

Code cannot enable OAuth providers or configure SMTP inside the user's Supabase project. In Supabase Dashboard, enable Google and GitHub, provide valid provider credentials, configure the redirect allow-list, and set up SMTP for reliable confirmation/reset email. See `docs/AUTH_AND_STORAGE_SETUP.md`.

## Verification performed

- `node scripts/verify-static.mjs`: passed (111 TypeScript/TSX files, 14 migrations, translation parity and security/workflow checks).
- `node scripts/check-auth-config.mjs`: passed and printed local URLs.
- ZIP integrity check: run after packaging.
- `npm ci`, TypeScript, lint, unit tests and production build could not be fully verified in this environment: dependency installation timed out; the available Node runtime is 22.16.0 while this package declares Node >=22.22.2. Do not treat static verification as a successful production build.
