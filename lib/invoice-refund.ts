/**
 * Invoice-scoped refund evidence.
 *
 * The bug this replaces scanned up to 100 charges across a customer's ENTIRE
 * history and treated any refunded charge, including a partial one on an older
 * subscription, as proof the current term was void. One live Rooted+ subscriber
 * carries a $5.85 partial refund from an earlier term and would have lost their
 * remaining paid access the moment they cancelled.
 *
 * Only the payment for the relevant invoice may affect classification, and only
 * a FULL refund of it counts.
 *
 * The distinction that matters most here is `none` versus `unknown`:
 *
 *   none    - the lookup SUCCEEDED and found nothing refunded. This includes
 *             the ordinary case of an open invoice that never had a successful
 *             payment: there is simply nothing to refund.
 *   unknown - the lookup itself failed. Per the safety invariant this must
 *             never be softened into "not refunded", because absence of
 *             evidence is not evidence.
 *
 * Deliberately pure: no Stripe SDK and no network, so the decision is testable
 * under `node --test`. Callers do the fetching and hand the amounts in.
 */

import type { RefundState } from "./paid-through.ts";

export type { RefundState };

export interface RefundEvidence {
  /**
   * Did the invoice_payments lookup and every follow-on read succeed? False
   * for a thrown request, a missing payment intent, or a charge we could not
   * retrieve.
   */
  lookupSucceeded: boolean;
  /**
   * The charge behind the invoice's PAID payment, or null when the lookup
   * succeeded and there is no paid payment at all.
   */
  charge: { amount: number | null; amountRefunded: number | null } | null;
}

/**
 * Turn charge amounts into refund evidence.
 *
 * A zero-amount charge, which a full-value coupon produces, has nothing to
 * refund and reports `none` rather than dividing by a zero total.
 */
export function classifyRefund(evidence: RefundEvidence): RefundState {
  if (!evidence.lookupSucceeded) return "unknown";

  // Lookup worked and there is no successful payment: nothing was refunded.
  const charge = evidence.charge;
  if (charge === null) return "none";

  const amount = charge.amount;
  const refunded = charge.amountRefunded;

  if (typeof amount !== "number" || !Number.isFinite(amount)) return "unknown";
  if (typeof refunded !== "number" || !Number.isFinite(refunded)) return "unknown";

  if (refunded <= 0) return "none";
  if (amount <= 0) return "none"; // nothing was charged, so nothing can be void
  if (refunded >= amount) return "full";
  return "partial";
}
