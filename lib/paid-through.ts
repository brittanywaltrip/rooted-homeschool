/**
 * "What period has actually been PAID for?"
 *
 * Stripe advances a subscription's current_period_end when it CREATES the
 * renewal invoice, not when that invoice is PAID. Reading it as a paid-through
 * date hands a family whose card was declined a term they never paid for. This
 * module is the single answer both the webhook and the nightly reconciliation
 * ask, so the two can never disagree, and current_period_end is not even
 * accepted as an input.
 *
 * The load-bearing insight: when the current period's invoice is unpaid, the
 * START of that unpaid period is the END of the last paid one. Verified against
 * the one real dunning invoice in this account, where the billed line period
 * started exactly where the last paid period ended while the subscription's own
 * period end had already advanced a month past it.
 *
 * ── THE SAFETY INVARIANT ───────────────────────────────────────────────────
 * Rooted may revoke Rooted+ only when it has POSITIVE EVIDENCE that the
 * relevant paid entitlement has ended. Absence of evidence is never evidence of
 * nonpayment. Every branch below that cannot prove what happened returns
 * `unknown`, and `unknown` means callers write nothing at all.
 *
 * ── LOCKED PRINCIPLES ──────────────────────────────────────────────────────
 *   1. Never manufacture a paid-through date. No now + N fallback exists here.
 *   2. Never use the subscription's current_period_end as proof of payment. It
 *      is not a parameter, so it cannot be reached by accident.
 *   3. draft, void, and missing or ambiguous data are all `unknown`.
 *   4. `unknown` and `pending` never revoke Rooted+.
 *   5. Refund uncertainty is NEVER converted to "not refunded". An unresolved
 *      refund lookup propagates to `unknown`, because classifying a term as
 *      paid on unknown refund evidence would assert something unproven.
 *   6. An absent next_payment_attempt does NOT by itself prove collection has
 *      ended. Only corroborating subscription state can, which is why
 *      collectionState is an explicit input rather than a caller convention.
 *
 * ── CONTRACT FOR CALLERS ───────────────────────────────────────────────────
 *   - Identify the billed line deterministically (lib/stripe-invoice-line.ts).
 *     Never lines.data[0]: a proration fragment can sit at index 0 and would
 *     report a one-hour "term". If the right line cannot be identified, pass
 *     nulls and accept `unknown`.
 *   - Never pass invoice.period_start / invoice.period_end. Those describe the
 *     PREVIOUS cycle and differed from the billed period by a full month on the
 *     real dunning invoice. The difference is silent.
 *   - Derive collectionState from FRESHLY retrieved Stripe state, not from the
 *     webhook event payload, which is a snapshot of the past.
 *
 * Deliberately pure: no Stripe SDK, no network, no imports. It runs under
 * `node --test`, which is strip-only and cannot resolve "@/" at module scope.
 */

/**
 * Stripe invoice statuses. Note there is no "past_due" here: that is a
 * SUBSCRIPTION status. An unpaid invoice sits at "open".
 */
export type InvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

/**
 * Invoice-scoped refund evidence for the period in question.
 *
 * `none` means the lookup SUCCEEDED and found nothing refunded, including the
 * ordinary case of an open invoice with no successful payment to refund.
 * `unknown` means the lookup itself failed. Those two are never conflated.
 */
export type RefundState = "none" | "partial" | "full" | "unknown";

/**
 * Whether Stripe has definitively stopped trying to collect, corroborated by
 * freshly retrieved subscription state. `terminated` is the only value that
 * lets an unpaid invoice become a revocation.
 */
export type CollectionState = "terminated" | "live" | "unknown";

/**
 * What this subscription was paid through BEFORE the invoice in question,
 * established by asking Stripe for invoices whose status is "paid".
 *
 * The three-way split is the whole reason an unpaid invoice's own period
 * boundary is no longer consulted:
 *
 *   proven  - at least one paid invoice exists; `through` is the furthest
 *             billed line end among them, each independently proven.
 *   none    - the lookup SUCCEEDED and found zero paid invoices. That is
 *             positive evidence that nothing was ever paid, the same standard
 *             already applied to refunds, and it is what stops a subscriber who
 *             never paid from keeping Rooted+ behind a nightly log line.
 *   unknown - the lookup itself failed. Absence of evidence, so nothing is
 *             written and nobody is revoked.
 */
