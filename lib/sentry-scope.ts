// What kind of account and what kind of browser a Sentry event came from.
//
// Before 2026-09-09 no event carried a user id or said whether the account
// was a family, so every investigation started with a database lookup from
// the goal id in the message. These helpers name the tags; the dashboard
// layout and the client Sentry config apply them.
//
// The account test runs in the browser, and the non-family list in
// lib/queue-slot-health.ts must NOT be imported here: the dashboard layout is
// a client component, so anything it imports is served to every signed-in
// family, and that list names the e2e mailbox and two personal addresses.
// Ship SHA-256 digests instead. lib/sentry-scope.test.ts derives them from
// the real list and fails when the two drift.
//
// Pure: no Sentry import, so the tests run under node --test without a DSN.

/** sha256(email), lower-cased and trimmed, for each entry in NON_FAMILY_EMAILS. */
export const NON_FAMILY_EMAIL_DIGESTS: readonly string[] = [
  "de455b72ea112766edcb8165d398b492b7ab8e7e2a7ac29853eb0add3fcbae14",
  "baab7350be8bd33c4135ccbec1dc2c30d68bed1c717c1a8e5b23056f50514b45",
  "b79f03ce6d6fd857f13df4d4b0b5fc0a29d0bda6e09b8d7ac365ecf6255625c7",
  "d5407fe1c461fe8e1ce94fa866fac709699eb13e8a16f122db0aa2a6074aa61b",
];

/** Hex SHA-256 of the normalised email, via Web Crypto (browser and Node 20+). */
export async function emailDigest(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tag value for account_kind. Same answer as isNonFamilyEmail, without the list. */
export async function accountKindTag(email: string | null | undefined): Promise<"test" | "family"> {
  if (!email) return "family";
  return NON_FAMILY_EMAIL_DIGESTS.includes(await emailDigest(email)) ? "test" : "family";
}

/** The Playwright suite runs HeadlessChrome; a family never does. */
export function isHeadlessUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && userAgent.includes("HeadlessChrome");
}
