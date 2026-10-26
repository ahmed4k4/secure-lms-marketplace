/**
 * Phase 2 contract. Phase 1 deliberately ships NO implementation: no payment is ever simulated
 * and no paid entitlement is ever granted from a client-visible "success" page.
 * Entitlements must only be created by a verified webhook handler (see docs/ARCHITECTURE.md).
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: { orderId: string; userId: string; planId: string; idempotencyKey: string }): Promise<{ url: string }>;
  /** Must verify the signature against the RAW body and reject replays. Returns a normalized event. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<{ eventId: string; type: string; payload: unknown }>;
  refund(input: { providerOrderId: string; amountCents: number; idempotencyKey: string }): Promise<{ providerRefundId: string }>;
}

export const PAYMENTS_ENABLED = false;
