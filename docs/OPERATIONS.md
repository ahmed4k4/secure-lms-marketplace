# Operations

## Environment variables

| Name | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Safe in the browser (RLS protects data). |
| `NEXT_PUBLIC_SITE_URL` | public | Canonical origin; used for auth e-mail links and CSRF origin check. |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | Bypasses RLS. Server only. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | **secret** | Token scoped to one bucket. |
| `PLAYBACK_HMAC_SECRET` | **secret** | ≥ 32 chars. Watermark IDs and IP hashing. |
| `CRON_SECRET` | **secret** | Authenticates `/api/cron/maintenance`. |

The app validates server variables lazily with zod (clear error on first use rather than at build).

## Deployment (Vercel)

1. Push to GitHub; import the repo in Vercel (framework: Next.js; Node 22).
2. Add env vars to *Production* and *Preview*. Use a separate Supabase project and R2 bucket for staging.
3. Add the preview/production origins to Supabase redirect URLs and R2 CORS.
4. `vercel.json` schedules the daily maintenance cron (free tier allows daily). It: marks lapsed entitlements `expired`, deletes abandoned/failed uploads from R2 and DB, prunes `playback_sessions` > 2 d, `rate_limits` > 1 d and `playback.grant` audit rows > 90 d.
5. Vercel function limits: uploads/downloads bypass functions (direct to R2), so request duration is not a constraint for video.

## Migrations

- Files in `supabase/migrations` are the **only** way schema changes. Never edit production schema by hand.
- Add a new numbered file for each change; apply to staging first (`supabase db push` or SQL editor), run `npm test` (the DB suite applies every migration to a fresh engine), then production.
- Do not edit applied migrations.

## Backups and restore

- Supabase **Free** has no managed point-in-time backups; **Pro** adds daily backups (PITR is an add-on). Until you upgrade, take your own: 
  ```bash
  pg_dump "$SUPABASE_DB_URL" --no-owner --format=custom -f lms-$(date +%F).dump
  ```
  (connection string: Supabase → Settings → Database). Schedule it (GitHub Actions cron / cron host) and store dumps encrypted off-platform.
- **Restore test (do this before launch and quarterly):** create an empty Supabase project, `pg_restore --no-owner -d "$TARGET_DB_URL" lms-YYYY-MM-DD.dump`, point a staging deployment at it, sign in and open a course. Record the time it took.
- R2 objects are not versioned by default: enable bucket versioning/lifecycle if accidental deletion matters, and keep the database ↔ object key mapping in the dump (`lesson_videos`, `lesson_resources`).

## Monitoring and alerts

- Errors: server handlers log structured one-line messages (`[api] …`, `[audit] …`) to Vercel Logs without tokens. Add Sentry (or Vercel Observability) for error monitoring — free tiers suffice; scrub URLs containing `X-Amz-` query strings.
- Security: review **Admin → Audit log** weekly (filter `security.`); the admin overview shows the 7-day count of sharing alerts.
- Costs: set Cloudflare R2 usage notifications, Supabase usage emails (DB size, egress, MAU), Vercel spend management.
- Storage governance: per-instructor quota and per-file limits in **Admin → Settings**.

## Routine tasks

| Task | How |
|---|---|
| Create instructor | Admin → Instructors |
| Suspend user / instructor | Admin → Users / Instructors (bans auth, effective immediately) |
| Grant/revoke access | Admin → Access (audited; revoke also ends live playback sessions) |
| Review courses | Admin → Courses (approve / reject with reason / suspend / archive / restore) |
| Tighten video protection | Admin → Settings: shorter signed-link lifetime, fewer streams, enable sharing block |
| Rotate secrets | R2: create new token → update env → redeploy → delete old. Supabase service key: rotate in dashboard → update env. `CRON_SECRET`: update env + redeploy. |
| Identify leaked footage | `npm run watermark:resolve -- ID-XXXXXXXXXX` |

## Incident basics

1. Contain: suspend affected accounts; set `signed_url_ttl_seconds` to 60 and `sharing_block` on if abuse is ongoing.
2. Rotate any exposed secret (above) and redeploy.
3. Review audit logs; export with SQL (`select * from audit_logs where created_at > …`).
4. Notify affected users as legally required.
