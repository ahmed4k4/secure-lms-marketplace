> **Implementation override for release 1.1.0:** The baseline specification below names Cloudflare Stream for videos. The latest project instruction explicitly supersedes that choice: new video and lesson-resource delivery uses **private Cloudflare R2**, and covers use a separate public R2 bucket. Legacy Stream rows are retained for reference, but are not used for new uploads or playback.

# Project Specification — Secure Multi-Instructor LMS Marketplace

## 1. Project Overview

Build a professional, production-oriented Learning Management System (LMS) combined with a multi-instructor course marketplace.

The platform allows independent instructors to create, manage, publish, and monetize their own courses. Each instructor can select supported monetization models independently. A Super Admin owns and controls the entire platform.

The initial release must support real course management and protected video delivery. Payment collection is deliberately deferred to Phase 2, but the database and architecture must be payment-ready without requiring a major redesign.

The application must be secure, maintainable, responsive, accessible, internationalized, and scalable. Do not build a superficial demo or rely on hardcoded production data.

## 2. Technology Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui.
- Backend: Next.js Route Handlers running on Node.js for the initial release.
- Database: Supabase PostgreSQL.
- Authentication: Supabase Auth.
- Authorization: PostgreSQL Row Level Security (RLS) plus server-side permission checks.
- Video: Cloudflare Stream with private playback and signed tokens.
- General file storage: Cloudflare R2 or Supabase Storage, selected according to access requirements and cost.
- Hosting: Vercel for initial development and preview deployments.
- Source control: GitHub.
- Validation: Zod or an equivalent runtime validation library.
- Testing: Vitest, React Testing Library, and Playwright.
- Observability: Structured server logs, error monitoring, security audit logs, and usage alerts.

Do not introduce a separate NestJS or Laravel backend in the initial release unless a documented technical requirement justifies it. Keep business logic modular so it can be extracted into a dedicated Node.js/NestJS service later.

Pin compatible dependency versions, commit the lockfile, and document deployment requirements.

## 3. User Roles

### Super Admin
- Full platform administration.
- Create, activate, suspend, and manage instructor accounts.
- Manage additional administrators and granular permissions.
- Review, approve, reject, suspend, and archive courses.
- Manage users, categories, course policies, platform settings, and reports.
- Review audit logs and security events.
- Configure future platform commissions, monetization rules, and payment settings.
- Manage content moderation and support workflows.

### Instructor
- Maintain a public profile and instructor dashboard.
- Create and edit owned courses, sections, lessons, and resources.
- Upload videos securely through Cloudflare Stream.
- Save drafts, submit courses for review, and publish only when authorized.
- Manage enrolled students in owned courses only.
- View student progress, quiz results, reviews, and course analytics.
- Configure supported pricing models and access policies.
- Manage announcements, quizzes, assignments, and learning resources.
- Never access another instructor's private data unless explicitly authorized.

### Student
- Register, sign in, recover accounts, and manage profile settings.
- Browse, search, filter, and preview published courses.
- Access only free content or content for which valid access rights exist.
- Watch protected videos, save progress, and resume lessons.
- Take quizzes, submit assignments, ask questions, and review courses.
- View certificates and learning history.
- Manage future subscriptions and account sessions.

Use least-privilege authorization. Never trust a role, course ID, price, or access flag supplied by the browser without server-side verification.

## 4. Monetization Architecture

Support these product and pricing models:

1. Free courses.
2. One-time course purchases.
3. Time-limited or lifetime course access.
4. Monthly and yearly course subscriptions.
5. Instructor memberships that grant access to defined course collections.
6. Bundles containing multiple courses.
7. Future platform-wide memberships.
8. Free previews, coupons, promotional access, and administrative grants.

Model products, pricing plans, plan items, orders, order items, subscriptions, entitlements, and enrollment records separately.

An entitlement represents the effective permission to access content. It must include its source, status, applicable product/course, start time, expiration time when relevant, and revocation information.

Changing a course's future pricing model must not silently revoke previously purchased lifetime access. Membership cancellation must follow the configured paid-through-date policy. Refunds, chargebacks, expiration, and administrative revocation must be modeled explicitly.

Payment processing is NOT enabled in Phase 1. Do not simulate successful payments as real transactions or grant paid access because a user visits a success page. Implement a clearly labeled checkout placeholder and prepare interfaces for a future payment provider, signed webhooks, idempotency, refunds, and instructor payouts.

## 5. Core Database Entities

Create normalized, indexed, documented PostgreSQL tables with foreign keys and appropriate unique constraints:

- profiles
- roles
- permissions
- user_roles
- instructor_profiles
- courses
- course_instructors
- categories
- sections
- lessons
- lesson_resources
- products
- pricing_plans
- plan_items
- orders
- order_items
- subscriptions
- entitlements
- enrollments
- lesson_progress
- quizzes
- questions
- quiz_attempts
- assignments
- submissions
- reviews
- certificates
- notifications
- payment_events
- refunds
- instructor_earnings
- audit_logs

Use migrations committed to version control. Do not make manual production-only schema changes.

Define ownership rules and RLS policies for every sensitive table. Do not assume that hiding frontend components is authorization.

## 6. Video Security

Cloudflare Stream is the only video delivery service in the initial architecture.

Requirements:

