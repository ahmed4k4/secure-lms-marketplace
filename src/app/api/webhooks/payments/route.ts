import { ApiError, handle } from '@/lib/api';

/**
 * PHASE 2 placeholder. Payments are disabled in this release, so this endpoint refuses everything.
 * When a provider is chosen, implement here (see docs/ARCHITECTURE.md "Payments, phase 2"):
 *   1. read the RAW body, verify the provider signature and timestamp tolerance (reject replays);
 *   2. insert into payment_events (provider, event_id) — the unique constraint makes duplicates a no-op;
 *   3. in one transaction update orders/subscriptions and create/revoke entitlements;
 *   4. return 2xx quickly. Never grant access from a browser redirect.
 */
export const POST = handle(
  async () => {
    throw new ApiError(501, 'PAYMENTS_DISABLED', 'Payments are not enabled in this release.');
  },
  { csrf: false },
);
