// Reopening the app has to land in the app.
//
// The behaviour under test is spread across an edge middleware and a React
// client component, neither of which `node --test` can run: one needs a
// NextRequest and the edge runtime, the other needs a DOM this repo has no
// tooling for. So the decisions themselves live in lib/app-landing.ts as pure
// functions and are tested here for real, and a second group below reads the
// two call sites as source to prove they are actually wired to them. That is
// the same split as lib/memory-insert-guard.test.ts and
// app/components/updaterPurity.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  documentHasAuthCookie,
  isSupabaseAuthCookieName,
  loginLandingFor,
  shouldRedirectHomeToDashboard,
} from "./app-landing.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Production names the cookie from the Supabase custom domain host, so it is
// `sb-auth-auth-token` there and something else locally. Never assume one.
const PROD_COOKIE = "sb-auth-auth-token";
const LOCAL_COOKIE = "sb-gvkbegvvmhcrmxdorctk-auth-token";

// ── The cookie name test ───────────────────────────────────────────────────

test("the session cookie is recognised under both storage keys", () => {
  assert.equal(isSupabaseAuthCookieName(PROD_COOKIE), true);
  assert.equal(isSupabaseAuthCookieName(LOCAL_COOKIE), true);
  // Chunked cookies are what WKWebView leaves half-written; each chunk still
  // names a session.
  assert.equal(isSupabaseAuthCookieName(`${PROD_COOKIE}.0`), true);
});

test("the PKCE code verifier is not a session", () => {
  // Auth invariant 8. A visitor mid-OAuth holds this and nothing else.
  assert.equal(
    isSupabaseAuthCookieName(`${PROD_COOKIE}-code-verifier`),
    false,
  );
  assert.equal(isSupabaseAuthCookieName("sb-auth-refresh-lock"), false);
  assert.equal(isSupabaseAuthCookieName("posthog_distinct_id"), false);
});

test("document.cookie is scanned by name, not by substring", () => {
  assert.equal(documentHasAuthCookie(""), false);
  assert.equal(
    documentHasAuthCookie(`${PROD_COOKIE}-code-verifier=abc`),
    false,
  );
  assert.equal(documentHasAuthCookie(`ref_clicked_AMBER=2026-09-08`), false);
  assert.equal(
    documentHasAuthCookie(`ref_clicked_AMBER=x; ${PROD_COOKIE}=base64-payload`),
    true,
  );
  // A cookie VALUE that happens to contain the name must not count.
  assert.equal(documentHasAuthCookie(`decoy=${PROD_COOKIE}`), false);
});

// ── The "/" redirect ───────────────────────────────────────────────────────

test('"/" with an auth cookie and no query goes to the dashboard', () => {
  assert.equal(
    shouldRedirectHomeToDashboard({
      pathname: "/",
      search: "",
      hasAuthCookie: true,
    }),
    true,
  );
});

test('"/" with no auth cookie is left alone', () => {
  assert.equal(
    shouldRedirectHomeToDashboard({
      pathname: "/",
      search: "",
      hasAuthCookie: false,
    }),
    false,
  );
});

test("a query string on / passes through even with a cookie", () => {
  // Affiliate landings do their click tracking in the browser on "/", and
  // redirecting away would silently stop crediting the partner.
  for (const search of [
    "?ref=AMBER",
    "?utm_source=facebook&utm_campaign=founding",
    "?anything",
  ]) {
    assert.equal(
      shouldRedirectHomeToDashboard({
        pathname: "/",
        search,
        hasAuthCookie: true,
      }),
      false,
      `${search} should pass through`,
    );
  }
});

test("no path other than / is ever redirected", () => {
  for (const pathname of [
    "/auth/callback",
    "/login",
    "/faq",
    "/dashboard",
    "/family/abc",
    "/signup",
  ]) {
    assert.equal(
      shouldRedirectHomeToDashboard({
        pathname,
        search: "",
        hasAuthCookie: true,
      }),
      false,
      `${pathname} must not redirect`,
    );
  }
});

// ── What /login does with a live session ───────────────────────────────────

test("a live session with no error and no switch redirects", () => {
  assert.equal(
    loginLandingFor({
      hasSession: true,
      arrivedWithError: false,
      arrivedWithSwitch: false,
    }),
    "redirect",
  );
});

