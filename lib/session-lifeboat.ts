// Session lifeboat — a durable backup of the session for cookie-fragile shells.
//
// THE PROBLEM. The session lives in cookies, and it has to: @supabase/ssr and
// middleware.ts both read it from there, and that is what keeps the ~1h access
// token refreshing. WKWebView (the iOS Capacitor shell) persists
// `document.cookie` writes to disk LAZILY. iOS then kills the suspended app
// before that flush happens, so the newest ROTATED refresh token never reaches
// disk. On relaunch the cookie is stale or missing, the refresh comes back
// "Refresh Token Not Found", @supabase/ssr responds to an auth error by wiping
// the session, and the family lands on /login. Verified against auth.sessions:
// one affected user accumulated 31 live sessions, one per forced re-login,
// 1-5 times a day. Desktop browsers flush cookies promptly, which is exactly
// why only the wrapped app suffers.
//
// THE FIX. Cookies stay the single source of truth and are not touched. We keep
// a copy of the two tokens in localStorage, which WKWebView persists eagerly,
// and when the app boots to an empty cookie jar we hand them back to
// supabase-js via setSession(). That call makes @supabase/ssr rewrite the
// session cookies, which re-feeds the middleware on the next request. The
// lifeboat is a backup, never an authority: nothing reads it unless getUser
// has already come back definitively signed-out.
//
// NOT restricted to the native shell on purpose. iOS Safari home-screen PWAs
// share the same cookie fragility, and on desktop it is harmless redundancy.
//
// SECURITY. This holds the same refresh token supabase-js stores in
// localStorage by default in any non-SSR app, so it adds no new exposure
// class. It holds nothing else: no user object, no email, no profile. It is
// removed on deliberate sign-out and on any failed restore, so a dead token
// can never sit there retrying forever.

import type { Session, SupabaseClient } from "@supabase/supabase-js";

import { isNativeApp } from "@/lib/platform";
import { posthog } from "@/lib/posthog";

const LIFEBOAT_KEY = "rooted-session-lifeboat";

type Lifeboat = {
  access_token: string;
  refresh_token: string;
  saved_at: number;
};

export type RestoreOutcome = "none" | "restored" | "failed";

/**
 * Every localStorage call is wrapped: Safari private mode throws on write, and
 * a storage exception must never be the reason a family cannot load the app.
 */
function readLifeboat(): Lifeboat | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LIFEBOAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Lifeboat>;
    if (typeof parsed?.access_token !== "string" || parsed.access_token.length === 0) return null;
    if (typeof parsed?.refresh_token !== "string" || parsed.refresh_token.length === 0) return null;
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      saved_at: typeof parsed.saved_at === "number" ? parsed.saved_at : 0,
    };
  } catch {
    return null;
  }
}

/** Back up the two tokens. Called on sign-in and on every token rotation. */
export function saveLifeboat(session: Session | null | undefined): void {
  if (typeof window === "undefined") return;
  if (!session?.access_token || !session?.refresh_token) return;
  try {
    const payload: Lifeboat = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      saved_at: Date.now(),
    };
    window.localStorage.setItem(LIFEBOAT_KEY, JSON.stringify(payload));
  } catch {
    // Private mode, quota, disabled storage. The family keeps the cookie
    // session they already have; they just lose the backup.
  }
}

/** Drop the backup. Called on deliberate sign-out and on a failed restore. */
export function clearLifeboat(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LIFEBOAT_KEY);
  } catch {
    // Nothing to do; a stale entry is handled by the failed-restore path.
  }
}

/**
 * Last resort before concluding a family is signed out.
 *
 * setSession is what does the work: supabase-js validates the refresh token and
 * @supabase/ssr writes the resulting session back into the cookies, which is
 * what the middleware reads on the next request.
 *
 * A failure here removes the lifeboat. A token that could not be redeemed once
 * will not be redeemable later, and leaving it in place would mean every future
 * boot pays a network round trip to fail the same way.
 */
export async function restoreFromLifeboat(
  supabase: SupabaseClient,
): Promise<RestoreOutcome> {
  const boat = readLifeboat();
  if (!boat) {
    report("none");
    return "none";
  }
  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: boat.access_token,
      refresh_token: boat.refresh_token,
    });
    if (error || !data?.session) {
      clearLifeboat();
      report("failed");
      return "failed";
    }
    // The restored session is itself a fresh rotation, so back it up now
    // rather than waiting for the listener to see the event.
    saveLifeboat(data.session);
    report("restored");
    return "restored";
  } catch {
    clearLifeboat();
    report("failed");
    return "failed";
  }
}

/**
 * One event per restore attempt, including the "none" case, so the denominator
 * is visible. Without "none" we could not tell "the lifeboat never fires" from
 * "the lifeboat never gets a chance to fire".
 */
function report(outcome: RestoreOutcome): void {
  try {
    posthog.capture("session_lifeboat_restore", {
      outcome,
      is_native: isNativeApp(),
    });
  } catch {
    // Analytics must never break an auth path.
  }
}

let listenerInstalled = false;

/**
 * Keep the lifeboat current. Attached ONCE, at module scope of the client
 * singleton, not from React: a listener per mount would multiply the writes
 * and outlive the components that registered them.
 *
 * INITIAL_SESSION is included deliberately, and it is not redundant. SIGNED_IN
 * fires only when a family actually signs in, so without this seed an
 * already-signed-in iOS family would carry no lifeboat until their first token
 * rotation, up to an hour later. Losing that very rotation is the bug. Seeding
 * on boot makes the backup protective from the first load.
 */
export function installSessionLifeboat(supabase: SupabaseClient): void {
  if (typeof window === "undefined") return;
  if (listenerInstalled) return;
  listenerInstalled = true;

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      // A deliberate sign-out must not be resurrected on the next boot.
      clearLifeboat();
      return;
    }
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
      saveLifeboat(session);
    }
  });
}
