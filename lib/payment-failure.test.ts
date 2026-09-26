// node --test lib/payment-failure.test.ts
//
// Strip-only runner: no "@/" imports at module scope, no TS parameter
// properties.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { invoiceSubscriptionId } from "./invoice-subscription.ts";

import {
  decideFirstFailureCustomerEmail,
  decideFinalFailureCustomerEmail,
  identityMatches,
  greetingName,
  firstFailureBody,
  finalFailureBody,
  adminNoticeSubject,
  adminNoticeBody,
  FIRST_FAILURE_SUBJECT,
  FINAL_FAILURE_SUBJECT,
  type LinkedProfile,
  type FirstFailureInput,
  type FinalFailureInput,
} from "./payment-failure.ts";


function profile(over: Partial<LinkedProfile> = {}): LinkedProfile {
  return {
    userId: "user-1",
    stripeSubscriptionId: "sub_live",
    email: "family@example.com",
    firstName: "Dana",
    ...over,
  };
}

function firstInput(over: Partial<FirstFailureInput> = {}): FirstFailureInput {
  return {
    invoiceId: "in_1",
    billingReason: "subscription_cycle",
    invoiceSubscriptionId: "sub_live",
    profile: profile(),
    suppression: null,
    ...over,
  };
}

function finalInput(over: Partial<FinalFailureInput> = {}): FinalFailureInput {
  return {
    terminationConfirmed: true,
    paidThroughKind: "unpaid",
    latestInvoiceStatus: "open",
    profile: profile(),
    suppression: null,
    ...over,
  };
}

// ── First failure ──────────────────────────────────────────────────────────

test("a renewal failure sends the customer notice", () => {
  assert.deepEqual(decideFirstFailureCustomerEmail(firstInput()), { send: true });
});

test("no invoice id means no customer email, because there is no dedup key", () => {
  assert.deepEqual(decideFirstFailureCustomerEmail(firstInput({ invoiceId: null })), {
    send: false,
    reason: "no_invoice_id",
  });
});

test("a failed FIRST purchase never emails the customer", () => {
  const d = decideFirstFailureCustomerEmail(firstInput({ billingReason: "subscription_create" }));
  assert.deepEqual(d, { send: false, reason: "not_subscription_cycle" });
});

test("no linked profile means no customer email", () => {
  const d = decideFirstFailureCustomerEmail(firstInput({ profile: null }));
  assert.deepEqual(d, { send: false, reason: "no_profile" });
});

test("identity: a failure for a subscription the profile no longer holds never emails", () => {
  // The family resubscribed; the profile now holds sub_new. A retried delivery
  // for the OLD subscription must not reach them.
  const d = decideFirstFailureCustomerEmail(
    firstInput({ profile: profile({ stripeSubscriptionId: "sub_new" }), invoiceSubscriptionId: "sub_old" }),
  );
  assert.deepEqual(d, { send: false, reason: "subscription_mismatch" });
});

test("identity: a null subscription id on the invoice never matches", () => {
  assert.equal(identityMatches(profile({ stripeSubscriptionId: null }), null), false);
  const d = decideFirstFailureCustomerEmail(firstInput({ invoiceSubscriptionId: null }));
  assert.deepEqual(d, { send: false, reason: "subscription_mismatch" });
});

test("no usable address means no customer email", () => {
  assert.deepEqual(decideFirstFailureCustomerEmail(firstInput({ profile: profile({ email: null }) })), {
    send: false,
    reason: "no_email",
  });
  assert.deepEqual(decideFirstFailureCustomerEmail(firstInput({ profile: profile({ email: "not-an-address" }) })), {
    send: false,
    reason: "no_email",
  });
});

// ── next_payment_attempt is observational only ─────────────────────────────

test("RETRY TIME NEVER GATES THE FIRST NOTICE: it is not an input at all", () => {
  // Structural, not behavioural: the field cannot gate what it cannot see.
  // An earlier revision required a future retry time and produced a silent
  // case, where a genuine renewal failure reached nobody.
  const keys = Object.keys(firstInput());
  assert.ok(!keys.some((k) => k.toLowerCase().includes("attempt")), "a retry field is back on the input");
  assert.ok(!keys.some((k) => k.toLowerCase().includes("retry")), "a retry field is back on the input");
  assert.ok(!keys.some((k) => k === "now"), "a clock is back on the input");
  assert.equal(decideFirstFailureCustomerEmail.length, 1);
});

