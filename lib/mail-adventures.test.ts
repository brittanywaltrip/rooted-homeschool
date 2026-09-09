import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterListings,
  sortListings,
  availableCategories,
  availableStates,
  formatVerified,
  verifiedFooter,
  listingChips,
  nextProgress,
  memoryTitleFor,
  isListingVisible,
  REWARD_LABELS,
  CATEGORY_LABELS,
  type MailListing,
} from "./mail-adventures.ts";

function listing(over: Partial<MailListing> = {}): MailListing {
  return {
    id: over.slug ?? "id-1",
    slug: "a-listing",
    title: "Alabama Vacation Guide",
    organization: "Alabama Tourism Department",
    category: "50_states",
    state_region: "Alabama",
    delivery_type: "physical_mail",
    reward_type: null,
    is_earn_it: false,
    what_you_get: "Printed state vacation guide",
    how_to_get_it: "Submit mailing form",
    age_grade: "All ages",
    delivery_time: null,
    supply_caveat: null,
    is_rooted_pick: false,
    is_hidden_gem: false,
    last_verified: "2026-08-31",
    verification_status: "verified",
    official_url: "https://example.org",
    url_quality: "direct_order_page",
    is_active: true,
    sort_order: 1,
    ...over,
  };
}

// ── Chip filtering ──────────────────────────────────────────────────────────

test("a category chip returns only that category", () => {
  const rows = [
    listing({ slug: "s1", category: "50_states", state_region: "Alabama" }),
    listing({ slug: "p1", category: "national_parks", state_region: null }),
    listing({ slug: "f1", category: "agriculture", state_region: null }),
  ];
  const parks = filterListings({ listings: rows, filter: "national_parks" });
  assert.deepEqual(parks.map((l) => l.slug), ["p1"]);

  const farm = filterListings({ listings: rows, filter: "agriculture" });
  assert.deepEqual(farm.map((l) => l.slug), ["f1"]);
});

test("All returns every visible listing", () => {
  const rows = [
    listing({ slug: "s1" }),
    listing({ slug: "p1", category: "national_parks", state_region: null }),
  ];
  assert.equal(filterListings({ listings: rows, filter: "all" }).length, 2);
});

test("the flag chips select on their own flag", () => {
  const rows = [
    listing({ slug: "pick", is_rooted_pick: true }),
    listing({ slug: "gem", is_hidden_gem: true }),
    listing({ slug: "earn", is_earn_it: true }),
    listing({ slug: "plain" }),
  ];
  assert.deepEqual(
    filterListings({ listings: rows, filter: "rooted_picks" }).map((l) => l.slug),
    ["pick"]
  );
  assert.deepEqual(
    filterListings({ listings: rows, filter: "hidden_gems" }).map((l) => l.slug),
    ["gem"]
  );
  assert.deepEqual(
    filterListings({ listings: rows, filter: "earn_it" }).map((l) => l.slug),
    ["earn"]
  );
});

// ── The state filter only applies under 50 States ────────────────────────────

test("a state narrows the 50 States chip", () => {
  const rows = [
    listing({ slug: "al", state_region: "Alabama" }),
    listing({ slug: "or", state_region: "Oregon" }),
  ];
  const out = filterListings({ listings: rows, filter: "50_states", state: "Oregon" });
  assert.deepEqual(out.map((l) => l.slug), ["or"]);
});

test("a leftover state does not narrow All or another category", () => {
  // Every listing outside 50 States has a null state_region, so applying the
  // state here would empty the view instead of filtering it.
  const rows = [
    listing({ slug: "al", state_region: "Alabama" }),
    listing({ slug: "park", category: "national_parks", state_region: null }),
  ];
  assert.equal(filterListings({ listings: rows, filter: "all", state: "Oregon" }).length, 2);
  assert.equal(
    filterListings({ listings: rows, filter: "national_parks", state: "Oregon" }).length,
    1
  );
});

// ── Search ───────────────────────────────────────────────────────────────────

