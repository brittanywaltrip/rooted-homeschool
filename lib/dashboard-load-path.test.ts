// The dashboard load path asks the auth server once and reads profiles once.
// Run with: npm test
//
// Measured on production on 2026-09-09: /auth/v1/user was called four times
// in a row and profiles was fetched four times by different components before
// the Today page could settle. Each of those was a separate component doing
// the obvious thing. This is a static check over the load-path functions
// (not whole files: handlers that run on a tap may still read auth) so the
// next obvious thing does not put a round trip back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/** The text between two markers, which must both exist exactly once. */
function region(src: string, startMarker: string, endMarker: string, label: string): string {
  const s = src.indexOf(startMarker);
  assert.notEqual(s, -1, `${label}: start marker missing`);
  assert.equal(src.indexOf(startMarker, s + 1), -1, `${label}: start marker not unique`);
  const e = src.indexOf(endMarker, s);
  assert.notEqual(e, -1, `${label}: end marker missing`);
  return src.slice(s, e + endMarker.length);
}

const count = (s: string, needle: string) => s.split(needle).length - 1;

const layout = read("app/dashboard/layout.tsx");
const page = read("app/dashboard/page.tsx");
const tabs = read("app/components/today/InlineScheduleTabs.tsx");

const layoutAuthEffect = region(
  layout,
  "const auth = await getUserWithRetry(supabase);",
  "// Keep the auth-state subscription",
  "layout auth effect",
);
const pageLoadData = region(
  page,
  "const loadData = useCallback(async () => {",
  "}, [today, effectiveUserId, loadPageProfile]);",
  "page loadData",
);
const pageAwards = region(
  page,
  "// Check for new achievement awards",
  "}, [effectiveUserId, loading, children, loadPageProfile]);",
  "page achievement effect",
);
const tabsLoad = region(
  tabs,
  "const loadTabsData = useCallback(async () => {",
  "void loadTabsData();",
  "InlineScheduleTabs.loadTabsData",
);

test("one auth read on the whole load path, and it is the layout's", () => {
  assert.equal(count(layoutAuthEffect, "getUserWithRetry("), 1);
  const loadPath = layoutAuthEffect + pageLoadData + pageAwards + tabsLoad + read("app/components/UpgradeBanner.tsx") + read("lib/profile-context.tsx");
  assert.equal(count(loadPath, "auth.getUser("), 0, "no load-path function may call auth.getUser()");
});

test("one profiles read on the load path: the layout's, through ProfileContext", () => {
  // The layout reads it in readProfile (with one retry) and looks up partner_email; the effect calls those.
  assert.equal(count(layoutAuthEffect, 'from("profiles")'), 0);
  assert.equal(count(layoutAuthEffect, "loadProfile(user.id)"), 1);
  // The page's only touch on profiles inside loadData is the timezone self-heal write.
  const reads = pageLoadData.split('from("profiles")').slice(1);
  assert.equal(reads.length, 1, "loadData touches profiles once");
  assert.match(reads[0].slice(0, 60), /\.update\(/, "and that touch is the timezone write");
  assert.equal(count(pageLoadData, "loadPageProfile()"), 1);
  assert.equal(count(pageAwards, 'from("profiles")'), 0);
  const banner = read("app/components/UpgradeBanner.tsx");
  assert.equal(count(banner, 'from("profiles")'), 0);
  assert.equal(count(banner, "@/lib/supabase"), 0);
  assert.match(banner, /useProfile\(\)/);
  const ctx = read("lib/profile-context.tsx");
  assert.equal(count(ctx, "@/lib/supabase"), 0, "the context does not fetch; the layout does");
});

test("the page's first wave carries no auth read and starts the API fetches with it", () => {
  assert.match(pageLoadData, /Promise\.resolve\(\{ data: \{ user: sessionUserRef\.current \} \}\)/);
  const wave = pageLoadData.indexOf("] = await Promise.all([");
  const api = pageLoadData.indexOf("const apiFetches");
  assert.ok(api !== -1 && api < wave, "lists + appointments start before the first wave is awaited");
});

test("badges never load ids to count them", () => {
  for (const f of ["lib/badges.ts", "lib/badge-checks.ts"]) {
    const src = read(f);
    assert.equal(count(src, 'select("id"'), 0, `${f} selects ids`);
    for (const chunk of src.split('from("memories")').slice(1)) {
      assert.match(chunk.slice(0, 80), /select\("\*", head\)|select\("created_at"\)/, `${f}: a memories read must be a head count or the created_at column`);
    }
  }
});

test("the two API routes verify the token locally instead of asking the auth server", () => {
  for (const f of ["app/api/lists/route.ts", "app/api/appointments/route.ts"]) {
    const src = read(f);
    assert.equal(count(src, "auth.getUser("), 0, f);
    assert.match(src, /userIdFromRequest\(req\)/, f);
  }
});
