# Changelog

## 1.0.8 — R2 media, cover upload, approval workflow, and review fixes

- Switched new video uploads and authorized playback back to private Cloudflare R2, per the project deployment requirement; Cloudflare Stream routes now return an explicit HTTP 410 deprecation response.
- Added a separate public R2 bucket for course covers and an instructor UI for selecting/uploading JPG, PNG, or WebP cover files. Private video/resource objects remain in the non-public bucket.
- Fixed course draft creation for users with the instructor role while their instructor approval is pending. Submission for public review still requires approval; this does not publish their drafts or grant paid access.
- Removed approval blockers from draft section/lesson/pricing setup while retaining ownership, role, active-account, moderation, and publication protections.
- Reworked the learner video player to fetch short-lived R2 playback URLs only after server-side access validation.
- Hardened course approval to validate sections, lessons, ready R2 videos, and active pricing before publishing both course and lessons.
- Added migration `0009_r2_video_delivery_and_course_covers.sql`, `0010_enforce_entitlement_revocation.sql` to prevent stale enrollment rows from bypassing revoked/expired access, and `0011_server_managed_lesson_resources.sql` to prevent browser clients from forging private R2 attachment paths. Updated environment/setup/security/API documentation.
- Improved instructor review UX: unapproved instructors can prepare drafts, see why review submission is unavailable, and cannot accidentally click a submission action before approval. Added live progress for direct video uploads; interrupted uploads are still not resumable.
- Existing Stream videos are not copied automatically; lessons with no private R2 key need re-uploading. Legacy Stream database metadata is retained.

## 1.0.7 — Previous Stream-based release

- Added authentication, course authoring, course review, instructor profiles, pricing metadata, admin console, and Stream playback workflow. This release is superseded for media delivery by 1.0.8.

## 1.0.6 and earlier

See migration history and earlier release documentation for database role recovery, authentication bootstrap, RLS helper repair, and admin console foundations.


## 1.1.0 — Authentication lifecycle and responsive navigation

- Invitation links now lead to a first-password setup flow for instructors and other invited users.
- Password recovery callback now carries an explicit recovery flow marker so expired/invalid links return to a useful recovery screen.
- Added same-locale callback destination validation, Supabase Auth diagnostic tooling, and SMTP/redirect allowlist instructions.
- Rebuilt the navbar as a responsive, accessible, role-aware navigation component.
- Fixed ESLint 9 compatibility with the Next.js 15 legacy presets using FlatCompat.
- Validation completed in the authoring environment: static syntax/structure checks, JavaScript script checks, and safe-redirect helper checks. Full package install/typecheck/build could not be run because npm dependency installation timed out.

## 1.2.0 — Design System 2.0 and marketplace UI rebuild

- Applied the attached design system's Carbon/Panel/Steel palette, Arc Blue signal color, restrained Copper accents, and requested Arabic/Latin/mono font families.
- Rebuilt the landing hero, discovery/search entry points, category cards, course cards, shared control surfaces, footer CTA, and responsive navigation.
- Added focus-visible support, skip-to-content navigation, and reduced-motion safeguards.
- Added `docs/DESIGN_SYSTEM.md` and recorded official course-discovery research references.
- Found and fixed an important migration compatibility issue: after making `user_roles.user_id` the single-role primary key, the historic Auth signup trigger still used the old `(user_id, role)` conflict target. Migration `0015_single_role_signup_trigger_fix.sql` updates the trigger so new sign-ups can still receive the default student role.
- Static TypeScript/TSX syntax and structural checks pass. Full dependency installation/typecheck/lint/tests/build and live DB/provider checks remain unverified because npm registry access timed out in the authoring environment.
