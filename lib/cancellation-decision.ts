/**
 * What customer.subscription.deleted should write, if anything.
 *
 * Extracted so the entitlement decision is testable: the webhook route itself
 * is not in the `node --test` glob, and this is the single most dangerous
 * decision in the billing code, because it is the only path that can take
 * Rooted+ away from a family.
 *
 * The safety invariant it enforces: Rooted may revoke Rooted+ only when it has
 * positive evidence that the relevant paid entitlement has ended. `pending` and
 * `unknown` therefore write NOTHING AT ALL, not a partial patch and not a
 * cancelled marker, which leaves the row eligible for the nightly
 * reconciliation to retry and keeps the situation visible rather than silently
 * frozen.
 *
 * Why writing nothing beats writing a cancelled marker with no date: rule 1
 * needs a date before it can downgrade, and rule 3 excludes rows already
 * marked cancelled. A half-written row would therefore keep Rooted+ forever
 * with no healing path and no signal.
 *
 * Deliberately pure: no Stripe SDK, no Supabase, no network.
 */

import type { PaidThrough } from "./paid-through.ts";

/** Exactly the profile fields this decision may write. */
export interface CancellationPatch {
  is_pro: boolean;
  subscription_status: "cancelled";
  subscription_end_date: string;
  cancel_at: null;
  /** Only present when access is being revoked. */
  plan_type?: null;
}

export type CancellationDecision =
  | { action: "skip"; reason: string }
  | { action: "write"; patch: CancellationPatch; termRemaining: boolean };

/**
 * current_period_end is never written by this decision. It is Stripe's
 * bookkeeping about the next cycle, not a statement about entitlement, and
 * writing it here is what started the whole problem.
 */
export function decideCancellation(input: {
  classification: PaidThrough;
  now: Date;
}): CancellationDecision {
  const { classification, now } = input;

  if (classification.kind === "pending") {
    return {
      action: "skip",
      reason: `Stripe is still collecting, next attempt ${classification.retryAt.toISOString()}`,
    };
  }
  if (classification.kind === "unknown") {
    return { action: "skip", reason: classification.reason };
  }

  // Positive evidence either way from here on.
  const termRemaining = classification.kind === "paid" && classification.through > now;

  const patch: CancellationPatch = {
    is_pro: termRemaining,
    subscription_status: "cancelled",
    // The end of the term that was actually purchased, never the moment this
    // webhook happened to arrive. That is what makes the webhook and the
    // nightly reconciliation write identical values.
    subscription_end_date: classification.through.toISOString(),
    // The schedule, if any, has been resolved; subscription_end_date now
    // carries the truth and a leftover cancel_at would be a stale second
    // opinion.
    cancel_at: null,
  };
  // plan_type drives which tier's features render, so it stays set while
  // access is still live and is cleared only when access ends.
  if (!termRemaining) patch.plan_type = null;

  return { action: "write", patch, termRemaining };
}