- Keep all premium videos private and configure them to require signed playback tokens.
- Store video UIDs and processing states in PostgreSQL, never public video credentials.
- Keep Cloudflare API tokens and signing secrets exclusively in server-side secrets.
- Use short-lived signed upload permissions for authorized instructors.
- Validate instructor ownership, account status, upload limits, file duration, and course permissions before creating upload sessions.
- Upload directly from the browser to Cloudflare Stream using scoped, temporary upload URLs; do not proxy large video files through Next.js.
- Verify video-processing status using trusted API checks or verified webhooks.
- Never expose original storage credentials, signing keys, or privileged provider tokens to clients.
- Issue playback tokens only after verifying the student's current account status and effective entitlement.
- Apply allowed-origin restrictions as an additional control, not as a replacement for authorization.
- Avoid caching authenticated playback authorization responses publicly.
- Recheck authorization when issuing new playback sessions and when access is revoked.
- Log security-relevant playback grants without storing bearer tokens in logs.
- Implement configurable concurrent-session limits and suspicious-sharing detection.
- Provide dynamic, visible watermarks using a pseudonymous student identifier or account-specific reference.
- Do not expose direct download URLs for premium lessons.
- Keep course attachments in private storage with authorized, expiring download links.

IMPORTANT LIMITATION: Browser-based systems cannot guarantee that screen recording, external cameras, or all video copying methods will be prevented. Do not claim 100% anti-recording protection. Evaluate genuine DRM only if a compatible provider, player, device ecosystem, and licensing model are selected. Do not mistake hidden controls, disabled right-click, or signed URLs for DRM.

## 7. Application Security

Follow defense-in-depth and relevant OWASP guidance.

- Secure sessions and account recovery.
- MFA for Super Admin and privileged accounts.
- Server-side authorization on every sensitive route and server action.
- RLS policies that enforce ownership and role boundaries.
- Secure cookies where applicable: HttpOnly, Secure, and appropriate SameSite settings.
- CSRF protection where the authentication and request architecture requires it.
- Strict input validation, output encoding, and safe query construction.
- Rate limiting for authentication, uploads, quiz submissions, playback-token issuance, and other abuse-prone operations.
- Appropriate CSP and security headers.
- Secure CORS configuration; do not allow arbitrary origins with credentials.
- Secrets stored in deployment environment variables or a proper secret manager.
- No service-role keys, signing secrets, payment secrets, or privileged tokens in browser bundles.
- Safe file upload validation, size limits, and content-type checks.
- Verify provider webhook signatures and prevent replay or duplicate processing.
- Never trust client-reported prices, payment status, instructor identity, or course ownership.
- Protect against IDOR/BOLA, privilege escalation, SQL injection, XSS, CSRF, session theft, and mass assignment.
- Audit important administrative changes, account suspensions, role modifications, and access grants.
- Use dependency scanning, lockfile checks, code review, backups, and restore testing.
- Add privacy-conscious monitoring, error reporting, and spending alerts.

Test unauthorized requests directly against API routes, not only through the UI.

## 8. Frontend Requirements

Create a polished, modern, responsive application with Arabic and English localization, RTL/LTR support, accessible components, consistent typography, loading states, empty states, error handling, and mobile-friendly navigation.

Required areas:
- Public home page.
- Course catalog, search, filters, categories, and course details.
- Instructor public profiles.
- Authentication and account recovery.
- Super Admin dashboard.
- Instructor dashboard and course editor.
- Student dashboard and learning player.
- Course curriculum, quizzes, assignments, certificates, and reviews.
- Notifications, profile settings, and account security.
- Pricing and future checkout placeholders.

Avoid a generic template appearance. Use consistent design tokens, reusable components, and restrained animations. Prioritize performance, keyboard accessibility, reduced-motion preferences, and Core Web Vitals.

Never render privileged secrets or assume that a protected page is safe solely because its route is hidden.

## 9. Backend and API Requirements

Use modular services for authentication/authorization, courses, instructor management, media, entitlements, progress, assessments, reporting, and future payments.

Define typed request/response schemas, consistent error responses, pagination, filtering, safe database access, and transaction boundaries.

Use the authenticated user's server-verified identity. Enforce ownership checks on every instructor operation and entitlement checks on every protected lesson request.

Avoid unnecessary N+1 database queries. Add indexes based on real query patterns. Use background jobs only when required and choose an infrastructure-compatible approach.

## 10. Implementation Phases

Phase 1: Repository setup, UI system, localization, and environment configuration.

Phase 2: Database migrations, authentication, roles, RLS, and secure Super Admin bootstrap.

Phase 3: Instructor management, course authoring, review, and publishing workflow.

Phase 4: Cloudflare Stream upload, processing, private playback, and authorization.

Phase 5: Student enrollment, entitlement logic, lesson progress, and course player.

Phase 6: Quizzes, assignments, certificates, notifications, and analytics.

Phase 7: Pricing-plan configuration and checkout placeholders without real charges.

Phase 8: Security testing, performance testing, accessibility, backups, and staging deployment.

Phase 9: Payment provider integration, recurring billing, refunds, commission accounting, and instructor payouts after explicit business and compliance decisions.

## 11. Acceptance Criteria

The project is not complete until:

- A Super Admin can securely create and manage instructors.
- Instructors cannot read or modify each other's private records.
- Students cannot access unpublished or unauthorized premium lessons.
- Changing course IDs or calling API routes directly does not bypass authorization.
- Expired, revoked, or canceled access follows the configured entitlement policy.
- Private videos cannot be played using a public UID alone.
- Playback tokens and provider secrets never appear in client-side source or logs.
- Duplicate webhook events can be handled safely in the payment phase.
- Arabic RTL and English LTR layouts work on mobile and desktop.
- Critical authorization, authentication, media, and course workflows have automated tests.
- Migrations, environment variables, deployment, backup, recovery, and security procedures are documented.
- The application builds successfully and passes type checks, linting, and relevant automated tests.

Build incrementally. Inspect the repository before modifying it, reuse correct existing work, document assumptions, and report completed features, limitations, test results, and unresolved risks honestly. Do not claim a feature is secure or production-ready without verifying it.