// Centralized exclusion list for the founder dashboard.
//
// Every tile that counts "real families" must reuse these helpers so
// that test accounts, founder/whitelist accounts, comped partners, and
// incomplete signups are filtered consistently. Add new test accounts
// here — never inline them on a single tile.
//
// The four classes of exclusion:
//   1. TEST_EMAILS_EXACT / TEST_EMAIL_PATTERNS — accounts created for
//      QA, demos, or burner Gmail addresses. Hardcoded by email.
//   2. WHITELIST_UUIDS — Brittany, Chris, Sarah Parker. These are
//      real auth.users rows but they're founder/internal accounts
//      and they distort every metric (paying counts, conversion,
//      activity). Hardcoded by user UUID.
//   3. Affiliate user_ids — comped partners on the Founding plan.
//      Pulled dynamically from the affiliates table where
//      user_id IS NOT NULL. They subscribe via 100%-off coupon, so
//      Stripe shows them as active but they pay $0 — must be removed
//      from "paying customers" but kept in "comped partners".
//   4. Incomplete signups — auth.users rows with no matching profiles
//      row (Google OAuth bug victims). They never finished onboarding,
//      so counting them as families inflates everything.

export const TEST_EMAIL_PATTERNS = ["rooted.", "test", "finalpass", "mobiletest", "finaltest"];
export const TEST_EMAILS_EXACT = [
  "garfieldbrittany@gmail.com",
  "zoereywaltrip@gmail.com",
  "brittanywaltrip20@gmail.com",
  "het787@gmail.com",
  "wovapi4416@lxbeta.com",
];

// Founder / internal accounts. Real signups, but we don't want them
// counted in any KPI tile.
export const WHITELIST_UUIDS = [
  "d18ca881-a776-4e82-b145-832adc88a88a", // Brittany
  "b21d333a-17ec-4fd7-b1a6-00878f5894f5", // Chris
  "a182a9bc-e4dd-4523-a85b-0f7718be026b", // Sarah Parker test
];

export function isTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (TEST_EMAILS_EXACT.includes(lower)) return true;
  return TEST_EMAIL_PATTERNS.some(p => lower.includes(p));
}

export interface ExclusionInput {
  authUsers: { id: string; email: string | null }[];
  profileIds: Iterable<string>;
  affiliateUserIds: Iterable<string>;
}

export interface Exclusions {
  // Sets are by user_id (UUID).
  testIds: Set<string>;
  whitelistIds: Set<string>;
  affiliateIds: Set<string>;
  incompleteSignupIds: Set<string>;
  // Union of test + whitelist + incomplete. Use this for "real families",
  // signup counts, activity counts — anything where we want only genuine
  // families. Affiliates are NOT in this set: they're counted separately
  // under the Comped Partners tile.
  excludedFromRealFamilies: Set<string>;
  // Union of test + whitelist + affiliates. Use this for "paying
  // customers" — anyone who shouldn't count as a real paying sub.
  // Incomplete signups are NOT in this set because they wouldn't have a
  // paid plan anyway, but it's harmless either way.
  excludedFromPaying: Set<string>;
  // Per-bucket counts. These overlap (a user can be both a test
  // account and an incomplete signup), so DO NOT sum them — use
  // realFamiliesHiddenCount for any "X accounts hidden" sublabel.
  testAccountsHidden: number;
  whitelistedHidden: number;
  incompleteSignupsHidden: number;
  // Single source of truth for "how many auth users are hidden from
  // Real Families" — equals excludedFromRealFamilies.size, so the
  // dashboard math reconciles: totalUsers − realFamiliesHiddenCount
  // = realFamiliesCount.
  realFamiliesHiddenCount: number;
}

export function buildExclusions({ authUsers, profileIds, affiliateUserIds }: ExclusionInput): Exclusions {
  const profileIdSet = new Set(profileIds);
  const affiliateIds = new Set([...affiliateUserIds].filter((id): id is string => Boolean(id)));
  const whitelistIds = new Set(WHITELIST_UUIDS);

  const testIds = new Set<string>();
  const incompleteSignupIds = new Set<string>();

  for (const u of authUsers) {
    if (isTestEmail(u.email)) testIds.add(u.id);
    if (!profileIdSet.has(u.id)) incompleteSignupIds.add(u.id);
  }

  const excludedFromRealFamilies = new Set<string>([...testIds, ...whitelistIds, ...incompleteSignupIds]);
  const excludedFromPaying = new Set<string>([...testIds, ...whitelistIds, ...affiliateIds]);

  return {
    testIds,
    whitelistIds,
    affiliateIds,
    incompleteSignupIds,
    excludedFromRealFamilies,
    excludedFromPaying,
    testAccountsHidden: testIds.size,
    whitelistedHidden: whitelistIds.size,
    incompleteSignupsHidden: incompleteSignupIds.size,
    realFamiliesHiddenCount: excludedFromRealFamilies.size,
  };
}
