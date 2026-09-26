// The failed-payment lifecycle: who gets told, when, and never twice.
//
// THE SAFETY INVARIANT, inherited from lib/paid-through.ts and unchanged here:
// Rooted may revoke Rooted+ only on positive evidence that the paid entitlement
// has ended. NOTHING in this module writes entitlement. A failed payment is an
// attempt that did not land, not proof that a term is over: Stripe is still
// collecting. classifyPaidThrough already returns `pending` for exactly this
// case and pending never revokes, so the failure event needs no entitlement
// opinion at all and must not grow one.
//
// WHAT DECIDES WHAT:
//   - first failure  → a retry is actually scheduled (positive evidence that
//                      collection continues)
//   - final failure  → the subscription is CONFIRMED terminated by a fresh
//                      Stripe read, AND the money was never collected
//   - everything between → logged, nobody emailed
//
// The final notice is deliberately NOT derived from attempt_count, from
// next_payment_attempt being null, from invoice status alone, or from elapsed
// time. Every one of those is an absence rather than a proof, and an absence
// has already been the source of two revocation bugs in this codebase. The
// caller establishes termination from a fresh subscription read and hands it in.
//
// Pure by construction: no imports with side effects, no clock of its own, no
// Supabase, no Stripe, no Resend. node --test drives the whole decision.

export type SuppressionReason = "hard_bounce" | "spam_complaint" | "admin_suppress";

/** Why a customer notice was not sent. Every value is logged verbatim. */
export type CustomerSkipReason =
  | SuppressionReason
  | "no_invoice_id"
  | "not_subscription_cycle"
  | "no_profile"
  | "subscription_mismatch"
  | "no_email"
  | "not_terminated"
  | "payment_was_collected";

export type CustomerDecision =
  | { send: true }
  | { send: false; reason: CustomerSkipReason };

/**
 * A profile resolved DETERMINISTICALLY, by stripe_customer_id only.
 *
 * There is no name, no display_name and no email on this type, and that is the
 * point: identity may never be inferred from any of them. profiles.first_name
 * is carried separately and is used ONLY to address the mail, never to decide
 * who it goes to. A previous version of the webhook derived the greeting from
 * display_name.split(" ")[0], which is the FAMILY name field, so families were
 * addressed by the wrong name.
 */
export interface LinkedProfile {
  userId: string;
  /** Display label for the admin notice only; never used to resolve identity. */
  familyLabel?: string | null;
  /** The subscription the profile currently holds, for the identity guard. */
  stripeSubscriptionId: string | null;
  /** Address to mail, read from auth.users for this exact id. */
  email: string | null;
  firstName: string | null;
}

export interface FirstFailureInput {
  /**
   * The invoice id, which IS the dedup key. Null means we cannot promise
   * "exactly once", so we say nothing to the customer and tell the admin.
   */
  invoiceId: string | null;
  /** Stripe's billing_reason. Only a renewal is worth an email. */
  billingReason: string | null;
  /** The subscription the INVOICE belongs to. */
  invoiceSubscriptionId: string | null;
  /** Null when no profile is deterministically linked to the Stripe customer. */
  profile: LinkedProfile | null;
  /** Set when this address is bounce/complaint/admin suppressed. */
  suppression: SuppressionReason | null;
}

// NOTE, deliberately absent: next_payment_attempt, attempt_count and any clock.
//
// An earlier revision required a future next_payment_attempt before telling a
// family their renewal had failed, on the grounds that the copy promised a
// retry. That produced a silent case: a genuine renewal failure that Stripe did
// not expose a retry time for reached nobody, which is the one outcome a
// billing notice exists to prevent. Absence of a retry time is an absence, not
// a reason to stay quiet.
//
// The copy no longer promises a retry, and these fields are not on this type at
// all, so they CANNOT gate the first notice. next_payment_attempt is still read
// by the route and passed to logs and the admin notice, where it is useful
// observational context and nothing more.

export interface FinalFailureInput {
  /**
   * TRUE only when a FRESH Stripe read said the subscription is terminated.
   * The caller must not pass a value derived from the webhook payload snapshot,
   * from attempt counts, or from time having passed.
   */
  terminationConfirmed: boolean;
  /**
   * What lib/paid-through.ts concluded the family actually paid through.
   * Only "unpaid" means money was not collected for the final term.
   */
  paidThroughKind: "paid" | "unpaid" | "pending" | "unknown";
  /**
   * The final invoice's status. "unpaid" from the classifier can ALSO mean a
   * full refund of a genuinely paid invoice, and a refunded family must never
   * be told "we weren't able to process your renewal". Only an invoice that was
   * never collected (open / uncollectible) is a nonpayment termination.
   */
  latestInvoiceStatus: string | null;
  profile: LinkedProfile | null;
  suppression: SuppressionReason | null;
}

const NEVER_COLLECTED = new Set(["open", "uncollectible"]);

/**
 * Should the family get the one first-failure notice for this invoice?
 *
 * A genuine renewal failure reaches the family whether or not Stripe is
 * currently exposing a retry time. The only things that stop it are structural:
 * no dedup key, not a renewal, no deterministic link, no address, or a dead or
 * hostile address.
 */
export function decideFirstFailureCustomerEmail(input: FirstFailureInput): CustomerDecision {
  if (!input.invoiceId) return { send: false, reason: "no_invoice_id" };
  if (input.billingReason !== "subscription_cycle") {
    // A failed FIRST purchase is someone standing at the checkout who already
    // saw the error on screen. Mailing them about a subscription they never had
    // is confusing, and there is no access to reassure them about.
    return { send: false, reason: "not_subscription_cycle" };
  }
  if (!input.profile) return { send: false, reason: "no_profile" };
  if (!identityMatches(input.profile, input.invoiceSubscriptionId)) {
    return { send: false, reason: "subscription_mismatch" };
  }
  if (!usableEmail(input.profile.email)) return { send: false, reason: "no_email" };
  if (input.suppression) return { send: false, reason: input.suppression };
  return { send: true };
}