export type PriorPaidThrough =
  | { kind: "proven"; through: Date }
  | { kind: "none" }
  | { kind: "unknown" };

/**
 * paid    - definitively paid through `through`. Safe to grant access to it.
 * unpaid  - positively evidenced as NOT paid. `through` is the end of the last
 *           period that WAS paid.
 * pending - Stripe is still collecting. Not a failure yet, and never a reason
 *           to revoke.
 * unknown - we could not tell. Callers write nothing.
 */
export type PaidThrough =
  | { kind: "paid"; through: Date }
  | { kind: "unpaid"; through: Date }
  | { kind: "pending"; retryAt: Date }
  | { kind: "unknown"; reason: string };

export interface PaidThroughInput {
  latestInvoiceStatus: InvoiceStatus | null;
  /**
   * The SERVICE period the latest invoice bills for, from the line item
   * belonging to this subscription. See the caller contract above.
   */
  latestInvoiceLinePeriodStart: Date | null;
  latestInvoiceLinePeriodEnd: Date | null;
  /** Stripe's next scheduled collection attempt for this invoice, if any. */
  latestInvoiceNextPaymentAttempt: Date | null;
  /** Corroborating state from a FRESH subscription read. */
  collectionState: CollectionState;
  /**
   * What was paid for BEFORE this invoice. Replaces the old habit of reading
   * the unpaid invoice's own line period START, which is a boundary rather than
   * evidence of payment and diverges outright on a first-ever open invoice, on
   * a proration, and on any gap from a pause or a billing-anchor change.
   */
  priorPaidThrough: PriorPaidThrough;
  /**
   * Stripe's sub.start_date. Used ONLY when prior payment is positively known
   * to be `none`, to express zero paid time as a real fact about the
   * subscription rather than a boundary inference.
   */
  subscriptionStartedAt: Date | null;
  /** Invoice-scoped refund evidence. */
  refundState: RefundState;
  now: Date;
}

/**
 * The paid-through date for a subscription, chosen from invoices that were each
 * independently PROVEN paid.
 *
 * ── WHY UNPAID INVOICES CANNOT CONTRIBUTE ──────────────────────────────────
 * The obvious-looking shortcut is to take an unpaid invoice's line period
 * START, on the reasoning that the unpaid period begins where the last paid one
 * ended. That is an inference about adjacency, not evidence of payment, and it
 * breaks in three real shapes:
 *
 *   - A first-ever invoice that is open (billing_reason subscription_create)
 *     has a line period starting at the subscription creation instant. Using
 *     its start asserts "paid through the moment they signed up" when nothing
 *     was ever paid.
 *   - A proration invoice (subscription_update) starts at a mid-cycle boundary
 *     that is not the end of any paid period.
 *   - A GAP, from a pause and resume or a billing-anchor change, puts the
 *     unpaid line start LATER than the real last paid end, which would hand out
 *     entitlement time nobody bought.
 *
 * So the rule is enforced here rather than left to callers: each candidate
 * carries its invoice status, and anything that is not "paid" is ignored. A
 * caller cannot smuggle an unpaid boundary in by mislabelling it as a date.
 *
 * The maximum is safe precisely because every surviving candidate is proven, so
 * it can never over-state. Taking the max rather than the newest also stops a
 * recent proration invoice from under-stating the real term.
 *
 * Returns null when nothing qualifies. Null means "we could not prove this",
 * never "there is none".
 */
export interface PaidPeriodCandidate {
  /** The status of the invoice this date came from. Only "paid" counts. */
  invoiceStatus: InvoiceStatus | null;
  /** That invoice's billed line END for this subscription. */
  billedLineEnd: Date | null;
}

export function resolvePaidPeriodEnd(candidates: PaidPeriodCandidate[]): Date | null {
  let best: Date | null = null;
  for (const candidate of candidates) {
    // The enforced contract: an unpaid invoice proves nothing about paid time.
    if (candidate.invoiceStatus !== "paid") continue;
    if (!usable(candidate.billedLineEnd)) continue;
    if (best === null || candidate.billedLineEnd.getTime() > best.getTime()) {
      best = candidate.billedLineEnd;
    }
  }
  return best;
}

