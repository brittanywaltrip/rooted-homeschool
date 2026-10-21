/**
 * invoice.paid: record a renewal's paid-through date once the money lands.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * On a renewal Stripe advances the subscription and fires
 * customer.subscription.updated BEFORE it collects. That branch resolves the
 * paid-through date from paid invoices only, so at that instant it correctly
 * stores the END OF THE OLD TERM. The renewal invoice is paid about an hour
 * later, and until now nothing listened: sub_1TxRljLP14EaoUlT7IBDHBSS renewed
 * on 2026-09-26, in_1UJvKFLP14EaoUlTBZoufG0y was paid an hour after the update,
 * and the profile kept the old date. The nightly sweep skips active
 * subscriptions and the monthly linkage audit only reports drift, so nothing
 * repaired it.
 *
 * ── WHAT IT DOES, AND ONLY THAT ────────────────────────────────────────────
 * Moves profiles.current_period_end FORWARD to the billed line end of a
 * freshly re-read, paid, unrefunded invoice, on the one profile
 * deterministically linked to that invoice's subscription. Nothing else:
 *
 *   - never is_pro, subscription_status, plan_type, legacy_free,
 *     subscription_end_date, cancel_at or any Stripe id. Access, gift, legacy
 *     and cancellation state belong to other handlers and stay as they are.
 *   - never links or relinks anything. A profile that does not already hold
 *     this exact subscription is left alone.
 *   - never a referral, commission or email. A renewal earns no commission.
 *   - never backwards. A delayed or older invoice cannot shorten a term, and a
 *     gifted year that runs past the invoice is preserved.
 *
 * ── EVIDENCE RULES ─────────────────────────────────────────────────────────
 * The event payload supplies ids and nothing else. Status, customer, lines and
 * subscription state all come from fresh Stripe reads, the same order-
 * independence the subscription.updated and .deleted branches already rely on.
 * Every branch that cannot prove the date writes nothing. Failed reads and
 * failed writes ask Stripe to redeliver (retry: true) because the handler is
 * idempotent; settled refusals do not.
 *
 * Deliberately free of the Stripe SDK and "@/" imports so it runs under
 * `node --test`, which is strip-only. The route injects the IO.
 */

import {
  selectSubscriptionInvoiceLine,
  type InvoiceLineLike,
} from "./stripe-invoice-line.ts";
import { resolvePaidPeriodEnd, type RefundState } from "./paid-through.ts";
import { invoiceSubscriptionId } from "./invoice-subscription.ts";

/** The invoice fields this handler reads, structurally typed. */
export interface PaidInvoiceLike {
  id?: string | null;
  status?: string | null;
  customer?: string | { id: string } | null;
  parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  subscription?: string | { id: string } | null;
  lines?: { data?: InvoiceLineLike[] | null; has_more?: boolean | null } | null;
}

export interface SubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  items?: { data?: Array<{ id: string }> | null } | null;
}

export interface LinkedProfileRow {
  id: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
}

export interface InvoicePaidDeps {
  /** Fresh read. Throw on any failure. */
  retrieveInvoice(invoiceId: string): Promise<PaidInvoiceLike>;
  /** Fresh read. Throw on any failure. */
  retrieveSubscription(subscriptionId: string): Promise<SubscriptionLike>;
  /** Invoice-scoped refund evidence; 'unknown' when the lookup failed. */
  refundState(invoiceId: string): Promise<RefundState>;
  /**
   * Every profile carrying this stripe_customer_id, at most two, so a
   * duplicate link is visible as ambiguity instead of an arbitrary pick.
   * Throw on a read failure.
   */
  profilesForCustomer(customerId: string): Promise<LinkedProfileRow[]>;
  /**
   * Compare-and-swap. Write current_period_end = `through` only where the row
   * is still this profile, still holds this subscription, and still carries
   * exactly `expectedCurrent` (null meaning IS NULL). Report whether a row
   * matched. Throw on a write failure.
   */
  advancePaidThrough(args: {
    profileId: string;
    subscriptionId: string;
    expectedCurrent: string | null;
    through: Date;
  }): Promise<{ matched: boolean }>;
}

export type InvoicePaidSkipReason =
  | "no_invoice_id"
  | "not_a_subscription_invoice"
  | "stripe_unreadable"
  | "invoice_not_paid"
  | "invoice_subscription_changed"
  | "customer_mismatch"
  | "subscription_not_live"
  | "no_profile"
  | "ambiguous_profile"
  | "subscription_mismatch"
  | "line_ambiguous"
  | "refund_full"
  | "refund_unknown"
  | "profile_unreadable"
  | "already_current"
  | "row_changed"
  | "write_failed";

export type InvoicePaidOutcome =
  | {
      action: "advanced";
      invoiceId: string;
      subscriptionId: string;
      profileId: string;
      from: string | null;
      to: string;
    }
  | {
      action: "skipped";
      reason: InvoicePaidSkipReason;
      /** True when Stripe should redeliver: a read or write failed transiently. */
      retry: boolean;
      invoiceId: string | null;
      subscriptionId: string | null;
      profileId?: string;
      detail?: string;
    };

