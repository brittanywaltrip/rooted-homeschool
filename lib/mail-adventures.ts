/**
 * Mail Adventures: filter, sort and label logic.
 *
 * Pure functions only, and deliberately free of any "@/" import at module
 * scope. `node --test` runs this file with type stripping, not compilation, so
 * a path alias here would fail at run time rather than at build time. Keep the
 * types local and the dependencies at zero.
 */

export type MailCategory =
  | "50_states"
  | "national_parks"
  | "science_space"
  | "nature_wildlife"
  | "history_government"
  | "agriculture"
  | "money_business"
  | "around_the_world"
  | "just_for_fun";

export type DeliveryType =
  | "physical_mail"
  | "printable"
  | "physical_and_printable"
  | "local_loan";

export type RewardType = "badge" | "patch" | "sticker" | "paper_badge" | "certificate";

export type VerificationStatus = "verified" | "needs_recheck" | "unavailable";

export type UrlQuality = "direct_order_page" | "general_page" | "likely_wrong_page";

export type MailListing = {
  id: string;
  slug: string;
  title: string;
  organization: string;
  category: MailCategory;
  state_region: string | null;
  delivery_type: DeliveryType;
  reward_type: RewardType | null;
  is_earn_it: boolean;
  what_you_get: string;
  how_to_get_it: string | null;
  age_grade: string | null;
  delivery_time: string | null;
  supply_caveat: string | null;
  is_rooted_pick: boolean;
  is_hidden_gem: boolean;
  last_verified: string;
  verification_status: VerificationStatus;
  official_url: string;
  url_quality: UrlQuality;
  is_active: boolean;
  sort_order: number | null;
};

/** A family's Requested / Received marks for one listing. */
export type MailProgress = {
  listing_id: string;
  requested_at: string | null;
  received_at: string | null;
};

/**
 * Chip ids. The three flag chips come first, then the categories.
 * "all" is the default and clears everything but the search box.
 */
export type FilterId = "all" | "rooted_picks" | "hidden_gems" | "earn_it" | MailCategory;

/**
 * Category order and copy. Plain labels, no jargon: a parent scanning this on a
 * phone should know what is behind a chip without opening it.
 *
 * 'agriculture' is the database value; "Farm & Food" is what it is called on
 * screen. The two are intentionally different and the mapping lives only here.
 */
export const CATEGORY_ORDER: MailCategory[] = [
  "50_states",
  "national_parks",
  "science_space",
  "nature_wildlife",
  "history_government",
  "agriculture",
  "money_business",
  "around_the_world",
  "just_for_fun",
];

export const CATEGORY_LABELS: Record<MailCategory, string> = {
  "50_states": "50 States",
  national_parks: "National Parks",
  science_space: "Science & Space",
  nature_wildlife: "Nature & Wildlife",
  history_government: "History & Government",
  agriculture: "Farm & Food",
  money_business: "Money & Business",
  around_the_world: "Around the World",
  just_for_fun: "Just for Fun",
};

export const DELIVERY_LABELS: Record<DeliveryType, string> = {
  physical_mail: "By mail",
  printable: "Printable",
  physical_and_printable: "By mail or printable",
  local_loan: "Local loan",
};

/**
 * What the child actually receives.
 *
 * A sticker renders "Sticker" and never "Badge". Several National Park Service
 * programs mail an envelope but send a sticker or a paper badge in place of the
 * real wooden badge, and a child promised a badge who opens a sticker has been
 * told something untrue by this app. The database keeps reward_type separate
 * from delivery_type for exactly this reason; the column comment says so.
 */
export const REWARD_LABELS: Record<RewardType, string> = {
  badge: "Badge",
  patch: "Patch",
  sticker: "Sticker",
  paper_badge: "Paper badge",
  certificate: "Certificate",
};

export const REPORT_REASONS: { value: string; label: string }[] = [
  { value: "link_broken", label: "Link is broken" },
  { value: "no_longer_free", label: "No longer free" },
  { value: "never_arrived", label: "Never arrived" },
  { value: "different_reward", label: "Different reward than described" },
  { value: "not_as_described", label: "Not as described" },
  { value: "other", label: "Something else" },
];

/** The longest prefilled memory title the capture sheet will accept. */
export const MAX_PREFILL_TITLE = 120;

/**
 * A listing a family is allowed to see.
 *
 * 'unavailable' is the only status that hides a row, and only Brittany or a
 * family report ever sets it. The link checker's "blocked" result must never
 * reach this function: government and tourism sites routinely refuse automated
 * requests while working perfectly in a browser, so hiding on that signal would
 * quietly delete working listings.
 */
export function isListingVisible(l: MailListing): boolean {
  return l.is_active && (l.verification_status === "verified" || l.verification_status === "needs_recheck");
}

/**
 * Rooted Picks first, then sort_order, then title.
 *
 * A null sort_order sorts last rather than first, which is what a missing value
 * should mean here. Comparing null numerically would have made it a zero and
 * floated unsorted rows to the top of every category.
 */
export function compareListings(a: MailListing, b: MailListing): number {
  if (a.is_rooted_pick !== b.is_rooted_pick) return a.is_rooted_pick ? -1 : 1;
  const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.title.localeCompare(b.title);
}

