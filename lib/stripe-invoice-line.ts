/**
 * Which invoice line describes the period this subscription purchased?
 *
 * lib/paid-through.ts asks for the billed line period and refuses to guess
 * without it. This module is the other half of that contract: it finds the
 * right line, or says it cannot, and it never picks one on a hunch.
 *
 * Why this is not `lines.data[0]`:
 *
 *   - A plan change or a mid-cycle upgrade puts PRORATION lines on the same
 *     invoice. Those describe credits and adjustments, not the purchased term,
 *     and their periods are short fragments. Index 0 can easily be one.
 *   - A subscription with more than one item bills one line per item, each
 *     with its own period.
 *   - Line order is not a documented guarantee, so index 0 is not stable.
 *
 * Getting it wrong is silent. The wrong line yields a plausible date that is
 * simply not the term the family bought, and nothing downstream can tell.
 *
 * The other trap this module exists to avoid: invoice.period_start and
 * invoice.period_end are NOT the purchased period. They describe the previous
 * cycle. On the one real dunning invoice in this account they differed from
 * the billed line period by a full month. This module never reads them, and
 * callers must not pass them in their place.
 *
 * Deliberately pure and structurally typed: no Stripe SDK import, so it runs
 * under `node --test`, which is strip-only.
 */

/** The shape we need from one invoice line, across old and new API versions. */
export interface InvoiceLineLike {
  period?: { start?: number | null; end?: number | null } | null;
  /** Current API shape (2026-02-25.clover and later). */
  parent?: {
    subscription_item_details?: {
      subscription?: string | null;
      subscription_item?: string | null;
      proration?: boolean | null;
    } | null;
  } | null;
  /** Legacy flat shape, still emitted by older API versions and fixtures. */
  subscription?: string | null;
  subscription_item?: string | null;
  proration?: boolean | null;
}

export type InvoiceLineSelection =
  | { kind: "found"; periodStart: Date | null; periodEnd: Date | null }
  | { kind: "ambiguous"; reason: string };

function detailsOf(line: InvoiceLineLike) {
  const d = line.parent?.subscription_item_details;
  return {
    subscription: d?.subscription ?? line.subscription ?? null,
    subscriptionItem: d?.subscription_item ?? line.subscription_item ?? null,
    proration: d?.proration ?? line.proration ?? false,
  };
}

function toDate(epochSeconds: number | null | undefined): Date | null {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return null;
  }
  const d = new Date(epochSeconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Find the single line that bills this subscription's purchased period.
 *
 * Deterministic by construction. Every branch that cannot prove it has the
 * right line returns `ambiguous`, which callers pass to classifyPaidThrough as
 * nulls and which therefore becomes "unknown". Locked rule: if the correct
 * line cannot be identified confidently, the answer is unknown, never a guess.
 *
 * `subscriptionItemIds` must be every item on the subscription. A subscription
 * with more than one item is ambiguous on purpose: there is no single
 * purchased period to report, and picking one would be exactly the kind of
 * plausible-looking guess this module refuses to make. Every Rooted
 * subscription has one item today, so this is a guard, not a limitation.
 */
export function selectSubscriptionInvoiceLine(args: {
  subscriptionId: string;
  subscriptionItemIds: string[];
  lines: InvoiceLineLike[] | null | undefined;
}): InvoiceLineSelection {
  const { subscriptionId, subscriptionItemIds, lines } = args;

  if (!subscriptionId) {
    return { kind: "ambiguous", reason: "no subscription id" };
  }
  if (subscriptionItemIds.length !== 1) {
    return {
      kind: "ambiguous",
      reason: `subscription has ${subscriptionItemIds.length} items, no single purchased period`,
    };
  }
  if (!lines || lines.length === 0) {
    return { kind: "ambiguous", reason: "invoice has no lines" };
  }

  const itemId = subscriptionItemIds[0];
  const candidates = lines.filter((line) => {
    const d = detailsOf(line);
    if (d.proration === true) return false;
    if (d.subscription !== subscriptionId) return false;
    return d.subscriptionItem === itemId;
  });

  if (candidates.length === 0) {
    return {
      kind: "ambiguous",
      reason: "no non-proration line matches this subscription item",
    };
  }
  if (candidates.length > 1) {
    // Two lines for the same item with different periods is not something we
    // can resolve without guessing, so we do not.
    return {
      kind: "ambiguous",
      reason: `${candidates.length} candidate lines match, cannot choose`,
    };
  }

  const period = candidates[0].period;
  return {
    kind: "found",
    periodStart: toDate(period?.start),
    periodEnd: toDate(period?.end),
  };
}