/**
 * Mirrors exactly how the route builds the decision input from a Stripe
 * invoice, so these cases exercise the real mapping rather than a hand-made
 * object. If the route ever starts forwarding a retry field, the sweep test
 * below fails.
 */
function decideFromStripeInvoice(invoice: {
  id?: string | null;
  billing_reason?: string | null;
  subscription?: string | null;
  parent?: { subscription_details?: { subscription?: string | null } | null } | null;
  next_payment_attempt?: number | null;
  attempt_count?: number | null;
}) {
  return decideFirstFailureCustomerEmail({
    invoiceId: invoice.id ?? null,
    billingReason: invoice.billing_reason ?? null,
    invoiceSubscriptionId: invoiceSubscriptionId(invoice),
    profile: profile(),
    suppression: null,
  });
}

test("a current Stripe renewal invoice identifies its subscription and sends the family notice", () => {
  const d = decideFromStripeInvoice({
    id: "in_1", billing_reason: "subscription_cycle",
    parent: { subscription_details: { subscription: "sub_live" } },
    next_payment_attempt: 1790630425, attempt_count: 1,
  });
  assert.deepEqual(d, { send: true });
});

test("legacy invoice subscription reference remains supported", () => {
  assert.equal(invoiceSubscriptionId({ subscription: { id: "sub_old" } }), "sub_old");
  assert.equal(invoiceSubscriptionId({ parent: null }), null);
});

test("future retry time still sends the first notice", () => {
  const future = Math.floor(new Date("2026-09-21T12:00:00.000Z").getTime() / 1000);
  const d = decideFromStripeInvoice({
    id: "in_1", billing_reason: "subscription_cycle", subscription: "sub_live",
    next_payment_attempt: future, attempt_count: 1,
  });
  assert.deepEqual(d, { send: true });
});

test("NULL retry time still sends the first notice", () => {
  // The exhausted-attempt shape, and the hard-decline shape.
  const d = decideFromStripeInvoice({
    id: "in_1", billing_reason: "subscription_cycle", subscription: "sub_live",
    next_payment_attempt: null, attempt_count: 8,
  });
  assert.deepEqual(d, { send: true }, "a null retry time silenced the notice");
});

test("MISSING retry time still sends the first notice", () => {
  // The Revenue Recovery automations shape: the field is absent entirely.
  const d = decideFromStripeInvoice({
    id: "in_1", billing_reason: "subscription_cycle", subscription: "sub_live",
  });
  assert.deepEqual(d, { send: true }, "an absent retry time silenced the notice");
});

test("a high attempt count does not turn the first notice into silence", () => {
  const d = decideFromStripeInvoice({
    id: "in_1", billing_reason: "subscription_cycle", subscription: "sub_live", attempt_count: 8,
  });
  assert.deepEqual(d, { send: true });
});

test("the route does not forward a retry time into the first-failure decision", () => {
  const src = routeSource();
  const call = src.slice(src.indexOf("decideFirstFailureCustomerEmail({"));
  const args = call.slice(0, call.indexOf("})"));
  assert.ok(!args.includes("nextPaymentAttempt"), "the route reintroduced a retry input");
  assert.ok(!args.includes("now:"), "the route reintroduced a clock input");
});

// ── Suppression ────────────────────────────────────────────────────────────

test("a marketing unsubscribe does NOT suppress this transactional notice", () => {
  // There is deliberately no unsubscribe input on the decision at all: the only
  // suppression this module accepts is bounce/complaint/admin. If a future
  // change adds an unsubscribe gate, this test is where it must be argued.
  const keys = Object.keys(firstInput());
  assert.ok(!keys.some((k) => k.toLowerCase().includes("unsub")));
  assert.deepEqual(decideFirstFailureCustomerEmail(firstInput()), { send: true });
});

