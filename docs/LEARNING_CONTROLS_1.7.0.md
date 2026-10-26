# Optional Learning Controls — v1.7.0

## Apply migration
Run `supabase/migrations/0016_optional_learning_controls.sql` in the intended Supabase project after the earlier migrations. Back up production first and test on staging.

## Implemented in this release
- Optional lesson open/close timestamps; checked by the lesson page and server-side playback-grant API. Blank dates preserve the previous always-available behavior.
- Per-lesson moving student ID watermark toggle and seek restriction.
- Instructor form fields to configure quiz duration, per-question timer value, attempts, shuffling, availability, assignment due date/duration/availability/late submissions.
- Preserves course review workflow fixes from v1.6.2.

## Important security boundaries
- A website cannot reliably prevent a user from recording the screen with OS-level or external capture hardware. Watermarks, signed private URLs, short TTLs, access checks, and concurrent-session controls are deterrents and tracing controls, not DRM.
- The timer settings are persisted as configuration in this release, but authoritative server-side attempt sessions/expiry enforcement and essay-response grading must be completed before advertising them as secure timed exams. Do not rely on a client countdown for assessment integrity.
- This release does not transcode MP4 files into adaptive multi-quality HLS/DASH. Quality selection requires an encoding pipeline and a compatible player; browser native controls alone cannot invent additional renditions.
- The video seek restriction is client-side deterrence and can be bypassed by a technically capable user; it is not a security boundary.

## Validation
`npm run verify:static` passes. A full install, typecheck, lint, SQL integration run, and production build were not completed in this environment; run them before deployment.
