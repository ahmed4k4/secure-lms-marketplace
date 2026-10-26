# Security checklist and current boundaries

## Implemented foundations

- Server-verified Supabase Auth identity and server-only role lookup through a service-role client.
- Account-state checks, role assignment, delegated admin permissions, same-origin mutation checks, Zod input validation, rate limits, and audit events.
- RLS and database guards around course ownership/publication, lesson media fields, quiz-answer secrecy, and paid-access tables.
- R2 direct uploads use generated keys, short-lived signed URLs, approved content-type/size metadata, ownership checks, object HEAD verification, and server-managed upload intents.
- Private videos/resources are stored in a non-public bucket. A separate public bucket/domain is used for course covers. The playback endpoint re-checks current course/lesson publication and preview/entitlement/enrollment before issuing a temporary signed GET URL.
- Draft authoring is allowed for active users with the instructor role even while awaiting approval; submission for public review still checks platform approval and course readiness. This is a workflow distinction, not a publication permission.
- Privileged routes emit audit events without intentionally storing R2 URLs, provider secrets, or bearer tokens.

## Must be completed before public production launch

- Install dependencies, generate/commit a lockfile, and pass typecheck, lint, unit/integration/e2e tests, dependency scanning, and a production build.
- Apply all migrations against staging, exercise RLS as anonymous/student/instructor/delegated admin/Super Admin, and test backup restoration.
- Add shared rate limiting (Redis/Upstash or an edge WAF); current process-local rate limits are not shared across serverless instances.
- Add malware scanning, file-signature inspection, safe image re-encoding, quotas, upload-abuse alerting, and retention policies. Provider `Content-Type` is metadata and does not prove the file bytes are benign.
- Enforce MFA for Super Admin/admin accounts; add session revocation workflows and authentication recovery end-to-end tests.
- Test exact-origin CORS, CSP, CSRF, link expiration, browser seeking/range support, file limits, ownership, unpublished lessons, entitlement expiry/revocation, and suspended accounts.
- Add monitoring/alerts, storage spending alerts, audit log review, backup/restore procedures, and operational incident documentation.
- Before activating payments, implement provider webhook signature verification, replay protection, idempotent processing, refunds/cancellations, entitlement revocation rules, commission accounting, and payouts. None of this should be simulated as real payment in Phase 1.

## Important limitations

Signed R2 URLs are bearer capabilities until expiry. A newly revoked entitlement prevents new playback URLs but cannot invalidate a signed URL already issued; choose an appropriate TTL. Browser playback URLs, `controlsList="nodownload"`, and visible viewer IDs are not DRM and cannot guarantee prevention of screen recording or external cameras. Existing Stream-hosted files are not copied by migration 0009; legacy lessons must be re-uploaded to private R2 before review/playback. Payment processing is disabled.


Lesson-resource metadata writes are restricted to the server-side service role by migration `0011_server_managed_lesson_resources.sql`. Browser roles retain only SELECT permission, which is still filtered by entitlement and ownership RLS policies.
