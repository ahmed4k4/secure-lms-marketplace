# Release 1.7.2 — Lint and instructor profile photo

## Included
- JSX heading text fixed to avoid `react/jsx-no-comment-textnodes`.
- Removed unused admin overview import.
- Added validated HTTPS profile-photo URL to account settings using existing `profiles.avatar_url`; public instructor pages render the image or initials fallback.
- No database migration is required for the profile photo because `profiles.avatar_url` already exists and is exposed by the public instructor view.

## Important capability limits
- A website cannot reliably disable OS-level screenshots, screen recording, HDMI capture, or external cameras. The existing moving watermark and signed playback URLs are deterrents, not a guarantee or DRM.
- Multi-quality video playback is not enabled by this release. The current R2 upload path stores the uploaded source; true 360p/720p/1080p selection requires a transcoding/packaging pipeline (or a video streaming service) and player integration. Merely adding a quality dropdown would not create those variants.
- A wallet, atomic course-purchase ledger, instructor payout/commission accounting, and admin balance adjustments are not introduced by this lint-focused release. Those require a separately tested database transaction and ledger implementation; do not simulate balances in client state.

## Validation
`node scripts/verify-static.mjs` passed. Full ESLint, TypeScript typecheck, tests, and production build were not run because dependencies are not installed in this packaging environment. Use Node 22.22.2+ and run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
