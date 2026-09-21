// The billing guard, and the two failure modes it exists to prevent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isBillingDisabled, billingDisabledReason, billingDisabledPayload } from "./billing-guard.ts";

const REPO = resolve(import.meta.dirname, "..");

/** Every user-reachable billing entry point. Guarding one and missing the
 *  others is the failure this list exists to prevent. */
const GUARDED_ROUTES = [
  "app/api/create-checkout-session/route.ts",
  "app/api/stripe/checkout/route.ts",
  "app/api/stripe/portal/route.ts",
  "app/api/gift/route.ts",
  "app/api/family/gift/route.ts",
];

test("fails closed: no key means disabled", () => {
  assert.equal(isBillingDisabled({}), true);
  assert.equal(isBillingDisabled({ STRIPE_SECRET_KEY: "" }), true);
  assert.match(billingDisabledReason({}), /not set/);
});

test("the explicit flag wins even when a key is present", () => {
  const env = { STRIPE_SECRET_KEY: "sk_live_x", STRIPE_CHECKOUT_DISABLED: "true" };
  assert.equal(isBillingDisabled(env), true);
  assert.match(billingDisabledReason(env), /STRIPE_CHECKOUT_DISABLED/);
});

test("enabled only with a key and no disable flag", () => {
  assert.equal(isBillingDisabled({ STRIPE_SECRET_KEY: "sk_live_x" }), false);
  // Anything other than the exact string "true" does not disable.
  assert.equal(isBillingDisabled({ STRIPE_SECRET_KEY: "sk_x", STRIPE_CHECKOUT_DISABLED: "false" }), false);
});

test("the payload says refused, and leaks no key material", () => {
  const p = billingDisabledPayload({ ROOTED_ENV: "staging", STRIPE_SECRET_KEY: "sk_live_SECRET" });
  assert.equal(p.billingDisabled, true);
  assert.equal(p.env, "staging");
  assert.ok(!JSON.stringify(p).includes("sk_live"));
});