test("search matches title, organization and what_you_get, case-insensitively", () => {
  const rows = [
    listing({ slug: "t", title: "Junior Ranger Booklet", organization: "NPS", what_you_get: "A booklet" }),
    listing({ slug: "o", title: "Something", organization: "Smithsonian", what_you_get: "A poster" }),
    listing({ slug: "w", title: "Other", organization: "Other", what_you_get: "Free seed packet" }),
  ];
  assert.deepEqual(filterListings({ listings: rows, filter: "all", query: "RANGER" }).map((l) => l.slug), ["t"]);
  assert.deepEqual(filterListings({ listings: rows, filter: "all", query: "smithsonian" }).map((l) => l.slug), ["o"]);
  assert.deepEqual(filterListings({ listings: rows, filter: "all", query: "SEED packet" }).map((l) => l.slug), ["w"]);
});

test("an empty or whitespace search does not filter", () => {
  const rows = [listing({ slug: "a" }), listing({ slug: "b" })];
  assert.equal(filterListings({ listings: rows, filter: "all", query: "   " }).length, 2);
});

test("search combines with a chip rather than replacing it", () => {
  const rows = [
    listing({ slug: "s", category: "50_states", title: "Ranger Guide" }),
    listing({ slug: "p", category: "national_parks", state_region: null, title: "Ranger Booklet" }),
  ];
  const out = filterListings({ listings: rows, filter: "national_parks", query: "ranger" });
  assert.deepEqual(out.map((l) => l.slug), ["p"]);
});

// ── Sorting ──────────────────────────────────────────────────────────────────

test("Rooted Picks sort first, then sort_order, then title", () => {
  const rows = [
    listing({ slug: "plain-b", title: "B", is_rooted_pick: false, sort_order: 1 }),
    listing({ slug: "pick-late", title: "Z", is_rooted_pick: true, sort_order: 9 }),
    listing({ slug: "pick-early", title: "A", is_rooted_pick: true, sort_order: 2 }),
    listing({ slug: "plain-a", title: "A", is_rooted_pick: false, sort_order: 1 }),
  ];
  assert.deepEqual(
    sortListings(rows).map((l) => l.slug),
    ["pick-early", "pick-late", "plain-a", "plain-b"]
  );
});

test("a null sort_order sorts last, not first", () => {
  const rows = [
    listing({ slug: "none", sort_order: null, title: "A" }),
    listing({ slug: "ten", sort_order: 10, title: "B" }),
  ];
  assert.deepEqual(sortListings(rows).map((l) => l.slug), ["ten", "none"]);
});

// ── Visibility ───────────────────────────────────────────────────────────────

test("unavailable and inactive rows are excluded, needs_recheck is included", () => {
  const rows = [
    listing({ slug: "ok", verification_status: "verified" }),
    listing({ slug: "recheck", verification_status: "needs_recheck" }),
    listing({ slug: "gone", verification_status: "unavailable" }),
    listing({ slug: "off", is_active: false }),
  ];
  assert.deepEqual(
    filterListings({ listings: rows, filter: "all" }).map((l) => l.slug).sort(),
    ["ok", "recheck"]
  );
  assert.equal(isListingVisible(rows[2]), false);
  assert.equal(isListingVisible(rows[3]), false);
});

test("a hidden row never reaches the chips or the state picker", () => {
  const rows = [
    listing({ slug: "gone", category: "science_space", state_region: null, verification_status: "unavailable" }),
    listing({ slug: "hidden-state", state_region: "Ohio", is_active: false }),
    listing({ slug: "ok", state_region: "Alabama" }),
  ];
  assert.deepEqual(availableCategories(rows), ["50_states"]);
  assert.deepEqual(availableStates(rows), ["Alabama"]);
});

// ── Chips derived from data ──────────────────────────────────────────────────

test("only categories with a listing get a chip, in the fixed order", () => {
  const rows = [
    listing({ slug: "f", category: "agriculture", state_region: null }),
    listing({ slug: "p", category: "national_parks", state_region: null }),
    listing({ slug: "s", category: "50_states" }),
  ];
  assert.deepEqual(availableCategories(rows), ["50_states", "national_parks", "agriculture"]);
});