for (const reason of ["hard_bounce", "spam_complaint", "admin_suppress"] as const) {
  test(`${reason} suppresses the first-failure customer notice`, () => {
    assert.deepEqual(decideFirstFailureCustomerEmail(firstInput({ suppression: reason })), {
      send: false,
      reason,
    });
  });
  test(`${reason} suppresses the final customer notice`, () => {
    assert.deepEqual(decideFinalFailureCustomerEmail(finalInput({ suppression: reason })), {
      send: false,
      reason,
    });
  });
}

// ── Final failure ──────────────────────────────────────────────────────────

test("a confirmed termination with uncollected money sends the final notice", () => {
  assert.deepEqual(decideFinalFailureCustomerEmail(finalInput()), { send: true });
  assert.deepEqual(
    decideFinalFailureCustomerEmail(finalInput({ latestInvoiceStatus: "uncollectible" })),
    { send: true },
  );
});

test("the final notice REQUIRES positive termination evidence", () => {
  assert.deepEqual(decideFinalFailureCustomerEmail(finalInput({ terminationConfirmed: false })), {
    send: false,
    reason: "not_terminated",
  });
});

test("the final notice cannot be reached from attempt count or a null next attempt", () => {
  // Neither value exists on the final decision's input at all. Absence of a
  // retry is an absence, never proof, and this is the structural guarantee.
  const keys = Object.keys(finalInput());
  assert.ok(!keys.some((k) => k.toLowerCase().includes("attempt")));
  assert.ok(!keys.some((k) => k.toLowerCase().includes("elapsed")));
  // And an unterminated subscription stays silent no matter the invoice shape.
  assert.equal(
    decideFinalFailureCustomerEmail(finalInput({ terminationConfirmed: false, latestInvoiceStatus: "open" })).send,
    false,
  );
});

test("a family who paid their term out is never told their payment failed", () => {
  assert.deepEqual(decideFinalFailureCustomerEmail(finalInput({ paidThroughKind: "paid" })), {
    send: false,
    reason: "payment_was_collected",
  });
});

test("pending and unknown never send the final notice", () => {
  for (const kind of ["pending", "unknown"] as const) {
    assert.equal(decideFinalFailureCustomerEmail(finalInput({ paidThroughKind: kind })).send, false);
  }
});

test("a refunded paid invoice is not a dunning failure", () => {
  // classifyPaidThrough returns "unpaid" for a fully refunded PAID invoice too.
  // Telling that family their card was declined would be wrong.
  const d = decideFinalFailureCustomerEmail(finalInput({ paidThroughKind: "unpaid", latestInvoiceStatus: "paid" }));
  assert.deepEqual(d, { send: false, reason: "payment_was_collected" });
});

test("an unreadable invoice status never sends the final notice", () => {
  const d = decideFinalFailureCustomerEmail(finalInput({ latestInvoiceStatus: null }));
  assert.deepEqual(d, { send: false, reason: "payment_was_collected" });
});

test("the final notice still needs a linked profile and an address", () => {
  assert.deepEqual(decideFinalFailureCustomerEmail(finalInput({ profile: null })), {
    send: false,
    reason: "no_profile",
  });
  assert.deepEqual(decideFinalFailureCustomerEmail(finalInput({ profile: profile({ email: null }) })), {
    send: false,
    reason: "no_email",
  });
});

// ── Copy ───────────────────────────────────────────────────────────────────

test("first name is used, with friend as the fallback", () => {
  assert.equal(greetingName("Dana"), "Dana");
  assert.equal(greetingName(null), "friend");
  assert.equal(greetingName("   "), "friend");
  assert.ok(firstFailureBody({ firstName: null, billingUrl: "u" }).startsWith("Hi friend,"));
});

test("customer copy carries no em dash and no banned sign-off", () => {
  const banned = ["Cheering you on", "With love", "Warmly", "With gratitude"];
  const bodies = [
    firstFailureBody({ firstName: "Dana", billingUrl: "https://example.com/billing" }),
    finalFailureBody({ firstName: "Dana", upgradeUrl: "https://example.com/upgrade" }),
  ];
  for (const body of bodies) {
    assert.ok(!body.includes("—"), "em dash in customer copy");
    for (const phrase of banned) {
      assert.ok(!body.includes(phrase), `banned sign-off: ${phrase}`);
    }
  }
  assert.ok(bodies[0].trimEnd().endsWith("Thank you,\nBrittany"));
  assert.ok(bodies[1].trimEnd().endsWith("Thanks,\nBrittany"));
});

