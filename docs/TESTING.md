# Testing

```bash
npm run check          # static verification + tsc + eslint + vitest (unit, component, DB/RLS)
npm run build && npm run start &    # then:
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

For e2e the server needs the env variables set (placeholder values are fine for the included tests).

## Automated suites

| Suite | Files | What it proves |
|---|---|---|
| **Database / RLS** (PGlite = Postgres-compatible engine; applies all migration files) | `tests/db/rls.test.ts` | Signup trigger; students can't escalate roles/status; BOLA: instructor B can't read/modify instructor A's courses, videos, quiz keys; publish workflow with role/permission enforcement and no MFA dependency; entitlement logic (free enrol, paid not self-enrollable, expired/revoked/future denied, lifetime survives price change, suspended users/courses, archived keeps access); progress writes need access; `object_key` and answer keys not selectable; server-side grading; submissions locking/grading; certificates; audit immutability; payment tables closed; webhook idempotency constraint; rate-limit function; internals invisible. |
| **Query guard** | `tests/db/queries.test.ts` (2) | Every `.from().select/insert/update` in `src/` references existing columns (the Supabase client is untyped) |
| **Unit** | `tests/unit/*` | CSRF origin rules; watermark/IP hashing; video magic-byte sniffing, filename/key safety, type allow-lists; CSP builder; zod schemas (mass assignment, bounds); i18n parity (keys + placeholders); `safeNext`/slug; **R2 presign** (TTL, signed headers, no secret leakage, sanitised filename); route-handler wrapper (CSRF, uniform errors, no leakage). |
| **Component** | `tests/unit/quiz-taker.test.tsx` | Quiz UI gating, request payload, server-graded result display, Arabic rendering. |
| **HTTP security (Playwright request API)** | `tests/e2e/security.spec.ts` (23) | Direct API calls without a session are 401; malformed ids 404; cross-origin/origin-less mutations 403; cron needs a secret; webhook 501; protected pages redirect anonymous users (307); nonce CSP + hardening headers present; scripts carry the nonce; no secrets in HTML; public pages survive an unreachable database; Arabic cookie ⇒ `lang="ar" dir="rtl"`. |

The current packaging environment did not complete a clean npm install because dependency download timed out. Consequently, test counts, typecheck, lint, Playwright, and production-build results are not asserted for this package. Run the commands above in a networked Node 22.22.2+ environment, and then repeat the real Supabase/R2 staging checklist below. The automated suites are source-controlled but have not been executed successfully during this packaging pass.

## Not covered by automation — run on staging before launch

Requires real Supabase + R2 credentials and a browser. Use two instructors (A, B), two students (S1, S2), one admin.

**Auth & admin**
- [ ] Register S1 → confirmation e-mail → sign in. Wrong password and unknown e-mail show the same message.
- [ ] Forgot-password link works once; "sign out other devices" kills a second browser.
- [ ] Admin/instructor invitation is delivered and links to `/auth/callback?next=/reset-password`; verify the user can set a password, sign in, and reach only their assigned role areas.
- [ ] Admin creates instructor A and B; suspending B blocks B immediately (existing session too).

**Authoring & publishing**
- [ ] A creates a course, sections, a video lesson, a text lesson; uploads an MP4 (≈50 MB) with the progress bar; replacing the video works; uploading a renamed `.exe`/HTML as `.mp4` is refused (`NOT_A_VIDEO`).
- [ ] A submits for review; admin rejects with a reason (A sees it + notification); resubmit; approve → visible in catalog.
- [ ] B cannot open `/instructor/courses/<A's id>` (404) and `POST /api/uploads` for A's lesson id returns 403.

**Learning & access**
- [ ] S1 enrols (free), watches, leaves and returns (resumes position); lesson completion updates the dashboard.
- [ ] S2 (not enrolled): only previews open; `POST /api/lessons/<locked id>/playback` → 403; a copied signed URL stops working after its TTL.
- [ ] Open the same account on 3 browsers: the third playback is refused (`TOO_MANY_STREAMS`) with the configured limit of 2.
- [ ] Admin revokes S1's access mid-playback: within ≤ 20 s the player stops (heartbeat 403); a new playback request is refused.
- [ ] Watermark `ID-…` visible and moving, also in the custom fullscreen mode. (iOS Safari uses native fullscreen, which drops the overlay.)
- [ ] Quiz and assignment flows; instructor grading triggers a notification; certificate is issued only at 100 % and verifies at `/certificates/<code>`.
- [ ] Attachment download works for S1, 401/404 for S2, and the link expires within a minute.

**i18n / accessibility**
- [ ] Switch to Arabic: layout mirrors on mobile and desktop; forms, tables, player controls and dialogs remain usable.
- [ ] Keyboard-only pass through login, catalog, course page, player and instructor editor; `prefers-reduced-motion` honoured; run Lighthouse / axe on the main pages.

**Operations**
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/maintenance` returns counts.
- [ ] Restore a `pg_dump` into a scratch project (see OPERATIONS).


## Current hardening checks

- `npm run verify:static`: checks ordered migrations, translation key parity, one-role invariant, removal of application MFA/TOTP flows, and same-origin/R2 cover upload wiring. This is a fast structural check only.
- `tests/unit/media-rules.test.ts`: additionally verifies JPEG/PNG/WebP magic bytes and rejects SVG/HTML cover payloads.
- `tests/db/rls.test.ts`: additionally verifies the unique single-role constraint and that a course held for a proposed category cannot bypass the approval gate, while allowing the instructor to select an existing category instead.


## Performance-focused checks

- Verify catalog pages do not prefetch each course detail automatically.
- Verify covers are served via the configured public R2 host through the Next.js image optimizer.
- Open a lesson and confirm the initial render does not request Q&A until the Q&A tab is opened; the Q&A endpoint must return 401 without a session and 403 without current course access.
- Compare database query timings before/after migration `0014_performance_indexes.sql` using Supabase Query Performance.
