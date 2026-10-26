# Verification and release checklist

## Static and code checks

Run from the project root after installing dependencies:

```bash
npm run verify:static
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

`verify:static` checks source syntax/structure, migration presence, RLS and helper markers, private R2 upload/playback wiring, cover upload/signature checks, entitlement revocation rules, approval boundaries, pricing guardrails, and bootstrap safety. It is not a substitute for typecheck/tests/build or running SQL against a real database.

## Database

- Back up a development database and apply migrations `0001` through `0015` in numeric order. If `0001`–`0008` are already applied, apply whichever of `0009`–`0012` are missing, then `0013` and `0014` if missing, and always apply `0015_single_role_signup_trigger_fix.sql` once if it is not recorded. If `0009` and `0010` are already applied, apply `0011` and `0012` only if missing; never reapply an already-recorded migration.
- Confirm ordinary users cannot write their own roles, privileged profile status, lesson media fields, lesson-resource metadata, orders, subscriptions, entitlements, payment events, refunds, or instructor earnings. Migration `0011` must remove browser `INSERT`/`UPDATE`/`DELETE` privileges on `lesson_resources` while reads remain subject to RLS.
- Confirm course creation is available to active instructor-role users with unapproved profiles but creates only a draft; review submission and publishing remain restricted.
- Confirm `questions.correct_answer` is never granted to browser roles and RLS still restricts ownership.
- Test anonymous, student, instructor pending approval, instructor approved, delegated admin, and Super Admin identities.

## Authentication and admin

- Test student registration, email confirmation, callback redirects, invalid credentials, unconfirmed account, invited first-password setup, forgot password, expired recovery link, password reset, and sign-out.
- Test active/suspended/pending/missing-profile states.
- Test instructor provisioning/approval/rejection and delegated admin permissions; direct API calls must not bypass role checks.
- Test course review approval/rejection and audit events.

## Course, cover, video and pricing

- As an unapproved instructor with role `instructor`, create a draft and verify `POST /api/courses` returns success rather than `403 Instructor approval required before creating courses`.
- Upload a cover JPG/PNG/WebP to the dedicated public covers bucket; verify preview, persistence of `thumbnail_url`, domain URL correctness, and size/type rejection. Test keyboard selection and mobile layout.
- Add sections, a text lesson, and an MP4/WebM/MOV video lesson. Confirm video upload is direct to the private R2 bucket and lesson links to the upload intent once only.
- Verify no private bucket public access. Call `/api/r2/playback-url` directly as anonymous, unrelated student, owner, entitled student, and suspended user. Ensure unpublished/unauthorized lessons return denial and no signed URL.
- Verify a published preview lesson can be watched according to policy; a paid lesson cannot be played without valid access. Test seeking and refresh near signed URL expiry in supported browsers.
- Verify review submission remains blocked before instructor approval and checks ready R2 video plus at least one active pricing plan. Super Admin approval should publish both validated course and lessons.
- Configure free, one-time, limited-day, monthly and yearly plan metadata; verify display does not cause a charge or grant paid access. Free enrollment only succeeds for an active zero-price lifetime plan.
- Existing lessons with only `stream_uid` must be clearly reported as requiring re-upload; do not consider them R2-ready.

## R2/provider setup

- Configure exact application origins in CORS. Test presigned PUT, completion HEAD checks, private GET, range requests/seeking, and signed URL expiry on staging.
- Verify private bucket has no public domain/access; verify public cover domain points only to the dedicated covers bucket and uses HTTPS.
- Verify secrets never appear in browser bundles, network responses except object-specific signed URLs, audit logs, or source control.

## Verification status

The source was updated in this archive, but it has not been connected to or tested against your live Supabase project or Cloudflare account. This archive-building environment does not prove that the SQL migrations, CORS, credentials, bucket domains, email delivery, or real-provider workflows work in your deployment. Run all commands above on a network-enabled machine after `npm install` and fix any reported failures before deployment. Do not describe the project as production-ready until those checks pass.


## Design-system review

The update includes `docs/DESIGN_SYSTEM.md` and a structural design-token check inside `npm run verify:static`. Inspect the Arabic and English versions at desktop, tablet, and mobile widths. Check focus state and `prefers-reduced-motion` behavior. The design is based on flat Carbon/Panel/Steel surfaces, Arc Blue as the primary action signal, Copper as a limited secondary accent, and the supplied font hierarchy.

## Required build validation

The authoring environment could not reach the npm registry reliably, so this archive does not include a generated `package-lock.json` and no claim is made that TypeScript, ESLint, Vitest, Playwright, or `next build` passed for this exact archive. On a connected machine, run `npm install` and commit the generated package lock, then run the complete validation command sequence before deployment. Do not treat the static syntax check as a substitute for these steps.
