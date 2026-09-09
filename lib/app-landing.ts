// Where a request or a page load should land, decided without a network call.
//
// WHY THIS MODULE EXISTS
//
// The App Store build is a Capacitor shell pointed at
// https://www.rootedhomeschoolapp.com, so every cold launch loads "/", the
// marketing homepage. "/" has no idea the family is signed in. A family
// reopening the app therefore saw the marketing site, tapped "Log In", got the
// login page with a "you're already signed in" banner, tapped that, and sat
// through the dashboard skeleton before they were back where they left off.
// Measured on production over the 14 days to 2026-09-08: 199 of those round
// trips across 70 families, 92 of them on a session more than an hour after the
// previous one, which is the shape of the app being reopened rather than a tab
// being clicked. Families reported it as "it keeps signing me out".
//
// The decisions live here, as pure functions over plain values, for two
// reasons. The middleware runs on the edge and the login page is a React
// client component, so neither is reachable by `node --test`; and both have to
// agree about what "signed in" means or the family bounces between them.
//
// Nothing here reads a cookie jar, a router or `document`. Callers pass in what
// they already have.

/**
 * True for the Supabase session cookie, false for everything else that starts
 * with `sb-`.
 *
 * The PKCE code verifier is literally named
 * `<storageKey>-auth-token-code-verifier`, so the obvious
 * `startsWith('sb-') && includes('auth-token')` test matches a visitor who is
 * halfway through an OAuth round trip and has no session at all. That mistake
 * has already cost this codebase two production incidents (auth invariant 8),
 * so the exclusion is part of the predicate rather than something each caller
 * remembers.
 */
export function isSupabaseAuthCookieName(name: string): boolean {
  return (
    name.startsWith("sb-") &&
    name.includes("auth-token") &&
    !name.includes("code-verifier")
  );
}

/**
 * Same test, against a raw `document.cookie` string.
 *
 * The login page uses this to decide, synchronously on its first render,
 * whether it is worth waiting for `getSession()` before painting. Auth cookies
 * are deliberately not httpOnly (see app/api/auth/login/route.ts) precisely so
 * the browser client can read them, which is what makes this possible.
 */
export function documentHasAuthCookie(cookieString: string): boolean {
  if (!cookieString) return false;
  return cookieString
    .split(";")
    .map((pair) => pair.trim().split("=")[0])
    .some((name) => isSupabaseAuthCookieName(name));
}

/**
 * Should the middleware send this request from "/" straight to /dashboard?
 *
 * Deliberately decided from the cookie alone. Calling getUser() here would put
 * a Supabase round trip on the critical path of every marketing page load, and
 * a family holding a cookie that turns out to be stale still lands somewhere
 * sensible: /dashboard's own auth check sends them to /login, and the session
 * lifeboat gets first crack at rescuing them on the way.
 *
 * A query string means hands off. `?ref=CODE` affiliate landings do their click
 * tracking in the browser on "/", and `?utm_*` campaign links have to reach the
 * page they were bought for. Both are vanishingly rare for a signed-in family,
 * so passing them through costs nothing and skipping them would silently break
 * partner attribution.
 */
export function shouldRedirectHomeToDashboard(request: {
  pathname: string;
  search: string;
  hasAuthCookie: boolean;
}): boolean {
  if (request.pathname !== "/") return false;
  if (!request.hasAuthCookie) return false;
  // `search` is "" or "?a=b". Anything at all means the visitor asked for
  // something specific about this page.
  if (request.search !== "") return false;
  return true;
}

export type LoginLanding =
  /** Render the password form. */
  | "form"
  /** Render the form, plus the "you're already signed in" banner. */
  | "form-with-banner"
  /** Render nothing and replace() to /dashboard. */
  | "redirect";

/**
 * What /login should do for someone who already has a live session.
 *
 * Two landings on this page are load-bearing and must never auto-bounce:
 *
 *   ?error=…   is a documented destination for a failed sign in (auth
 *              invariant 7). Bouncing off it hides the one message the family
 *              needs in order to recover.
 *   ?switch=1  is a parent signed in as themselves coming here on purpose to
 *              sign in as somebody else. It is also what every sign-out path
 *              redirects to, which closes a race: signOut() clears the cookies
 *              client side, and if the redirect beats the clear then a plain
 *              /login would read the session that is on its way out and send
 *              them right back to the dashboard they just left.
 *
 * Everything else is a family who reopened the app, and they want the app.
 */
export function loginLandingFor(state: {
  hasSession: boolean;
  arrivedWithError: boolean;
  arrivedWithSwitch: boolean;
}): LoginLanding {
  if (!state.hasSession) return "form";
  if (state.arrivedWithError) return "form";
  if (state.arrivedWithSwitch) return "form-with-banner";
  return "redirect";
}