/** A Date we can actually use: present, a real Date, and not Invalid Date. */
function usable(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function unknown(reason: string): PaidThrough {
  return { kind: "unknown", reason };
}

/**
 * Classify what a subscription has been paid through.
 *
 * Two passes, in this order, because refund evidence only matters once the
 * structural answer would actually be paid or unpaid:
 *
 *   STRUCTURAL
 *     - open with a future retry        → pending  (refund never consulted)
 *     - paid                            → paid, through the billed line END
 *     - open/uncollectible + terminated → unpaid, through the billed line START
 *     - open/uncollectible otherwise    → unknown  (collection not corroborated)
 *     - draft / void / missing          → unknown
 *
 *   REFUND, only when structural is paid or unpaid
 *     - unknown         → unknown   (never "not refunded")
 *     - full            → unpaid, through the billed line START
 *     - partial or none → keep the structural answer
 *
 * A partial refund never makes a term unpaid. Only the whole relevant charge
 * coming back does.
 */
export function classifyPaidThrough(input: PaidThroughInput): PaidThrough {
  const {
    latestInvoiceStatus: status,
    latestInvoiceLinePeriodStart: lineStart,
    latestInvoiceLinePeriodEnd: lineEnd,
    latestInvoiceNextPaymentAttempt: nextAttempt,
    collectionState,
    priorPaidThrough,
    subscriptionStartedAt,
    refundState,
    now,
  } = input;

  // ── Structural pass ─────────────────────────────────────────────────────

  // Still in dunning. Stripe has not failed to collect, it simply has not
  // finished trying, so nothing about entitlement has been decided yet.
  if (status === "open" && usable(nextAttempt) && usable(now) && nextAttempt > now) {
    return { kind: "pending", retryAt: nextAttempt };
  }

  let structural: PaidThrough;

  if (status === "paid") {
    if (!usable(lineEnd)) {
      return unknown("paid invoice with no readable billed line period end");
    }
    structural = { kind: "paid", through: lineEnd };
  } else if (status === "open" || status === "uncollectible") {
    // An absent next_payment_attempt is an absence, not a proof. Only fresh
    // subscription state can corroborate that collection has terminated, and
    // uncollectible alone is not enough.
    if (collectionState !== "terminated") {
      return unknown(
        `invoice ${status} but collection state is ${collectionState}, not corroborated as terminated`,
      );
    }
    // Paid-through comes only from an invoice that was actually PAID. The
    // unpaid invoice's own lineStart is deliberately NOT consulted here: it
    // marks where the unpaid period begins, which is not the same as where a
    // paid one ended, and on a gap it sits LATER than the real last paid end,
    // which would hand out time nobody bought.
    if (priorPaidThrough.kind === "unknown") {
      return unknown(
        `invoice ${status} but prior payment history could not be read`,
      );
    }
    if (priorPaidThrough.kind === "proven") {
      // Even a "proven" answer has to carry a usable date. An Invalid Date is
      // missing evidence wearing the right label.
      if (!usable(priorPaidThrough.through)) {
        return unknown(`invoice ${status} with an unusable proven paid-through date`);
      }
      structural = { kind: "unpaid", through: priorPaidThrough.through };
    } else {
      // "none": the lookup succeeded and there are no paid invoices at all, so
      // zero time was ever paid for. The subscription's own start date says
      // that as a fact rather than inferring it from an invoice boundary.
      if (!usable(subscriptionStartedAt)) {
        return unknown(
          `invoice ${status} with no paid history and no usable subscription start date`,
        );
      }
      structural = { kind: "unpaid", through: subscriptionStartedAt };
    }
  } else {
    return unknown(`invoice status ${status ?? "missing"} proves nothing either way`);
  }

  // ── Refund pass ─────────────────────────────────────────────────────────

  if (refundState === "unknown") {
    // Locked principle 5. Treating this as "not refunded" would assert
    // something the evidence does not support.
    return unknown("refund state could not be determined");
  }

  if (refundState === "full") {
    if (!usable(lineStart)) {
      return unknown("full refund but no readable billed line period start");
    }
    return { kind: "unpaid", through: lineStart };
  }

  // none or partial: a partial refund leaves the term paid for.
  return structural;
}