/** The same live set the subscription.updated branch promotes on. */
const LIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id ?? null;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function handleInvoicePaid(
  eventInvoice: PaidInvoiceLike,
  deps: InvoicePaidDeps,
): Promise<InvoicePaidOutcome> {
  const invoiceId = eventInvoice.id ?? null;
  const subscriptionId = invoiceSubscriptionId(eventInvoice);
  const skip = (
    reason: InvoicePaidSkipReason,
    extra: { retry?: boolean; profileId?: string; detail?: string } = {},
  ): InvoicePaidOutcome => ({
    action: "skipped",
    reason,
    retry: extra.retry ?? false,
    invoiceId,
    subscriptionId,
    ...(extra.profileId ? { profileId: extra.profileId } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
  });

  if (!invoiceId) return skip("no_invoice_id");
  // One-off invoices (no subscription) never describe a subscription term.
  if (!subscriptionId) return skip("not_a_subscription_invoice");

  // ── Fresh evidence ────────────────────────────────────────────────────────
  let invoice: PaidInvoiceLike;
  let sub: SubscriptionLike;
  try {
    invoice = await deps.retrieveInvoice(invoiceId);
    sub = await deps.retrieveSubscription(subscriptionId);
  } catch (e) {
    return skip("stripe_unreadable", { retry: true, detail: errText(e) });
  }

  if (invoice.status !== "paid") {
    return skip("invoice_not_paid", { detail: `fresh status ${invoice.status ?? "null"}` });
  }
  if (invoiceSubscriptionId(invoice) !== subscriptionId || sub.id !== subscriptionId) {
    return skip("invoice_subscription_changed");
  }
  const customerId = idOf(invoice.customer);
  if (!customerId || customerId !== idOf(sub.customer)) {
    return skip("customer_mismatch");
  }
  // A terminated subscription belongs to the deleted handler and the sweep.
  // Extending its date here would quietly re-open a closed term.
  if (!LIVE_SUBSCRIPTION_STATUSES.has(sub.status)) {
    return skip("subscription_not_live", { detail: `fresh status ${sub.status}` });
  }

  // ── Deterministic linkage: stripe_customer_id, then the exact subscription.
  // No email fallback and no relinking; subscription.created/updated own that.
  let profiles: LinkedProfileRow[];
  try {
    profiles = await deps.profilesForCustomer(customerId);
  } catch (e) {
    return skip("profile_unreadable", { retry: true, detail: errText(e) });
  }
  if (profiles.length === 0) return skip("no_profile");
  if (profiles.length > 1) return skip("ambiguous_profile");
  const profile = profiles[0];
  if (profile.stripe_subscription_id !== subscriptionId) {
    return skip("subscription_mismatch", {
      profileId: profile.id,
      detail: `profile holds ${profile.stripe_subscription_id ?? "(none)"}`,
    });
  }

  // ── The billed line, chosen deterministically. A truncated list could hide a
  // second candidate; a proration-only invoice has no purchased term.
  const selection = selectSubscriptionInvoiceLine({
    subscriptionId,
    subscriptionItemIds: (sub.items?.data ?? []).map((item) => item.id),
    lines: invoice.lines?.has_more === true ? null : invoice.lines?.data ?? null,
  });
  if (selection.kind !== "found") {
    return skip("line_ambiguous", { profileId: profile.id, detail: selection.reason });
  }
  const through = resolvePaidPeriodEnd([
    { invoiceStatus: "paid", billedLineEnd: selection.periodEnd },
  ]);
  if (!through) {
    return skip("line_ambiguous", { profileId: profile.id, detail: "billed line has no end" });
  }

  // ── Refunds. A full refund voids the term; a partial one does not. Unknown is
  // never softened into "not refunded".
  const refund = await deps.refundState(invoiceId);
  if (refund === "full") return skip("refund_full", { profileId: profile.id });
  if (refund === "unknown") return skip("refund_unknown", { retry: true, profileId: profile.id });

  // ── Forward only. Duplicates, older invoices delivered late, and a gifted
  // year that already runs further all land here and write nothing.
  const stored = profile.current_period_end;
  if (stored !== null) {
    const storedMs = new Date(stored).getTime();
    if (!Number.isNaN(storedMs) && storedMs >= through.getTime()) {
      return skip("already_current", { profileId: profile.id, detail: `stored ${stored}` });
    }
  }

  let matched: boolean;
  try {
    ({ matched } = await deps.advancePaidThrough({
      profileId: profile.id,
      subscriptionId,
      expectedCurrent: stored,
      through,
    }));
  } catch (e) {
    return skip("write_failed", { retry: true, profileId: profile.id, detail: errText(e) });
  }
  // Something else wrote the row between our read and our write (another
  // delivery, a subscription.updated, a relink). Redelivery re-decides from
  // whatever is true then, so nothing is overwritten on stale information.
  if (!matched) return skip("row_changed", { retry: true, profileId: profile.id });

  return {
    action: "advanced",
    invoiceId,
    subscriptionId,
    profileId: profile.id,
    from: stored,
    to: through.toISOString(),
  };
}
