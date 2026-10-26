## 1.7.1 — TypeScript build fixes

- Made `ActionForm` children optional so action-only forms (for example, sign out other sessions and approve a category request) typecheck without artificial visible fields.
- Added `cover_url` to the public course detail query so the course cover uses a selected field rather than an unavailable property.
- Added `cover_url` to the dashboard's normalized enrolled-course type.
- Updated the PGlite RLS test to read the result from `Results.rows[0]`.
- Verification: static checks and TypeScript/TSX syntax transpilation are run for this release. Full `npm run typecheck`, lint, tests, and production build could not be fully run in this packaging environment because `npm ci` timed out; the runtime here is Node 22.16.0 but the project requires Node 22.22.2 or newer.

## 1.6.0 — Admin/instructor operations and directory repair

- Admin user directory now enumerates Supabase Auth accounts as the source of truth, supports search by name/email/ID plus role/status filters, and reports data-access failures instead of silently showing an empty table.
- Added safe repair for legacy accounts missing a profile or role row. Missing roles are assigned only the least-privileged student role; an instructor-role account missing its instructor profile is reconstructed as pending, never auto-approved.
- Instructor administration now includes all instructor-role accounts, approval state, owned-course counts, and direct account/course navigation.
- Expanded the Super Admin overview with course drafts/review/published counts, quiz/assignment/submission metrics, pending category requests, recent courses, and operational quick actions.
- Added an administrator course-creation flow that assigns the draft to a selected active instructor, checks server-side permissions, and audits the action. Courses remain drafts and are not automatically published.
- Expanded the instructor dashboard with assessment, grading, student enrollment and Q&A summaries, plus direct links to course editor, students, assessments and questions. Existing quiz creation, question management, assignment publishing and grading flows remain in the per-course assessment manager.
- Added static checks for admin directory repair and instructor-owned admin course creation.
- External research aligned security review with Supabase redirect/auth guidance and OWASP API authorization guidance; additional recommendations are documented in the admin audit report.
- Verification: static checks and TypeScript transpile/syntax checks passed. Full `npm ci`, typecheck, lint, unit/e2e tests and production build remain unverified because package installation timed out in this environment and available Node is 22.16.0 while `.nvmrc` requires 22.22.2.

## 1.5.0 — Authentication repair and merge reconciliation

- Added localized, actionable Google/GitHub disabled-provider and redirect-configuration messages.
- Improved email delivery/rate-limit/redirect diagnostics for registration and password reset.
- Added Supabase Auth URL/provider/SMTP setup guide and `npm run auth:config` helper.
- Preserved newer R2/security/workflow implementation while including the older project's visual regression screenshots and documenting why conflicting old server components were not copied wholesale.
- No MFA/2FA flow added.

# Changelog

## 1.4.0 — merged and performance-tuned

- Consolidated the supplied `lms-marketplace` project with the prior Archai Academy release, retaining the richer learning workflows while keeping MFA/TOTP removed as requested.
- Disabled automatic Next.js prefetch on every catalog card to avoid bursts of expensive course-detail requests.
- Enabled allow-listed Next.js image optimization for public R2 cover domains and kept original cover files cached immutably in R2.
- Replaced an exact unread-notification count on every page with a targeted one-row probe.
- Added server-side, on-demand Q&A loading so a lesson's initial render no longer fetches discussions, replies, author profiles and staff memberships until Q&A is opened.
- Removed duplicate middleware auth calls for API requests; every API route continues to verify identity and authorization itself.
- Added additive database indexes for high-frequency notification, catalog and instructor-question queries.
- Added a route-level loading skeleton and tightened lesson-resource/note result limits.
- No real payment processing was introduced; paid checkout remains a labelled Phase 2 placeholder.

## 1.3.0 — LMS polish and feature consolidation

- Apply Archai Design System v2.0 tokens across the LMS: Carbon/Panel/Steel surfaces, restrained Arc Blue and Copper accents, typography, responsive navigation, footer, and reduced-motion/accessibility affordances.
- Add server-side, same-origin course-cover uploads to a dedicated public R2 bucket; validate raster file signatures and document the public URL requirement.
- Keep lesson videos and resources in a private R2 bucket with short-lived, authorized upload/playback URLs.
- Keep account MFA/TOTP out of application routes and gates; retain password/email authentication and role/permission checks.
- Enforce one platform role per account and keep role assignment behind the admin RPC/bootstrap process.
- Support instructor category proposals with an approval hold while allowing the instructor to continue editing; switching to an already-approved category permits the normal review workflow.
- Add free, one-time, monthly, and yearly course pricing metadata via a transactional RPC. Payments and subscription charges remain disabled in phase 1.
- Add regression coverage for single-role accounts, category-hold workflow, and pricing model metadata.
- Update setup/security/testing documentation; the current packaging environment could not finish npm dependency installation, so full typecheck/lint/test/build results remain unverified.

## 1.4.1 — Social sign-in and auth polish
- Added optional Google and GitHub OAuth entry points to login and registration.
- Provider OAuth redirects use the existing callback route and safe internal return-path validation.
- Documented provider setup, callback allow-lists, and secret handling. MFA/TOTP remains intentionally absent.

## 1.6.1 — Supabase service-role privileges

- Added migration `0015_service_role_privileges.sql` to grant the server-only `service_role` explicit access to existing and future public-schema tables, sequences, and functions.
- Kept RLS enabled and avoided granting these privileges to `anon` or `authenticated`.
- Added a deployment guide to resolve `permission denied for table profiles/courses` and verify the correct server key/project pairing.

## 1.6.2 — Course review and publication workflow hardening

- Course approval now performs its privileged write only after the signed-in reviewer passes `courses.review` permission checks.
- Approval validates that the course has an approved category, no pending category request, at least one lesson, and an active instructor profile.
- Review failures are logged with safe diagnostic fields; notification failures no longer make a successfully approved course appear to have failed.
- Revalidates admin overview, course catalog, and course editor paths after review decisions.

## 1.7.0 — Optional learning controls

- Preserves the course review workflow fixes from v1.6.2.
- Adds optional lesson availability windows enforced by the playback-grant API.
- Adds per-lesson moving student watermark toggle and seek restriction.
- Adds instructor settings for quiz duration, per-question timer configuration, attempt limit, shuffle, and availability.
- Adds assignment due date, duration, availability, and late-submission preference.
- Adds migration `0016_optional_learning_controls.sql`.
- Browser controls are deterrents only; external screen recording cannot be reliably blocked by a website. Server-enforced exam timing/essay grading and adaptive multi-quality video transcoding still require dedicated implementation.