test("no billing route constructs Stripe at module scope", () => {
  // `new Stripe(undefined)` THROWS. A module-scope client turns a removed
  // credential into a route-load crash instead of the 503 above.
  for (const rel of GUARDED_ROUTES) {
    const src = readFileSync(resolve(REPO, rel), "utf8");
    assert.ok(
      !/^const stripe = new Stripe\(/m.test(src),
      `${rel} still builds its Stripe client at module scope`,
    );
    // The lazy client used to be a copy of the same six lines in each of these
    // five routes. PR #78 replaced every copy with one shared implementation in
    // lib/api-clients.ts, which also names the missing variable rather than
    // letting the SDK complain. What must never come back is construction at
    // IMPORT, and that is what the assertion above pins. This one only checks
    // the route gets its client from something lazy, by either route.
    //
    // lib/api-keys.test.ts enforces the general rule across every file under
    // app/api with a brace-depth scanner; this stays as the billing-specific
    // statement of the same invariant.
    assert.ok(
      /from ["']@\/lib\/api-clients["']/.test(src) || /function stripeClient\(\)/.test(src),
      `${rel} does not obtain its Stripe client lazily`,
    );
  }
});

test("the guard is the FIRST statement of every guarded handler", () => {
  for (const rel of GUARDED_ROUTES) {
    const src = readFileSync(resolve(REPO, rel), "utf8");
    assert.ok(/isBillingDisabled\(\)/.test(src), `${rel} does not call the guard`);
    const handler = src.slice(src.indexOf("export async function POST"));
    const guardAt = handler.indexOf("isBillingDisabled()");
    const stripeAt = handler.indexOf("stripeClient()");
    assert.ok(guardAt > -1, `${rel}: no guard in the handler`);
    if (stripeAt > -1) {
      assert.ok(guardAt < stripeAt, `${rel}: Stripe is touched before the guard runs`);
    }
  }
});

test("the webhook is deliberately NOT guarded", () => {
  const src = readFileSync(resolve(REPO, "app/api/stripe/webhook/route.ts"), "utf8");
  assert.ok(!/isBillingDisabled/.test(src),
    "refusing a real production webhook would be harmful; it must stay unguarded");
});

// ─── Production fidelity ────────────────────────────────────────────────────
//
// The whole risk of this change is that a guard meant for staging quietly
// disables billing for real customers. These model the two environments as
// they will actually be configured and assert the outcomes are opposite.

/** Vercel Production today: a live key, and no disable flag anywhere. */
const PRODUCTION_ENV: Record<string, string | undefined> = {
  ROOTED_ENV: "production",
  STRIPE_SECRET_KEY: "sk_live_REDACTED",
  STRIPE_WEBHOOK_SECRET: "whsec_REDACTED",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_REDACTED",
  STRIPE_FOUNDING_FAMILY_PRICE_ID: "price_1TCVWDLP14EaoUlTNwZFGS8A",
  STRIPE_STANDARD_PRICE_ID: "price_1TCVWgLP14EaoUlT25totKGW",
  STRIPE_MONTHLY_PRICE_ID: "price_1Tqk81LP14EaoUlTBLucUTSD",
  // STRIPE_CHECKOUT_DISABLED is deliberately absent: it is Preview-scoped.
};

/** Vercel Preview after the proposed change: inert placeholder + the flag. */
const PREVIEW_ENV: Record<string, string | undefined> = {
  ROOTED_ENV: "staging",
  STRIPE_SECRET_KEY: "sk_test_staging_disabled_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_staging_unused_placeholder",
  STRIPE_CHECKOUT_DISABLED: "true",
};

test("production keeps billing ENABLED, preview disables it", () => {
  assert.equal(isBillingDisabled(PRODUCTION_ENV), false,
    "the guard must never disable billing for real customers");
  assert.equal(billingDisabledReason(PRODUCTION_ENV), "billing is enabled");
  assert.equal(isBillingDisabled(PREVIEW_ENV), true);
  assert.match(billingDisabledReason(PREVIEW_ENV), /STRIPE_CHECKOUT_DISABLED/);
});

test("the Preview flag cannot leak into production and disable it", () => {
  // Only the exact string "true" disables. A stray value, an empty string or
  // the flag being unset all leave production alone.
  for (const stray of [undefined, "", "false", "TRUE", "1", "yes", "0"]) {
    const env = { ...PRODUCTION_ENV, STRIPE_CHECKOUT_DISABLED: stray };
    assert.equal(isBillingDisabled(env), false,
      `STRIPE_CHECKOUT_DISABLED=${String(stray)} must not disable production`);
  }
  // And the one value that does disable, does so only when deliberately set.
  assert.equal(isBillingDisabled({ ...PRODUCTION_ENV, STRIPE_CHECKOUT_DISABLED: "true" }), true);
});

test("the guard is the ONLY behaviour change: production paths are intact", () => {
  // Each guarded route must still perform the same Stripe operation it did
  // before. A guard that also removed the happy path would pass every test
  // above and still break checkout.
  const calls: Record<string, RegExp> = {
    "app/api/create-checkout-session/route.ts": /stripeClient\(\)\.checkout\.sessions\.create/,
    "app/api/stripe/checkout/route.ts": /stripeClient\(\)\.checkout\.sessions\.create/,
    "app/api/stripe/portal/route.ts": /stripeClient\(\)\.billingPortal\.sessions\.create/,
    "app/api/gift/route.ts": /stripeClient\(\)\.checkout\.sessions\.create/,
    "app/api/family/gift/route.ts": /stripeClient\(\)\.checkout\.sessions\.create/,
  };
  for (const [rel, probe] of Object.entries(calls)) {
    const src = readFileSync(resolve(REPO, rel), "utf8");
    assert.ok(probe.test(src), `${rel} no longer performs its Stripe call`);
  }
});
