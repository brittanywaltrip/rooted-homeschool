// ─── Billing is OFF outside production, and it says so ──────────────────────
//
// Two things this exists to prevent.
//
// 1. A staging deployment reaching live Stripe. Removing STRIPE_SECRET_KEY is
//    NOT sufficient on its own and is actively unsafe: every billing route
//    built its Stripe client at MODULE SCOPE, and `new Stripe(undefined)`
//    throws "Neither apiKey nor config.authenticator provided". That turns a
//    missing credential into a route-load crash rather than a refusal. The
//    routes now build the client lazily, AFTER this guard has had its say.
//
// 2. A guard on one entry point while another stays live. There are five
//    user-reachable billing entry points, not one:
//      POST /api/create-checkout-session   subscription checkout
//      POST /api/stripe/checkout           subscription checkout (second path)
//      POST /api/stripe/portal             billing portal
//      POST /api/gift                      gift purchase
//      POST /api/family/gift               gift purchase from the family view
//    Guarding only the first would leave four live fallbacks.
//
// Not guarded, deliberately, and why:
//   /api/stripe/webhook            inbound from Stripe. rooted-staging has no
//                                  Stripe endpoint pointed at it, and refusing
//                                  a real production webhook would be harmful.
//   /api/cron/*, /api/admin/*      reachable only with CRON_SECRET or an admin
//                                  session; not a customer-facing purchase path.
//   scripts/*                      run by hand with explicit credentials.

/** Just the slice of env this module reads, so tests need no ProcessEnv cast. */
export type BillingEnv = Record<string, string | undefined>;

/** Reads as disabled unless explicitly enabled. Fail closed. */
export function isBillingDisabled(env: BillingEnv = process.env): boolean {
  if (env.STRIPE_CHECKOUT_DISABLED === "true") return true;
  // No key means no billing, and saying so beats throwing on import.
  if (!env.STRIPE_SECRET_KEY) return true;
  return false;
}

/** Why it is off, for a log line. Never shown to a customer verbatim. */
export function billingDisabledReason(env: BillingEnv = process.env): string {
  if (env.STRIPE_CHECKOUT_DISABLED === "true") return "STRIPE_CHECKOUT_DISABLED=true";
  if (!env.STRIPE_SECRET_KEY) return "STRIPE_SECRET_KEY is not set";
  return "billing is enabled";
}

/**
 * The body every guarded route returns. 503, not 500: this is a deliberate,
 * temporary refusal by configuration, not a failure.
 */
export function billingDisabledPayload(env: BillingEnv = process.env): {
  error: string;
  billingDisabled: true;
  env: string | null;
} {
  return {
    error: "Billing is disabled in this environment.",
    billingDisabled: true,
    env: env.ROOTED_ENV ?? null,
  };
}