test("Farm & Food is the label for the agriculture category", () => {
  assert.equal(CATEGORY_LABELS.agriculture, "Farm & Food");
});

// ── Reward labels ────────────────────────────────────────────────────────────

test("a sticker renders Sticker and never Badge", () => {
  assert.equal(REWARD_LABELS.sticker, "Sticker");
  assert.notEqual(REWARD_LABELS.sticker, "Badge");
  assert.equal(REWARD_LABELS.paper_badge, "Paper badge");
  const chips = listingChips(listing({ reward_type: "sticker", age_grade: null }));
  assert.ok(chips.includes("Sticker"));
  assert.ok(!chips.includes("Badge"));
});

test("card chips appear in order and skip unset fields", () => {
  const full = listingChips(
    listing({ delivery_type: "physical_and_printable", reward_type: "patch", age_grade: "Ages 5-12", delivery_time: "2-3 weeks" })
  );
  assert.deepEqual(full, ["By mail or printable", "Patch", "Ages 5-12", "2-3 weeks"]);

  const bare = listingChips(listing({ reward_type: null, age_grade: null, delivery_time: null }));
  assert.deepEqual(bare, ["By mail"]);
});

// ── Dates ────────────────────────────────────────────────────────────────────

test("the verified date does not slip a day in a western timezone", () => {
  assert.equal(formatVerified("2026-08-31"), "Aug 31, 2026");
  assert.equal(formatVerified("2026-01-01"), "Jan 1, 2026");
  assert.equal(formatVerified("2026-12-25"), "Dec 25, 2026");
});

test("a needs_recheck footer says it is being re-verified", () => {
  assert.equal(verifiedFooter(listing({ verification_status: "verified" })), "Verified Aug 31, 2026");
  assert.equal(
    verifiedFooter(listing({ verification_status: "needs_recheck" })),
    "Last checked Aug 31, 2026, being re-verified"
  );
});

// ── The toggles ──────────────────────────────────────────────────────────────

const NOW = "2026-09-08T12:00:00.000Z";

test("tapping Requested sets it, tapping again clears both", () => {
  const on = nextProgress(undefined, "requested", NOW);
  assert.equal(on.requested_at, NOW);
  assert.equal(on.received_at, null);

  const off = nextProgress({ listing_id: "x", requested_at: NOW, received_at: null }, "requested", NOW);
  assert.equal(off.requested_at, null);
});

test("Received implies Requested", () => {
  const out = nextProgress(undefined, "received", NOW);
  assert.equal(out.received_at, NOW);
  assert.equal(out.requested_at, NOW, "marking Received must also mark Requested");
});

test("clearing Requested also clears Received so the pair cannot contradict", () => {
  const both = { listing_id: "x", requested_at: NOW, received_at: NOW };
  const out = nextProgress(both, "requested", NOW);
  assert.equal(out.requested_at, null);
  assert.equal(out.received_at, null);
});

test("clearing Received keeps Requested", () => {
  const both = { listing_id: "x", requested_at: "2026-09-01T00:00:00.000Z", received_at: NOW };
  const out = nextProgress(both, "received", NOW);
  assert.equal(out.received_at, null);
  assert.equal(out.requested_at, "2026-09-01T00:00:00.000Z");
});

test("marking Received keeps the original Requested timestamp", () => {
  const earlier = { listing_id: "x", requested_at: "2026-09-01T00:00:00.000Z", received_at: null };
  const out = nextProgress(earlier, "received", NOW);
  assert.equal(out.requested_at, "2026-09-01T00:00:00.000Z");
  assert.equal(out.received_at, NOW);
});

// ── The prefilled memory title ───────────────────────────────────────────────

test("the memory title names the listing and the organization", () => {
  assert.equal(
    memoryTitleFor({ title: "Junior Ranger Booklet", organization: "National Park Service" }),
    "Junior Ranger Booklet arrived from National Park Service"
  );
});

test("an over-long title is dropped rather than cut mid-word", () => {
  assert.equal(memoryTitleFor({ title: "x".repeat(200), organization: "Y" }), "");
});