export function sortListings(listings: MailListing[]): MailListing[] {
  return [...listings].sort(compareListings);
}

/** Case-insensitive match over title, organization and what_you_get. */
export function matchesSearch(l: MailListing, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    l.title.toLowerCase().includes(q) ||
    l.organization.toLowerCase().includes(q) ||
    l.what_you_get.toLowerCase().includes(q)
  );
}

export function matchesFilter(l: MailListing, filter: FilterId): boolean {
  switch (filter) {
    case "all":
      return true;
    case "rooted_picks":
      return l.is_rooted_pick;
    case "hidden_gems":
      return l.is_hidden_gem;
    case "earn_it":
      return l.is_earn_it;
    default:
      return l.category === filter;
  }
}

/**
 * The one filtering entry point the page uses.
 *
 * The state picker only narrows under the 50 States chip. Carrying a state into
 * "All" or "National Parks" would silently empty those views, because every
 * listing outside 50 States has a null state_region.
 */
export function filterListings(args: {
  listings: MailListing[];
  filter: FilterId;
  state?: string | null;
  query?: string;
}): MailListing[] {
  const { listings, filter } = args;
  const state = args.state ?? null;
  const query = args.query ?? "";
  const stateApplies = filter === "50_states" && !!state;

  return sortListings(
    listings.filter((l) => {
      if (!isListingVisible(l)) return false;
      if (!matchesFilter(l, filter)) return false;
      if (stateApplies && l.state_region !== state) return false;
      return matchesSearch(l, query);
    })
  );
}

/**
 * Categories that actually have a visible listing, in CATEGORY_ORDER.
 *
 * Derived from the data rather than hardcoded to the full nine. Three of the
 * nine categories (Money & Business, Around the World, Just for Fun) have no
 * listings yet, and a chip that can only ever say "nothing here" is a dead end
 * on a phone. When the first listing in one of them ships, its chip appears on
 * its own with no code change.
 */
export function availableCategories(listings: MailListing[]): MailCategory[] {
  const present = new Set(listings.filter(isListingVisible).map((l) => l.category));
  return CATEGORY_ORDER.filter((c) => present.has(c));
}

/** States that actually have a visible listing, alphabetically. */
export function availableStates(listings: MailListing[]): string[] {
  const seen = new Set<string>();
  for (const l of listings) {
    if (!isListingVisible(l)) continue;
    if (l.category !== "50_states") continue;
    if (l.state_region) seen.add(l.state_region);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-08-31" becomes "Aug 31, 2026".
 *
 * Parsed by hand from the date parts. `new Date("2026-08-31")` is read as UTC
 * midnight and then rendered in the family's local zone, which prints the day
 * before across the Americas. A verified date that reads a day early makes the
 * whole footer look careless.
 */
export function formatVerified(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return isoDate;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/**
 * The footer line. A listing being re-verified says so plainly instead of
 * presenting a stale date as a fresh check.
 */
export function verifiedFooter(l: MailListing): string {
  const when = formatVerified(l.last_verified);
  return l.verification_status === "needs_recheck"
    ? `Last checked ${when}, being re-verified`
    : `Verified ${when}`;
}

/** The chips under the organization line, in display order. */
export function listingChips(l: MailListing): string[] {
  const chips = [DELIVERY_LABELS[l.delivery_type]];
  if (l.reward_type) chips.push(REWARD_LABELS[l.reward_type]);
  if (l.age_grade) chips.push(l.age_grade);
  if (l.delivery_time) chips.push(l.delivery_time);
  return chips.filter(Boolean);
}

export function isRequested(p: MailProgress | undefined): boolean {
  return !!p?.requested_at;
}

export function isReceived(p: MailProgress | undefined): boolean {
  return !!p?.received_at;
}

/**
 * What one tap of a toggle should write.
 *
 * Received implies Requested: a family that skipped the Requested tap and marked
 * the envelope when it landed still asked for it at some point, and a card
 * showing Received without Requested reads like a bug. Clearing Requested also
 * clears Received for the same reason, so the pair can never contradict itself.
 */
export function nextProgress(
  current: MailProgress | undefined,
  mark: "requested" | "received",
  nowIso: string
): { requested_at: string | null; received_at: string | null } {
  const requested = current?.requested_at ?? null;
  const received = current?.received_at ?? null;

  if (mark === "requested") {
    if (requested) return { requested_at: null, received_at: null };
    return { requested_at: nowIso, received_at: received };
  }

  if (received) return { requested_at: requested, received_at: null };
  return { requested_at: requested ?? nowIso, received_at: nowIso };
}

/**
 * The memory title offered when a package arrives. Over-long titles are dropped
 * rather than truncated mid-word: the parent can type their own, and a title cut
 * to "Grand Canyon Junior Ranger arrived fr" helps nobody.
 */
export function memoryTitleFor(l: Pick<MailListing, "title" | "organization">): string {
  const title = `${l.title} arrived from ${l.organization}`;
  return title.length > MAX_PREFILL_TITLE ? "" : title;
}
