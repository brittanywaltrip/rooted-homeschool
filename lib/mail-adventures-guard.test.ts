// Source-level guards for Mail Adventures.
//
// These sweep the source rather than exercise behaviour, for the same reason
// lib/memory-insert-guard.test.ts does: the rules below are broken by editing a
// call site nobody looked at, and this repo has no React or DOM test tooling to
// catch that any other way. The behavioural logic is unit tested next door in
// lib/mail-adventures.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(resolve(REPO, p), "utf8");

const MAIL_PAGE = "app/dashboard/resources/mail-adventures/page.tsx";
const RESOURCES_PAGE = "app/dashboard/resources/page.tsx";
const DASHBOARD_PAGE = "app/dashboard/page.tsx";
const REPORT_SHEET = "components/ResourceReportSheet.tsx";
const CRON = "app/api/cron/check-links/route.ts";

// ── THE PRIVACY RULE ─────────────────────────────────────────────────────────
//
// Nothing in Mail Adventures may store, ask for, or autofill a mailing address.
// Families type their address into the organization's own form, on the
// organization's own site. This is not a preference: an address field here
// would change Rooted's App Store data disclosure and its breach exposure, and
// the migration that created these tables says so in a comment marked "do not
// remove".
//
// The check is deliberately blunt. It looks at every input, textarea and select
// on the page and fails if any name, id or placeholder mentions an address
// part, so the guard trips on the first draft of such a field rather than after
// it ships.

const ADDRESS_WORDS = ["address", "street", "city", "zip", "postal", "state_line1", "addr"];

test("no field on the Mail Adventures page asks for any part of an address", () => {
  const src = read(MAIL_PAGE);
  const fields = src.match(/<(input|textarea|select)\b[^>]*>/g) ?? [];
  assert.ok(fields.length > 0, "expected the page to render at least one field");

  for (const field of fields) {
    const attrs = field.match(/\b(name|id|placeholder|aria-label)\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/g) ?? [];
    for (const attr of attrs) {
      const value = attr.toLowerCase();
      for (const word of ADDRESS_WORDS) {
        assert.ok(
          !value.includes(word),
          `Mail Adventures field mentions "${word}". Rooted never collects a mailing address: ${field.slice(0, 120)}`
        );
      }
    }
  }
});

test("neither the page nor the report sheet autofills an address", () => {
  for (const file of [MAIL_PAGE, REPORT_SHEET]) {
    const src = read(file).toLowerCase();
    assert.ok(!src.includes('autocomplete="street'), `${file} sets a street autocomplete`);
    assert.ok(!src.includes('autocomplete="postal'), `${file} sets a postal autocomplete`);
    assert.ok(!src.includes('autocomplete="address'), `${file} sets an address autocomplete`);
    assert.ok(!src.includes("mailing_address"), `${file} references a mailing_address field`);
  }
});

// ── One report sheet, used by both pages ─────────────────────────────────────

test("both Resources and Mail Adventures import the one report sheet", () => {
  for (const file of [MAIL_PAGE, RESOURCES_PAGE]) {
    assert.match(
      read(file),
      /import\s+ResourceReportSheet[^;]*from\s+"@\/components\/ResourceReportSheet"/,
      `${file} must use the shared ResourceReportSheet, not its own copy`
    );
  }
});

test("the report sheet writes exactly one target id, matching the check constraint", () => {
  // resource_reports carries `resource_reports_exactly_one_target`. A row with
  // both ids, or neither, is rejected by the database, so the sheet names the
  // other side explicitly as null rather than leaving it off.
  const src = read(REPORT_SHEET);
  assert.match(src, /mailbox_listing_id: target\.listingId, resource_id: null/);
  assert.match(src, /resource_id: target\.resourceId, mailbox_listing_id: null/);
});

// ── The capture handoff ──────────────────────────────────────────────────────

test("the dashboard capture handler reads title and strips both params", () => {
  const src = read(DASHBOARD_PAGE);
  const start = src.indexOf("Open capture menu from URL param");
  assert.ok(start > -1, "capture-from-URL handler not found");
  const block = src.slice(start, start + 1200);

  assert.match(block, /searchParams\.get\("title"\)/, "handler must read the title param");
  assert.match(block, /MAX_PREFILL_TITLE/, "handler must bound the title length");
  assert.match(block, /searchParams\.delete\("capture"\)/, "handler must strip capture");
  assert.match(block, /searchParams\.delete\("title"\)/, "handler must strip title, or a refresh reopens the sheet");
});

// ── THE REGRESSION GUARD ─────────────────────────────────────────────────────
//
// Every memory save path refreshes Today's Story and the Memories grid without
// a page reload. This branch touches app/dashboard/page.tsx, so the guard is
// asserted here too: the pairing is easy to break with an unrelated edit and
// invisible until a family saves a photo and the page looks unchanged.

