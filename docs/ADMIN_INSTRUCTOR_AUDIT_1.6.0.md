# Admin & Instructor System Review — 1.6.0

## Baselines compared

- `lms-marketplace(2).zip`: earlier LMS baseline used for workflow/visual regression comparison.
- `archai-academy-lms-merged-professional-v1.5.0.zip`: current security/workflow baseline.
- `secure-lms-marketplace-archai-design-system-v1.2.0(1).zip`: separate design-system / alternative app architecture reference.

The design-system archive has a different schema and naming convention (`display_name`, `owner_id`, `user_permissions`, approval booleans), while the merged app uses `full_name`, `created_by`, `role_permissions`, `instructor_profiles.status`, and its own RLS functions/migrations. Its admin UI/data layer cannot be copied directly without schema translation. This update keeps the current database/security contract and incorporates operational patterns rather than merging incompatible database queries.

## Findings addressed

1. **Users missing from Admin → Users.** The page previously queried `profiles` only. Auth users created before the signup trigger or via manual dashboard workflows can exist in `auth.users` without a matching profile row and were therefore invisible. The new `getAdminDirectory` reads Auth users, reconciles missing profiles, assigns only a student role when no role exists, and surfaces failures.
2. **Instructors missing from Admin → Instructors.** The page previously queried only `instructor_profiles`. It now uses role membership as the account directory and joins instructor status/course counts. A role-assigned instructor without an instructor profile is reconstructed as `pending`, not active.
3. **Silent empty states.** Directory and dashboard data errors now produce explicit warning banners instead of appearing to be a valid zero-user state.
4. **No obvious Super Admin course-creation path.** Added `/admin/courses/new`, requiring `courses.manage`, and requiring selection of an active instructor. New courses are created as drafts under that instructor; they are not published automatically. Cover uploads remain same-origin and rate-limited; the upload key belongs to the currently authenticated administrator, then only the public cover URL is attached to the course.
5. **Instructor operations not visible at a glance.** Instructor dashboard now surfaces enrollment, quiz, assignment, ungraded submission and open Q&A counts with direct links to editing, students, assessments and questions.
6. **Admin operations too sparse.** Added quick actions, recent courses and counts for users, instructors, drafts, review queue, published courses, enrollments, assessments, ungraded submissions, pending category requests and recent sharing alerts.

## Existing learning workflows confirmed in source

- Course drafts, sections and lessons.
- Video/resource upload to private Cloudflare R2 and authorization-controlled temporary links (not DRM).
- Instructor category proposals and admin approval workflow.
- Quiz creation, question/answer key separation, publishing and student attempts.
- Assignment creation/publishing, student submission and instructor grading/feedback.
- Lesson Q&A/discussions, private notes, announcements, progress, certificates and reviews.
- Course pricing metadata (free, one-time, monthly, yearly); real payment collection remains deliberately disabled in Phase 1.

## Security notes

- Directory repair runs server-side with the service-role client after the page's permission check. Do not expose the service-role key to the browser.
- Missing roles are repaired to `student` only. A missing instructor profile is set to `pending`; it must be activated by an administrator.
- Admin course creation verifies `courses.manage`, active account state, active instructor profile and instructor role server-side. Browser-provided owner IDs are not trusted without database verification.
- Existing RLS policies and course ownership checks remain the final authorization boundary. Avoid copying SQL policies from the design-system reference because its schema differs.
- The current product uses private Cloudflare R2 for video storage based on the earlier cost/storage decision. The supplied specification also mentions Cloudflare Stream; switching from R2 to Stream is an architectural decision, not a safe drop-in change, and is not silently done here.
- No MFA/2FA flow is introduced, following the existing product decision. This is a security trade-off for privileged accounts and should be documented before production launch.

## Further recommended product features

These are roadmap recommendations, not claimed as implemented in this pass:

- Assignment rubric / weighted gradebook, grade release controls and grade-change history.
- Question banks, randomized question pools, timed exams, retakes, attempt limits and accommodations.
- Instructor/student support tickets and moderation queue.
- CSV exports for enrollment/progress/grade reports, course duplication/templates and bulk enrollment.
- Email delivery provider setup, notification preferences and delivery logs.
- Error monitoring, audit alerts, backup restore rehearsal, dependency scanning and Lighthouse/accessibility runs.
- Payment phase: signed provider webhooks, idempotency, refunds/chargebacks, commission ledger, subscription lifecycle and instructor payout compliance.

## Research references

- Supabase Auth redirect URL configuration: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase Auth and RLS overview: https://supabase.com/docs/guides/auth
- OWASP API Security Top 10 (including broken object-level authorization): https://devguide.owasp.org/en/07-training-education/07-api-top-ten/
- OWASP guidance for testing object-level authorization: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/12-API_Testing/02-API_Broken_Object_Level_Authorization/
- LMS gradebook, assignment groups and learning analytics feature considerations: https://www.instructure.com/resources/blog/essential-features-higher-education-lms

## Verification status

- `node scripts/verify-static.mjs`: passed.
- TypeScript transpile/syntax check of all modified `.ts`/`.tsx` files: passed.
- ZIP integrity check: run after packaging.
- `npm ci`: timed out twice. The environment's Node is 22.16.0; repository `.nvmrc` specifies 22.22.2. Therefore typecheck, ESLint, Vitest, Playwright and production build are **not verified** in this environment.
- Live Supabase/R2 behavior cannot be certified from source inspection alone. Run `docs/TESTING.md` against a staging project after applying all migrations.
