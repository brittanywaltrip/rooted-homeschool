/**
 * Lazily built Stripe and Resend clients.
 *
 * Module-scope construction is what broke keyless builds. `new Stripe(undefined)`
 * throws, and a route module that throws while being imported fails `next build`
 * during page-data collection, so a single credential-less route took the whole
 * build down with it:
 *
 *   Error: Neither apiKey nor config.authenticator provided
 *   Error: Failed to collect page data for /api/account/delete
 *
 * rooted-staging carries no Stripe or Resend credential by design; it is not an
 * environment where billing or email is exercised. Building each client on first
 * use moves the failure to the request that actually needs the credential, which
 * is where it belongs, and lets requireApiKey name the missing variable.
 */

import Stripe from "stripe";
import { Resend } from "resend";
import { requireApiKey } from "./api-keys.ts";

/** The API version every Rooted route pins, except where a call site says otherwise. */
export const STRIPE_API_VERSION = "2026-02-25.clover";

/**
 * One client per API version. Two routes cannot be handed the same client when
 * they asked for different versions, so the cache is keyed rather than a single
 * slot.
 */
const stripeClients = new Map<string, Stripe>();

/**
 * @param apiVersion `null` keeps the Stripe account's own default version.
 *   Only /api/admin/affiliate-payouts wants that, and only because it has
 *   always had it. Pinning it here would change the shape of the charge and
 *   invoice objects its commission maths reads.
 */
export function stripeClient(
  apiVersion: typeof STRIPE_API_VERSION | null = STRIPE_API_VERSION,
): Stripe {
  const cacheKey = apiVersion ?? "account-default";
  const cached = stripeClients.get(cacheKey);
  if (cached) return cached;

  const secret = requireApiKey("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY);
  const client = apiVersion ? new Stripe(secret, { apiVersion }) : new Stripe(secret);
  stripeClients.set(cacheKey, client);
  return client;
}

let resend: Resend | null = null;

export function resendClient(): Resend {
  if (!resend) resend = new Resend(requireApiKey("RESEND_API_KEY", process.env.RESEND_API_KEY));
  return resend;
}
