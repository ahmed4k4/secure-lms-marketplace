# API surface

Cookie-authenticated mutations require a same-origin request, a server-verified session where applicable, active-account checks, role/ownership checks, runtime schema validation, rate limits, and audit events for security-relevant writes. Signed upload/playback/download URL responses use `Cache-Control: no-store`. The service-role client bypasses RLS, so trusted server routes must enforce identity and ownership explicitly.

| Method | Route | Purpose | Access |
|---|---|---|---|
| GET | `/api/health` | Database/catalog health check | Public, minimal response |
| POST | `/api/auth/sign-out` | End current session | Authenticated session |
| POST | `/api/courses` | Create a draft course | Active instructor or Super Admin; approval is not needed for drafts |
| POST | `/api/courses/:courseId/sections` | Create a section | Active course owner or Super Admin |
| POST | `/api/sections/:sectionId/lessons` | Create an unpublished text/video lesson | Active course owner or Super Admin; a video must reference the uploader's pending R2 upload intent |
| POST | `/api/r2/upload-url` | Prepare temporary direct R2 upload (`video`, `resource`, or `cover`) | Active instructor/admin; course ownership for lesson media; cover uses the separate public bucket |
| POST | `/api/r2/complete-upload` | Validate actual R2 object size/MIME metadata and finalize upload state | Upload owner; private media remains private |
| POST | `/api/r2/download-url` | Issue temporary private attachment URL | Course owner or learner authorized for lesson |
| POST | `/api/r2/playback-url` | Issue short-lived private video URL after authorization | Active entitled learner, eligible preview viewer, course owner or authorized administrator according to access helper |
| POST | `/api/r2/delete-resource` | Delete private attachment and metadata | Authorized course owner/administrator |
| POST | `/api/courses/:courseId/pricing` | Configure draft course pricing/access metadata | Course owner, Super Admin, or delegated admin with `courses.manage_pricing` |
| GET | `/api/courses/:courseId/pricing` | Load pricing plans | Authorized caller; no-store for private responses |
| DELETE | `/api/courses/:courseId/pricing` | Deactivate a plan | Same authorization as pricing mutation |
| POST | `/api/courses/:courseId/submit-review` | Validate lesson readiness/pricing and submit for moderation | Approved instructor owning the course or Super Admin |
| POST | `/api/lessons/progress` | Save authorized student's progress | Active authenticated user with lesson access |
| GET/PUT | `/api/instructor/profile` | Read/update instructor profile | Instructor or Super Admin; approval state cannot be set by the profile route |
| POST | `/api/enrollments/free` | Atomic enrollment in a published course with an active zero-price lifetime plan | Active authenticated user |
| POST | `/api/stream/*` | Legacy endpoints only | HTTP 410; Stream is no longer used |

## R2 upload and playback protocol

1. Browser requests a short-lived signed PUT URL from `/api/r2/upload-url`. The server validates the authenticated role/account, file type/size, course and section ownership, and upload purpose; it creates a generated object key and trusted upload-intent row.
2. Browser uploads bytes directly to R2; Next.js does not proxy large files.
3. Browser calls `/api/r2/complete-upload`. The server HEAD-checks the object and verifies actual size and content type match the approved intent before finalization. Course covers are stored in the dedicated public covers bucket; videos and lesson resources remain in the private bucket.
4. Video lesson creation verifies the upload intent belongs to the current instructor, remains unclaimed, is for the same section, and has not expired. The backend links it to the lesson exactly once.
5. Playback checks lesson/course publication and preview/enrollment/entitlement on every request before signing a short-lived private GET URL. The response is no-store; the signed URL is still a bearer credential until expiry.

Lesson-resource rows can be read only through RLS-filtered authenticated access; browser roles cannot create, update, or delete attachment metadata because migration 0011 reserves those writes for the service role. Provider MIME metadata and size checks do not replace malware scanning or full media decoding. Signed URLs are not DRM and do not prevent screen capture. The project does not have a production-grade cross-instance rate limiter yet.

## Payments

Pricing can be configured/displayed and free enrollment is supported. No payment provider is active in Phase 1. A price display or success redirect never grants paid access. Phase 2 must verify webhook signatures, deduplicate provider event IDs, use idempotent order handling, model refunds/cancellations, and grant/revoke entitlements only through trusted server workflows.