/**
 * Should the family get the one final notice for this invoice?
 *
 * Requires POSITIVE evidence on both halves: the subscription really is over,
 * and the money really was never collected.
 */
export function decideFinalFailureCustomerEmail(input: FinalFailureInput): CustomerDecision {
  if (!input.terminationConfirmed) return { send: false, reason: "not_terminated" };
  if (input.paidThroughKind !== "unpaid") {
    // paid    → they cancelled having paid the term out. Not a failure.
    // pending → Stripe is still collecting. Not over.
    // unknown → we could not prove anything, so we say nothing.
    return { send: false, reason: "payment_was_collected" };
  }
  if (!NEVER_COLLECTED.has(input.latestInvoiceStatus ?? "")) {
    // "unpaid" with a paid invoice is the full-refund path, not a dunning
    // failure. Telling a refunded family their card was declined is wrong.
    return { send: false, reason: "payment_was_collected" };
  }
  if (!input.profile) return { send: false, reason: "no_profile" };
  if (!usableEmail(input.profile.email)) return { send: false, reason: "no_email" };
  if (input.suppression) return { send: false, reason: input.suppression };
  return { send: true };
}

/** The identity guard: the profile must hold the very subscription that failed. */
export function identityMatches(profile: LinkedProfile, invoiceSubscriptionId: string | null): boolean {
  if (!invoiceSubscriptionId) return false;
  return profile.stripeSubscriptionId === invoiceSubscriptionId;
}

function usableEmail(email: string | null): boolean {
  return !!email && email.includes("@");
}

/** How a family is addressed. Never derived from display_name. */
export function greetingName(firstName: string | null | undefined): string {
  const name = (firstName ?? "").replace(/\s+/g, " ").trim();
  return name || "friend";
}

// ── Copy ───────────────────────────────────────────────────────────────────
// Approved sign-offs only, and no em dashes in anything a family reads.

export const FIRST_FAILURE_SUBJECT = "There was a problem with your Rooted+ payment";
export const FINAL_FAILURE_SUBJECT = "Your Rooted+ subscription has ended";

export function firstFailureBody(args: { firstName: string | null; billingUrl: string }): string {
  return [
    `Hi ${greetingName(args.firstName)},`,
    "",
    "We tried to renew your Rooted+ subscription, but the payment didn't go through.",
    "",
    "Your Rooted+ access is still active. You can update your payment method here:",
    "",
    args.billingUrl,
    "",
    "If your payment is successfully processed, there's nothing else you need to do.",
    "",
    "Thank you,",
    "Brittany",
  ].join("\n");
}

export function finalFailureBody(args: { firstName: string | null; upgradeUrl: string }): string {
  return [
    `Hi ${greetingName(args.firstName)},`,
    "",
    "We weren't able to process your Rooted+ renewal after several attempts, so your Rooted+ subscription has ended.",
    "",
    "Nothing in your account has been deleted. You can still sign in and use Rooted on the free plan.",
    "",
    "If you'd like to restore Rooted+, you can do that here:",
    "",
    args.upgradeUrl,
    "",
    "Thanks,",
    "Brittany",
  ].join("\n");
}

// ── Admin copy ─────────────────────────────────────────────────────────────
// Admin notices are plain text and carry every authoritative identifier, so a
// human can always find the account without guessing from a name. display_name
// appears as a LABEL only, and is absent entirely when no profile is linked.

export interface AdminNoticeInput {
  stage: "first" | "final";
  familyLabel: string | null;
  userId: string | null;
  customerId: string;
  subscriptionId: string | null;
  invoiceId: string;
  amountDue: string;
  attemptCount: number | null;
  nextPaymentAttemptIso?: string | null;
  customerEmailOutcome: string;
}

export function adminNoticeSubject(input: { stage: "first" | "final"; familyLabel: string | null; linked: boolean }): string {
  const who = input.linked ? (input.familyLabel || "Unknown family") : "UNLINKED Stripe customer";
  return input.stage === "first"
    ? `Rooted payment failed: ${who}`
    : `Rooted payment failed FINAL, access ended: ${who}`;
}

export function adminNoticeBody(input: AdminNoticeInput): string {
  const lines = [
    input.stage === "first"
      ? "A subscription payment failed. Access is unchanged while Stripe retries."
      : "A subscription terminated after payment could not be collected. Entitlement follows the evidence-based cancellation path.",
    "",
    `Family:        ${input.familyLabel ?? "(no linked profile)"}`,
    `User:          ${input.userId ?? "(none, NOT LINKED)"}`,
    `Customer:      ${input.customerId}`,
    `Subscription:  ${input.subscriptionId ?? "(none)"}`,
    `Invoice:       ${input.invoiceId}`,
    `Amount due:    ${input.amountDue}`,
    `Attempt:       ${input.attemptCount ?? "(unknown)"}`,
    `Next retry:    ${input.nextPaymentAttemptIso ?? "none scheduled"}`,
    "",
    `Customer email: ${input.customerEmailOutcome}`,
  ];
  if (!input.userId) {
    lines.push(
      "",
      "No profile is deterministically linked to this Stripe customer, so no customer email was sent and no entitlement was inferred. Link it by stripe_customer_id before acting.",
    );
  }
  return lines.join("\n");
}
