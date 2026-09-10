// What kind of account and what kind of browser a Sentry event came from.
//
// Before 2026-09-09 no event carried a user id or said whether the account
// was a family, so every investigation started with a database lookup from
// the goal id in the message. These two helpers name the tags; the dashboard
// layout and the client Sentry config apply them.
//
// Pure: no Sentry import, so the tests run under node --test without a DSN.

import { isNonFamilyEmail } from "./queue-slot-health.ts";

/** Tag value for account_kind: the non-family list is the single source. */
export function accountKindTag(email: string | null | undefined): "test" | "family" {
  return isNonFamilyEmail(email) ? "test" : "family";
}

/** The Playwright suite runs HeadlessChrome; a family never does. */
export function isHeadlessUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && userAgent.includes("HeadlessChrome");
}
