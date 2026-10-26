# Finance, profile photo and lint update — 1.8.0

## Included
- Removed invalid JSX child placeholders that caused `react/jsx-no-comment-textnodes` in account security and category review forms. Removed an unused import from the admin dashboard.
- Added a profile avatar upload endpoint. It accepts JPEG/PNG/WebP up to 5 MiB, checks file signatures, stores the image in the configured public covers bucket under an avatar-specific key, and updates `profiles.avatar_url`. The existing HTTPS URL field remains for backwards compatibility.
- Added wallet and immutable ledger tables. Amounts are stored as integer minor units per currency.
- Added a service-role-only wallet credit RPC; the application action checks `users.manage` before invoking it.
- Added an authenticated wallet purchase RPC for published one-time course plans. It charges the learner, credits the course owner net of `commission_percent`, credits the platform commission wallet, and creates order/entitlement/enrollment records in one database transaction.
- Added learner wallet and admin wallet-management pages.

## Required deployment steps
1. Use Node.js 22.22.2 (the project `.nvmrc`).
2. Apply `supabase/migrations/0017_wallet_and_revenue.sql` to a staging database first, then production after backup.
3. Ensure `R2_COVERS_BUCKET` and `R2_COVERS_PUBLIC_URL` are configured to the dedicated public image bucket/domain. Do not point this bucket at private video storage.
4. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

## Important scope and safety limits
- Browsers cannot guarantee blocking OS-level screenshots, screen recording, HDMI capture, or external cameras. The current player watermark is a deterrent, not a DRM guarantee.
- This release does not transcode uploaded MP4s into multiple HLS renditions, so a functioning multi-quality selector is not claimed. That requires a transcoding worker/provider, rendition storage, manifest playback, and entitlement checks for each rendition. Large uploads are still bounded by the Super Admin-configured upload and storage limits; upload sizes must also fit the deployment's request/proxy constraints.
- Wallet purchase RPC currently supports active one-time course plans. Subscription billing, withdrawals/payouts to external banks, refunds/chargebacks, tax handling, and a full reconciliation workflow are not included. Treat wallet balances as internal credits until these workflows are implemented and legally reviewed.
- Student monitoring continues to rely on the existing course activity, progress, assessment submissions and playback-session telemetry; this release does not add webcam/proctoring or invasive device surveillance.
- A complete lint/typecheck/build could not be run in the current environment because npm dependency installation timed out and the available Node version is 22.16.0, below `.nvmrc`.
