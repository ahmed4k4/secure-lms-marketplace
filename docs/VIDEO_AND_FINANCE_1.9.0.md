# Archai Academy 1.9.0 — Adaptive video and finance operations

## What changed

- Large video uploads use multipart S3-compatible uploads into the private R2 media bucket. Upload failures can abort the multipart session. Keep the original object private.
- Each verified video is queued for a separate FFmpeg worker. The worker generates HLS VOD renditions up to the Super Admin's configured quality cap (360p/480p/720p/1080p), publishes a private master manifest, and records processing errors/retries. The player offers auto and manual quality choices in browsers using hls.js; Safari's native HLS fallback normally exposes only automatic quality selection.
- Same-origin HLS manifests are reauthorized, and each segment is redirected to a short-lived signed R2 URL. A moving account watermark, playback-session controls, browser shortcut events and audit telemetry are deterrents and investigative signals, not DRM.
- The Super Admin controls global watermark enforcement, browser capture deterrence, maximum HLS quality, concurrent playback limits, sharing-blocking and upload limits in Admin → Settings.
- Wallet-funded monthly/yearly subscriptions charge the wallet at purchase and on renewal. Insufficient renewal balance changes the subscription to `past_due` and expires access until a later successful renewal; users can cancel renewal at period end.
- Instructor payouts reserve wallet funds in a clearing wallet, require settled earning allocations in the same currency, and require a transfer reference before an operator records an external payment. Declining a request releases the reserved balance.
- Wallet refunds reverse the learner, instructor and platform ledger entries and revoke access atomically. Requests whose earning has already been allocated to a payout are blocked from automatic reversal to avoid paying out the same money twice. External-provider refunds can be documented with the provider's refund reference only after the refund was actually executed at the external provider.
- Daily maintenance calls the subscription renewal and seven-day earning-settlement procedures, and stores a reconciliation snapshot.

## Apply database changes

Apply every migration in order on staging first, then production:

```sh
supabase db push
```

For a SQL Editor workflow, apply any migrations not yet installed, in the lexicographical order `0018`, `0019`, `0020`. Do not rerun an already-applied migration manually. Review the reconciliation and ledger totals on staging before using wallet balances with real money.

## Deploy the transcoder worker

R2 is object storage, not a video transcoding service. A persistent worker with FFmpeg is required for real multi-quality playback. Build the image from the repository root:

```sh
docker build -f workers/transcoder/Dockerfile -t archai-lms-transcoder .
docker run --restart unless-stopped \
  -e NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  -e SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  -e R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
  -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  -e R2_BUCKET="$R2_BUCKET" \
  -e TRANSCODER_MAX_JOBS=1 \
  archai-lms-transcoder
```

Give the worker persistent uptime, CPU, RAM, and scratch disk larger than the uploaded source plus temporary renditions. Start with one job at a time; increase `TRANSCODER_MAX_JOBS` only after measuring memory and disk use. The worker polls the database queue, updates a heartbeat during processing, and permits up to three attempts per job. Monitor worker logs and `video_transcode_jobs`.

## R2 configuration

- `R2_BUCKET` must be the **private** source-and-HLS media bucket. Do not expose object listing or make this bucket public.
- `R2_COVERS_BUCKET` must remain a separate public-image bucket; never point it at `R2_BUCKET`.
- For the private bucket, allow CORS from the exact deployed app origin for `GET`, `HEAD`, and `PUT`; expose `ETag` so multipart upload can read part tags. Add local development origin only if needed.
- Configure an R2 lifecycle rule to abort incomplete multipart uploads after one day as a fallback for browser/network failures.
- HLS segment URLs expire quickly and only get issued after app/session checks. Do not remove those access checks or place the private bucket behind an unauthenticated public domain.

## Finance operations

- Super Admin can set the platform commission percentage and credit user wallets. A wallet purchase debits the learner, credits the instructor's wallet net of commission, credits the platform revenue wallet, and records the immutable wallet ledger. The Super Admin can review this in Admin → Wallets and Admin → Finance.
- Subscription renewals run through the daily `/api/cron/maintenance` job. Verify the deployment has `CRON_SECRET` configured and that the daily Vercel Cron runs successfully. The server returns `financeErrors` if renewal/settlement RPCs fail; inspect server logs and fix the underlying database issue before assuming a renewal succeeded.
- Finance → Settlement makes pending earnings available only after the seven-day hold and snapshots ledger totals. Run it on staging first and reconcile its summary against the wallet ledger and orders.
- Instructors submit payout requests from Instructor → Earnings & payouts. Approval moves the amount to the clearing wallet; the operator must actually transfer money through their selected bank/provider outside this application and then enter the real transfer reference. The app does not initiate a bank transfer.
- A Super Admin reviewing an external-provider refund must first execute it using the provider's actual dashboard or API, then record the provider refund reference in Admin → Finance. This reference workflow is not a payment-provider integration. Payment webhooks, automatic external refunds, chargebacks, tax reporting and payout API execution are separate integrations and must be added before those providers are relied on for production financial automation.

## Security limits and go-live checklist

- OS-level screenshots, system recording, privileged capture tools and external cameras cannot be reliably blocked by browser code. The app detects only some browser-visible shortcut/focus signals and displays a moving account watermark; these are traceability deterrents, not a guarantee.
- HLS is segmentation, not DRM. An authorized user may still download segments or record output. For premium anti-rip protection, integrate a commercial DRM system such as Widevine/FairPlay/PlayReady with its license/key management.
- Run the test suite and build with the repository's required Node version from `.nvmrc` (`22.22.2`): `npm ci`, `npm run verify:static`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Then run the full migration suite and real upload/playback/purchase/refund/payout flows in staging.
- Do not operate real-money financial workflows until migrations are deployed, wallet/ledger balances are reconciled, external payment provider rules and local regulatory requirements are reviewed, and payout/refund paths are tested with a test currency or sandbox.
