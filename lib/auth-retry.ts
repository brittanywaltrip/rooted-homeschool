import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { restoreFromLifeboat } from "@/lib/session-lifeboat";

/* ============================================================================
 * Auth check retry + error classification.
 *
 * `supabase.auth.getUser()` is a NETWORK call. On a phone waking with weak
 * signal the fetch fails and auth-js returns
 *   { data: { user: null }, error: AuthRetryableFetchError }
 * WITHOUT touching the stored session. Every caller that destructured the
 * error away read that as "signed out" and redirected to /login, so a family
 * with a perfectly valid session landed on the login form and typed their
 * password again. Three families reported it as "the app keeps signing me
 * out"; Sentry shows the matching "TypeError: Failed to fetch
 * (auth.rootedhomeschoolapp.com)" and "TypeError: Load failed" on /dashboard.
 *
 * The rule this module encodes: a redirect to /login is a claim that the
 * family is SIGNED OUT. Only make that claim when the call actually answered.
 * Anything else (network failure, 5xx, an error class we do not recognise)
 * leaves them where they are.
 *
 * One definition, shared by the dashboard layout and the onboarding page, so
 * the two cannot drift apart on what counts as "signed out".
 * ==========================================================================*/

/** Backoff between getUser attempts, in ms. Two retries after the first try. */
const RETRY_DELAYS_MS = [1000, 3000];

type ErrorLike = { name?: unknown; status?: unknown; message?: unknown };

function read(error: unknown): { name: string; status: number | null; message: string } {
  const e = (error ?? {}) as ErrorLike;
  return {
    name: typeof e.name === "string" ? e.name : "",
    status: typeof e.status === "number" ? e.status : null,
    message: typeof e.message === "string" ? e.message : "",
  };
}

/**
 * Is this a transport failure rather than an answer from the auth server?
 *
 * Covers auth-js's own AuthRetryableFetchError, the bare `TypeError: Failed to
 * fetch` / `Load failed` that Chrome and Safari raise when the request never
 * completes, and any 5xx. A retryable error means the session was never
 * evaluated, so it says nothing about whether the family is signed in.
 */
export function isRetryableAuthError(error: unknown): boolean {
  if (!error) return false;
  const { name, status, message } = read(error);
  if (name === "AuthRetryableFetchError") return true;
  // Safari says "Load failed", Chrome/Firefox say "Failed to fetch".
  if (name === "TypeError") return true;
  if (status !== null && (status === 0 || status >= 500)) return true;
  return /failed to fetch|load failed|network|timeout|ECONNRESET/i.test(message);
}

/**
 * Did the auth server actually tell us there is no session?
 *
 * This is the ONE error class that justifies a redirect. Note that a genuinely
 * revoked or expired refresh token also surfaces as a SIGNED_OUT event on
 * `onAuthStateChange`, which callers already redirect on, so being strict here
 * does not strand anyone who really is signed out.
 */
export function isSessionMissingError(error: unknown): boolean {
  if (!error) return false;
  return read(error).name === "AuthSessionMissingError";
}

export type AuthCheckResult =
  /** The call answered and there is a user. */
  | { kind: "ok"; user: User }
  /** The call answered and there is genuinely no session. Safe to redirect. */
  | { kind: "signed-out"; reason: string }
  /** The call never answered. Do NOT redirect. */
  | { kind: "unavailable"; reason: string };

/**
 * `getUser()` with bounded retries, classified.
 *
 * Retries only transport failures. A definitive answer (user, or
 * AuthSessionMissingError) returns immediately: retrying a real "no session"
 * would just delay the login redirect.
 */
export async function getUserWithRetry(
  supabase: SupabaseClient,
  opts: { delaysMs?: number[] } = {},
): Promise<AuthCheckResult> {
  const delays = opts.delaysMs ?? RETRY_DELAYS_MS;
  let last: unknown = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const { data, error } = await supabase.auth.getUser();
    if (data?.user) return { kind: "ok", user: data.user };
    if (!error) return await signedOutUnlessLifeboat(supabase, "no-user-no-error");
    if (isSessionMissingError(error)) {
      return await signedOutUnlessLifeboat(supabase, "AuthSessionMissingError");
    }
    if (!isRetryableAuthError(error)) {
      // An error class we do not recognise. Treat it the way we treat a
      // network failure: it is not proof of being signed out, and guessing
      // wrong here is what put families back on the login form.
      return { kind: "unavailable", reason: read(error).name || "unknown-error" };
    }
    last = error;
    if (attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  return { kind: "unavailable", reason: read(last).name || "AuthRetryableFetchError" };
}

/**
 * The auth server answered "no session". Before believing it, try the session
 * lifeboat.
 *
 * This is the one choke point where the app decides a family is signed out, so
 * it is the only place the restore needs to live: the dashboard layout and the
 * onboarding page both route through here and neither has to know about it.
 *
 * An empty cookie jar is exactly what the WKWebView bug produces, and it is
 * indistinguishable from a real sign-out at this level. The lifeboat is what
 * tells them apart: a family who signed out deliberately has no lifeboat,
 * because the SIGNED_OUT listener removed it.
 *
 * getUser runs ONCE more after a successful restore. If it still comes back
 * empty the answer stands, so this can never loop.
 */
async function signedOutUnlessLifeboat(
  supabase: SupabaseClient,
  reason: string,
): Promise<AuthCheckResult> {
  const outcome = await restoreFromLifeboat(supabase);
  if (outcome !== "restored") {
    return { kind: "signed-out", reason };
  }
  const { data, error } = await supabase.auth.getUser();
  if (data?.user) return { kind: "ok", user: data.user };
  // Restore reported success but the session still does not resolve. Treat it
  // the same as any unrecognised state: do not claim they are signed out on
  // evidence this confused.
  if (error && isRetryableAuthError(error)) {
    return { kind: "unavailable", reason: `lifeboat-restored-then-${read(error).name || "error"}` };
  }
  return { kind: "signed-out", reason: `${reason}-after-lifeboat` };
}

/**
 * Record why a surface sent someone to /login.
 *
 * Every redirect gets one of these. Before, a family reporting "it signed me
 * out" left no trace at all distinguishing a real sign-out from a dropped
 * request, which is why this took three reports to characterise.
 */
export function reportAuthRedirect(
  from: string,
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  if (typeof Sentry.addBreadcrumb === "function") {
    Sentry.addBreadcrumb({
      category: "auth",
      level: "info",
      message: `redirect to /login from ${from}`,
      data: { reason, ...extra },
    });
  }
  if (typeof Sentry.captureMessage === "function") {
    Sentry.captureMessage(`auth redirect: ${from} -> /login (${reason})`, {
      level: "info",
      tags: { auth_redirect_from: from, auth_redirect_reason: reason },
      extra,
    });
  }
}

/**
 * Record that a surface DECLINED to redirect because the check was unavailable.
 * This is the counterpart signal: it is what proves the fix is working, and it
 * is the number to watch if families still report being signed out.
 */
export function reportAuthCheckUnavailable(
  from: string,
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  if (typeof Sentry.captureMessage !== "function") return;
  Sentry.captureMessage(`auth check unavailable, staying put: ${from} (${reason})`, {
    level: "warning",
    tags: { auth_check_from: from, auth_check_reason: reason },
    extra,
  });
}
