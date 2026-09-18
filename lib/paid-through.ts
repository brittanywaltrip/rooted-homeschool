/**
 * "What period has actually been PAID for?"
 *
 * Both billing paths that decide entitlement used to ask the wrong question.
 * They read the subscription's current_period_end and treated it as the date
 * access was paid through. Stripe advances that field when it CREATES the
 * renewal invoice, not when the invoice is PAID, so a family whose card was
 * declined has a current_period_end up to a year in the future for a period
 * they never paid for. Reading it as "paid through" hands them a free term:
 *
 *   - app/api/stripe/webhook/route.ts (customer.subscription.deleted) computes
 *     termRemaining = periodEnd > now, so an unpaid advanced period keeps
 *     is_pro true and stamps subscription_end_date a year out.
 *   - lib/expire-subscriptions.ts rule 3 falls back to the same value when
 *     stamping subscription_end_date, which is then what rule 1 waits for.
 *
 * This module is the single answer both of them ask, so neither can grant an
 * unpaid future period while the other refuses to.
 *
 * The load-bearing insight is in rule 3 of classifyPaidThrough below: when the
 * current period's invoice is unpaid, the START of that unpaid period is the
 * END of the last paid one. Verified against a real dunning invoice in this
 * account, where the billed line period started at the same instant the last
 * paid period ended while the subscription's own period end had already
 * advanced a month past it.
 *
 * ── LOCKED PRINCIPLES ──────────────────────────────────────────────────────
 * These are deliberate constraints, not incidental implementation. Changing
 * any of them reopens a way to give away a paid product:
 *
 *   1. Never manufacture a paid-through date. There is no now + N fallback of
 *      any kind, anywhere in this file.
 *   2. Never use the subscription's current_period_end as proof of payment.
 *      It is not even accepted as an input, so it cannot be reached by
 *      accident. That is the whole bug in one field.
 *   3. draft, void, and missing or ambiguous data are all "unknown".
 *   4. "unknown" must never independently revoke Rooted+. Callers treat it as
 *      "leave this family alone", never as "unpaid".
 *
 * ── CONTRACT FOR CALLERS (phases B and C) ──────────────────────────────────
 *   - Do NOT blindly read lines.data[0]. An invoice can carry several lines
 *     with different periods after a proration or a plan change. Identify the
 *     line for THIS subscription deterministically, for example by matching
 *     its subscription item id. If the right line cannot be identified,
 *     pass nulls and accept "unknown". Guessing is the failure mode this
 *     module exists to prevent.
 *   - Do NOT pass invoice.period_start / invoice.period_end. Those describe
 *     the PREVIOUS cycle, not the purchased subscription period. On the real
 *     dunning invoice they differed from the billed line period by a full
 *     month, and the difference is silent: no error, just a wrong date.
 *
 * Deliberately pure: no Stripe SDK, no network, no imports. It runs under
 * `node --test`, which is strip-only and cannot resolve "@/" at module scope.
 */

/**
 * Stripe invoice statuses, as the API reports them. Note there is no
 * "past_due" here: that is a SUBSCRIPTION status. An unpaid invoice sits at
 * "open", which is the case rule 3 below is written for.
 */
export type InvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

/**
 * paid    - definitively paid through `through`. Safe to grant access to it.
 * unpaid  - the current period was NOT paid for. `through` is the end of the
 *           last period that WAS paid, which is usually in the past, so a
 *           caller comparing it to now will correctly revoke.
 * unknown - we could not tell. Callers must do nothing rather than guess.
 */
export type PaidThrough =
  | { kind: "paid"; through: Date }
  | { kind: "unpaid"; through: Date }
  | { kind: "unknown" };

export interface PaidThroughInput {
  /** Status of the subscription's latest invoice, or null if unavailable. */
  latestInvoiceStatus: InvoiceStatus | null;
  /**
   * The SERVICE period the latest invoice bills for, taken from the line item
   * belonging to this subscription. NOT invoice.period_start/period_end, which
   * describe the previous cycle. See the caller contract above.
   */
  latestInvoiceLinePeriodStart: Date | null;
  latestInvoiceLinePeriodEnd: Date | null;
  /**
   * Whether the charge for the CURRENT period was fully refunded. Scoped to
   * this period on purpose: an old refund on an earlier term says nothing
   * about whether this one was paid.
   */
  currentChargeFullyRefunded: boolean;
}

/**
 * Note what is absent: the subscription's current_period_end. It is not a
 * parameter, so no branch can consult it and no future edit can quietly
 * reintroduce it as a fallback. Locked principle 2.
 */

/** A Date we can actually use: present, a real Date, and not Invalid Date. */
function usable(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Classify what a subscription has been paid through.
 *
 * Rules are ordered, and the order matters:
 *
 *   1. A fully refunded current charge means the money went back, so the
 *      period is not paid no matter what the invoice says.
 *   2. A paid invoice is paid through the end of the period it billed. If
 *      that period end is missing or unusable there is no trustworthy answer,
 *      so the result is unknown rather than a substitute date.
 *   3. An open or uncollectible invoice means the current period was never
 *      paid, so the last paid period ended where this unpaid one starts.
 *   4. Anything else is unknown. "draft" is not finalised yet and "void" was
 *      cancelled rather than collected, so neither proves payment OR
 *      non-payment. Returning unknown keeps this function from being the
 *      thing that revokes a paying family's access on ambiguous input.
 */
export function classifyPaidThrough(input: PaidThroughInput): PaidThrough {
  const {
    latestInvoiceStatus,
    latestInvoiceLinePeriodStart,
    latestInvoiceLinePeriodEnd,
    currentChargeFullyRefunded,
  } = input;

  // ── 1. Refunded beats every other signal ────────────────────────────────
  if (currentChargeFullyRefunded) {
    return usable(latestInvoiceLinePeriodStart)
      ? { kind: "unpaid", through: latestInvoiceLinePeriodStart }
      : { kind: "unknown" };
  }

  // ── 2. Paid ─────────────────────────────────────────────────────────────
  if (latestInvoiceStatus === "paid") {
    return usable(latestInvoiceLinePeriodEnd)
      ? { kind: "paid", through: latestInvoiceLinePeriodEnd }
      : { kind: "unknown" };
  }

  // ── 3. Unpaid: the start of this period is the end of the last paid one ──
  if (latestInvoiceStatus === "open" || latestInvoiceStatus === "uncollectible") {
    return usable(latestInvoiceLinePeriodStart)
      ? { kind: "unpaid", through: latestInvoiceLinePeriodStart }
      : { kind: "unknown" };
  }

  // ── 4. draft, void, null ────────────────────────────────────────────────
  return { kind: "unknown" };
}
