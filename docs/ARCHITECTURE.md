# Architecture

- Next.js App Router provides pages and Node.js route handlers; server-only modules isolate authorization, media access, validation, audit logging, and provider integrations.
- Supabase Auth identifies the user. The server revalidates sessions with `auth.getUser()`, checks profile state, and reads roles through a server-only service-role client. Browser-supplied roles, owner IDs, prices, and entitlement flags are not trusted.
- PostgreSQL RLS and database guards enforce ownership/publication boundaries. Migration `0011` also makes lesson-resource metadata writes server-only so browsers cannot forge private R2 storage paths. Because the service-role key bypasses RLS, every server route using it must include explicit user identity, account status, ownership, and input checks.
- Private Cloudflare R2 holds videos and lesson resources. A separate, dedicated public R2 bucket holds course covers. Direct uploads use short-lived presigned PUTs; playback/download access uses short-lived presigned GETs issued only after server authorization. The app never returns permanent public URLs for private lesson content.
- Migration `0009` restores the R2 upload/playback workflow while retaining legacy Stream columns and rows for reference. Existing Stream-hosted videos are not migrated automatically; they must be re-uploaded to R2.
- Courses and products/pricing plans are separated. Plans describe free, one-time, fixed-duration, monthly, or yearly access. Orders, subscriptions, payment events, refunds, entitlements, and instructor earnings provide future integration foundations, but no payment provider is enabled.
- Audit logs record privileged mutations without storing signed URL bearer tokens or secrets. The current rate limiter is process-local and should be replaced with an edge WAF or shared limiter before multi-instance production.

## Main data relationships

`profiles` → `user_roles` and `instructor_profiles`; `courses` → `sections` → `lessons`; `lessons` → `lesson_resources`; `courses` → course `products` → `pricing_plans`; `orders`/`subscriptions` → `entitlements` → `enrollments`; assessments and progress are tied to courses/lessons and authenticated students. Effective access depends on account status, publication, preview, active entitlement, and enrollment—not a hidden UI link.

## Media workflow

1. Active instructor creates a draft and section; instructor approval does not block draft preparation.
2. Browser requests a short-lived R2 upload URL. The server checks active account/role, course ownership, MIME/size limits, and course state, then inserts a trusted upload intent and signs the generated object key.
3. Browser uploads directly to R2. The server checks actual object size and MIME metadata when finalizing. Video lesson creation claims the uploaded intent once and stores the R2 object key and size on the lesson.
4. Course submission still requires platform instructor approval, at least one section and lesson, all videos ready in private R2, and at least one active pricing plan.
5. The Super Admin review action validates sections, lessons, videos, and pricing before publishing the course and its lessons.
6. Playback checks the user/session, current course and lesson publication state, preview/entitlement/enrollment, then returns a short-lived signed GET URL with no-store headers.

## Pricing workflow

Instructors can configure free lifetime plans, paid one-time plans with lifetime/fixed-day access, and monthly/yearly subscription plans. Stored prices are not evidence of payment. Phase 1 permits free enrollment through the trusted database workflow; paid checkout remains disabled until provider/webhook security, idempotency, cancellations/refunds, commission accounting, and reconciliation are implemented.