test("customer copy says the exact things Sol approved", () => {
  const first = firstFailureBody({ firstName: "Dana", billingUrl: "https://b" });
  assert.equal(FIRST_FAILURE_SUBJECT, "There was a problem with your Rooted+ payment");
  assert.ok(first.includes("Your Rooted+ access is still active"));
  assert.ok(first.includes("https://b"));

  const final = finalFailureBody({ firstName: "Dana", upgradeUrl: "https://u" });
  assert.equal(FINAL_FAILURE_SUBJECT, "Your Rooted+ subscription has ended");
  assert.ok(final.includes("Nothing in your account has been deleted"));
  assert.ok(final.includes("You can still sign in and use Rooted on the free plan"));
  assert.ok(final.includes("https://u"));
});

test("an unlinked admin notice is flagged and carries the Stripe identifiers", () => {
  const subject = adminNoticeSubject({ stage: "first", familyLabel: null, linked: false });
  assert.ok(subject.includes("UNLINKED"));
  const body = adminNoticeBody({
    stage: "first",
    familyLabel: null,
    userId: null,
    customerId: "cus_X",
    subscriptionId: "sub_X",
    invoiceId: "in_X",
    amountDue: "$39.00",
    attemptCount: 1,
    nextPaymentAttemptIso: null,
    customerEmailOutcome: "skipped (no_profile)",
  });
  assert.ok(body.includes("cus_X") && body.includes("in_X"));
  assert.ok(body.includes("NOT LINKED"));
  assert.ok(body.includes("no entitlement was inferred"));
});

test("the admin notice always records what happened to the customer email", () => {
  const body = adminNoticeBody({
    stage: "first",
    familyLabel: "The Smiths",
    userId: "user-1",
    customerId: "cus_X",
    subscriptionId: "sub_X",
    invoiceId: "in_X",
    amountDue: "$39.00",
    attemptCount: 2,
    nextPaymentAttemptIso: "2026-09-21T12:00:00.000Z",
    customerEmailOutcome: "skipped (hard_bounce)",
  });
  assert.ok(body.includes("Customer email: skipped (hard_bounce)"));
});

// ── Structural guarantees, swept from the route source ─────────────────────

function routeSource(): string {
  return fs.readFileSync(path.join(process.cwd(), "app/api/stripe/webhook/route.ts"), "utf8");
}

function paymentFailedBranch(src: string): string {
  const start = src.indexOf("if (event.type === 'invoice.payment_failed')");
  assert.ok(start > 0, "payment_failed branch not found");
  const end = src.indexOf("return NextResponse.json({ received: true })", start);
  assert.ok(end > start, "branch end not found");
  return src.slice(start, end);
}