test("every refreshTodayStory in the dashboard is preceded by an awaited loadData", () => {
  // The rule is the pairing and the ORDER, not a raw count: loadData refreshes
  // the Memories grid, refreshTodayStory refreshes Today's Story, and a save
  // that runs one without the other leaves half the page stale until a reload.
  //
  // Counting the two calls and comparing totals would be wrong. loadData is
  // also awaited on paths that are not saves (first load, child switching,
  // recovery), so the totals legitimately differ: 20 and 14 on staging as of
  // this branch. What must hold is that nothing awaits refreshTodayStory
  // without having just awaited loadData.
  const src = read(DASHBOARD_PAGE);
  const marker = "await refreshTodayStory()";
  let from = 0;
  let checked = 0;

  for (;;) {
    const at = src.indexOf(marker, from);
    if (at === -1) break;
    from = at + marker.length;
    checked++;
    const before = src.slice(Math.max(0, at - 400), at);
    assert.ok(
      before.includes("await loadData()"),
      `a refreshTodayStory() near character ${at} has no awaited loadData() before it. ` +
        "Every memory save must refresh both, loadData first."
    );
  }

  assert.ok(checked >= 14, `expected at least the 14 known refresh sites, found ${checked}`);
});

test("the photo capture path still awaits both refreshes after saving", () => {
  const src = read(DASHBOARD_PAGE);
  // Anchored on the declaration, not on a line inside the body. It used to key
  // off "const memType = captureTypeRef.current;", which stopped existing the
  // day a retry started passing the type in, and an anchor that misses makes
  // this guard pass by finding nothing rather than fail.
  const start = src.indexOf("async function saveCapturedPhotos(");
  assert.ok(start > -1, "photo capture handler not found");
  const block = src.slice(start, start + 9000);
  assert.match(block, /await loadData\(\);/, "photo capture must await loadData");
  assert.match(block, /await refreshTodayStory\(\);/, "photo capture must await refreshTodayStory");
});

// ── The link checker ─────────────────────────────────────────────────────────

test("the link checker walks mailbox_listings as well as resources", () => {
  const src = read(CRON);
  assert.match(src, /\.from\("mailbox_listings"\)/, "checker must read mailbox_listings");
  assert.match(src, /official_url/, "mailbox_listings keeps its link in official_url");
});

test("the link checker never writes verification_status or is_active", () => {
  // A "blocked" result is mostly a false positive: government and tourism sites
  // refuse bots and work fine in a browser. Only a family report or Brittany
  // flips a listing. The checker may write last_check_status and
  // consecutive_failures, and nothing else.
  const src = read(CRON);
  const updates = src.match(/\.update\(\{[\s\S]*?\}\)/g) ?? [];
  assert.ok(updates.length > 0, "expected the checker to write something");

  for (const u of updates) {
    assert.ok(!/verification_status/.test(u), `checker must never write verification_status: ${u}`);
    assert.ok(!/is_active/.test(u), `checker must never hide a listing: ${u}`);
  }
});

test("the family-facing page never shows the checker's blocked status", () => {
  const src = read(MAIL_PAGE);
  assert.ok(!src.includes("last_check_status"), "the checker's status is internal, never shown to families");
  assert.ok(!src.includes("consecutive_failures"), "failure counts are internal, never shown to families");
});

// ── Card logic ───────────────────────────────────────────────────────────────

test("Add a memory renders only when the listing is marked Received", () => {
  // Offering it before the package arrives invites a memory of nothing. The
  // button is inside a `received && (...)` branch, so the gate is structural
  // rather than a disabled state a future edit could quietly drop.
  const src = read(MAIL_PAGE);
  const at = src.indexOf("Add a memory");
  assert.ok(at > -1, "the Add a memory button is missing");

  const before = src.slice(Math.max(0, at - 700), at);
  assert.match(before, /\{received && \(/, "Add a memory must sit inside a `received &&` branch");
  assert.ok(!/\{requested && \([\s\S]*Add a memory/.test(src), "it must gate on Received, not Requested");
});

test("the memory handoff carries the title and opens the real capture path", () => {
  const src = read(MAIL_PAGE);
  assert.match(src, /\/dashboard\?capture=1&title=\$\{encodeURIComponent\(memoryTitle\)\}/);
  assert.match(src, /: "\/dashboard\?capture=1"/, "a dropped over-long title must still open the sheet");
});

test("the official link opens safely in a new tab", () => {
  const src = read(MAIL_PAGE);
  const at = src.indexOf("Open official page");
  assert.ok(at > -1);
  const anchor = src.slice(Math.max(0, at - 600), at);
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, /rel="noopener noreferrer"/);
});

// ── The progress write ───────────────────────────────────────────────────────

test("the toggles do not upsert on the partial index", () => {
  // mailbox_progress_family_listing_uniq is partial (WHERE child_id IS NULL).
  // Postgres cannot infer a partial index from a bare column list, and
  // PostgREST's on_conflict sends nothing else, so an upsert here returns 42P10
  // and every tap 400s. Reproduced against staging before this test existed.
  const src = read(MAIL_PAGE);
  assert.ok(
    !/\.upsert\(/.test(src),
    "Mail Adventures must not upsert: the conflict target is a partial index and cannot be inferred. Use the explicit UPDATE-or-INSERT."
  );
  assert.ok(!src.includes("onConflict"), "onConflict cannot express the index predicate");
});

test("the progress write handles the row already existing", () => {
  const src = read(MAIL_PAGE);
  assert.match(src, /\.insert\(\{ user_id: userId as string, child_id: null/, "must insert a family-scoped row");
  assert.match(src, /insErr\.code === "23505"/, "a concurrent insert must fall back to an update");
  assert.match(src, /\.is\("child_id", null\)/, "the update must target the family row, not a per-child one");
});