test("no session always gets the form", () => {
  for (const arrivedWithError of [true, false]) {
    for (const arrivedWithSwitch of [true, false]) {
      assert.equal(
        loginLandingFor({ hasSession: false, arrivedWithError, arrivedWithSwitch }),
        "form",
      );
    }
  }
});

test("?error= keeps the form, session or not", () => {
  // Auth invariant 7: /login?error=pkce_cross_device is a documented landing
  // and the message on it is the family's only route back.
  assert.equal(
    loginLandingFor({
      hasSession: true,
      arrivedWithError: true,
      arrivedWithSwitch: false,
    }),
    "form",
  );
});

test("?switch=1 keeps the form and shows the banner", () => {
  assert.equal(
    loginLandingFor({
      hasSession: true,
      arrivedWithError: false,
      arrivedWithSwitch: true,
    }),
    "form-with-banner",
  );
});

// ── The call sites are actually wired to the decisions above ───────────────

test("middleware redirects / through shouldRedirectHomeToDashboard", () => {
  const src = read("middleware.ts");
  assert.match(src, /shouldRedirectHomeToDashboard\(\{/);
  assert.match(src, /NextResponse\.redirect\(new URL\('\/dashboard', request\.url\), 307\)/);
  // It must feed the function the real query string, not a hardcoded "".
  assert.match(src, /search: request\.nextUrl\.search/);
});

test("middleware bypasses /auth/callback before it can redirect", () => {
  const src = read("middleware.ts");
  const bypass = src.indexOf("pathname.startsWith('/auth/callback')");
  // The call site, not the import at the top of the file.
  const redirect = src.indexOf("shouldRedirectHomeToDashboard({");
  assert.ok(bypass > 0, "/auth/callback bypass is missing");
  assert.ok(
    bypass < redirect,
    "the /auth/callback bypass must come before the / redirect",
  );
});

test("middleware and the login page share one cookie name test", () => {
  const src = read("middleware.ts");
  assert.match(src, /isSupabaseAuthCookieName\(c\.name\)/);
  // The old inline copy must be gone, or the two can drift apart again.
  assert.doesNotMatch(src, /c\.name\.startsWith\('sb-'\)/);
});

test("the login page redirects instead of rendering the form", () => {
  const src = read("app/login/page.tsx");
  assert.match(src, /loginLandingFor\(\{/);
  assert.match(src, /router\.replace\("\/dashboard"\)/);
  // Rendering nothing is the point: a flash of the password form is the thing
  // families call "it keeps signing me out".
  assert.match(src, /landing === "redirect"\) return null;/);
  assert.match(src, /searchParams\.get\("switch"\) === "1"/);
});

test("every sign-out lands on /login?switch=1", () => {
  // signOut() clears cookies in the browser and the redirect can beat it. On a
  // plain /login the session on its way out reads as live and the family is
  // sent straight back into the account they just left.
  //
  // Only redirects that FOLLOW a signOut() are policed. The dashboard layout
  // also bounces to a bare /login when its auth check fails, and that one is
  // correct as it stands: there is no session for the login page to find, so
  // it renders the form either way, and tagging it switch=1 would tell a
  // family who never chose to sign out that they are switching accounts.
  const files = [
    "app/dashboard/layout.tsx",
    "app/dashboard/settings/page.tsx",
    "app/reset-password/page.tsx",
  ];
  let checked = 0;
  for (const rel of files) {
    const src = read(rel).replace(/\/\/[^\n]*/g, " ");
    for (const m of src.matchAll(/signOut\(\)/g)) {
      // Everything up to the next signOut, or 600 chars, whichever is closer.
      const after = src.slice(m.index + 1, m.index + 601).split("signOut()")[0];
      const dest = after.match(/["'`]\/login[^"'`]*["'`]/);
      if (!dest) continue;
      checked += 1;
      assert.ok(
        dest[0].includes("switch=1"),
        `${rel}: a sign-out redirects to ${dest[0]}, which has no switch=1`,
      );
    }
  }
  assert.ok(checked >= 3, `expected at least 3 sign-out redirects, found ${checked}`);
});