test("ENTITLEMENT: the payment_failed branch never writes to profiles", () => {
  const branch = paymentFailedBranch(routeSource());
  assert.ok(!/\.from\(\s*['"]profiles['"]\s*\)[\s\S]*?\.update\(/.test(branch), "profiles update in the failure branch");
  assert.ok(!branch.includes("is_pro"), "is_pro referenced in the failure branch");
  assert.ok(!branch.includes("subscription_status"), "subscription_status referenced in the failure branch");
  assert.ok(!branch.includes("plan_type"), "plan_type referenced in the failure branch");
});

test("IDENTITY: the payment_failed branch never resolves a family by email or name", () => {
  const branch = paymentFailedBranch(routeSource());
  assert.ok(!branch.includes("findUserByEmail"), "email-based identity fallback");
  assert.ok(!branch.includes("display_name"), "display_name used for identity or greeting");
  assert.ok(!/customers\.retrieve/.test(branch), "Stripe customer email fetched for identity");
  assert.ok(branch.includes("loadLinkedProfile("), "deterministic lookup missing");
});

test("RECOVERY: no invoice.payment_succeeded handler was added", () => {
  // Recovery self-heals through customer.subscription.updated, which is already
  // enabled and rewrites the billing dates from proven paid evidence. Adding an
  // event purely for observability would have been scope we were told to avoid.
  const src = routeSource();
  assert.ok(!src.includes("invoice.payment_succeeded"), "an unnecessary event handler was added");
});

test("RECOVERY: subscription.updated still treats past_due as active", () => {
  // This is what keeps Rooted+ on during retries, and what heals the dates when
  // the retry succeeds. If it ever stops being true, the first-failure copy
  // ('Your Rooted+ access is still active') becomes a lie.
  const src = routeSource();
  assert.ok(/sub\.status === 'past_due'/.test(src), "past_due no longer counts as active");
  assert.ok(src.includes("resolveProvenPaidThrough"), "paid-through resolution missing from the link path");
});

test("the final notice is only reachable from the confirmed-termination path", () => {
  const src = routeSource();
  const branch = paymentFailedBranch(src);
  assert.ok(!branch.includes("finalFailureKey"), "final notice reachable from the failure event");
  assert.ok(!branch.includes("FINAL_FAILURE_SUBJECT"), "final copy reachable from the failure event");
  const deleted = src.slice(src.indexOf("if (event.type === 'customer.subscription.deleted')"));
  assert.ok(deleted.includes("terminationConfirmed: true"), "final notice not tied to the terminal path");
});

test("SUPPRESSION LIST: a marketing unsubscribe is not a transactional blocker", async () => {
  const { TRANSACTIONAL_BLOCKING_REASONS } = await import("./email/resend-suppression.ts");
  const reasons = [...TRANSACTIONAL_BLOCKING_REASONS] as string[];
  assert.ok(!reasons.includes("user_unsubscribe"), "unsubscribe would block a billing notice");
  assert.deepEqual(reasons.sort(), ["admin_suppress", "hard_bounce", "spam_complaint"]);
});

test("CLAIM RELEASE: the real delete is scoped to unconfirmed rows", () => {
  // The fake store in email-claim.test.ts models this predicate. This asserts
  // the production query actually carries it, because a release without it
  // could delete a confirmed row and re-open the key for a duplicate send.
  const src = routeSource();
  const release = src.slice(src.indexOf("async release(userId, emailType)"));
  const body = release.slice(0, release.indexOf("},"));
  assert.ok(body.includes(".delete()"), "release is not a delete");
  assert.ok(body.includes(".is('sent_at', null)"), "release is not scoped to unconfirmed rows");
});

test("CLAIM: only a unique violation counts as already-claimed", () => {
  // Treating any write failure as a duplicate would silently drop notices.
  const src = routeSource();
  const claim = src.slice(src.indexOf("async claim(userId, emailType)"));
  assert.ok(claim.slice(0, claim.indexOf("},")).includes("'23505'"), "duplicate detection is not code-scoped");
});

test("FirstFailureInput declares no retry, attempt or clock field", () => {
  // Object.keys() on a fixture only reflects the fixture, so an optional field
  // added to the TYPE would slip past it. This reads the declaration itself, so
  // the structural guarantee cannot be re-opened quietly even by a field that
  // nothing reads yet.
  const src = fs.readFileSync(path.join(process.cwd(), "lib/payment-failure.ts"), "utf8");
  const start = src.indexOf("export interface FirstFailureInput {");
  assert.ok(start > 0, "FirstFailureInput not found");
  const decl = src.slice(start, src.indexOf("\n}", start));
  const fields = decl
    .split("\n")
    .filter((line) => /^\s{2}\w+\??:/.test(line))
    .map((line) => line.trim().split(/\??:/)[0]);
  for (const field of fields) {
    const lower = field.toLowerCase();
    assert.ok(!lower.includes("attempt"), `retry field on FirstFailureInput: ${field}`);
    assert.ok(!lower.includes("retry"), `retry field on FirstFailureInput: ${field}`);
    assert.ok(field !== "now", "a clock is declared on FirstFailureInput");
  }
  assert.deepEqual(fields.sort(), ["billingReason", "invoiceId", "invoiceSubscriptionId", "profile", "suppression"]);
});
