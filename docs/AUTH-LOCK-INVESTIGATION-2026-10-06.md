# Auth lock investigation — October 6, 2026

Production baseline: b9904b6fa60223e9d183a64e3db898c0a1f286d7.
This branch changes no application code or dependencies.

## Evidence

Production's lockfile installs @supabase/auth-js and supabase-js 2.99.2.
Three dashboard stolen-lock AbortErrors were observed in the preceding 48 hours.
Dashboard layout's auth callback, the auth context, and the session lifeboat
are synchronous in this baseline. This investigation does not establish a
customer lockout or rule out other callback paths.

Upstream fix: https://github.com/supabase/supabase-js/pull/2616 (merged August 24).
The zero-timeout auto-refresh lock path previously let raw AbortError escape.

The published 2.99.2 and 2.112.4 lock primitives were compared in an isolated
Node VM with controlled LockManager responses. Both execute an ordinary callback
once and refuse an immediately unavailable lock. A simulated stolen zero-timeout
lock produces raw DOMException/AbortError on 2.99.2, and typed
NavigatorLockAcquireTimeoutError on 2.112.4, without retrying or invoking the
callback. These tests passed; this is not a browser or staging result.

The newer package's auth client no longer invokes the exported lock primitives.
Therefore passing a primitive test does not establish the new client's actual
session-refresh behavior. supabase-js 2.112.4 declares Node >=22; the baseline
smoke workflow uses Node 20. Do not upgrade dependencies without reviewing both
runtime compatibility and auth behavior.

## Reproduction

Run `node scripts/reproduce-auth-lock-node.cjs` for the controlled comparison.
Run `node scripts/reproduce-auth-lock.cjs` for the real two-tab Chromium lock
comparison after installing project dependencies and Playwright Chromium.
The scripts fetch only the exact published lock source versions and verify
pinned SHA-256 hashes; imported storage detection is replaced with false solely
to turn SDK debug output off. No credentials, account, or Supabase requests occur.

Update, same day: the Chromium test has now run (Chromium 147.0.7727.15) and
passed. 2.99.2 surfaces a raw DOMException AbortError; 2.112.4 surfaces a typed
NavigatorLockAcquireTimeoutError. The callback runs once and nothing steals
back, in both.

## Staging integration acceptance criteria

Use an isolated staging window and the existing hardcoded staging CI test
account. Refuse unless deployment health verifies cvgqovweybggrqakhdtd and the
exact candidate commit. Never substitute production credentials or a production
deployment. Inspect current main and choose a published compatible fixed
version; 2.112.4 is a comparison candidate, not an approved upgrade.

1. Baseline and candidate: two tabs sharing the same synthetic session; concurrent
   refresh/getUser requests, an unavailable lock, lock preemption, and a tab
   becoming active after backgrounding. Exercise the real installed auth client,
   not just a rewritten copy of the lock primitive.
2. Confirm the account stays signed in and protected profile reads remain valid
   after each recoverable contention. A genuine sign-out still redirects.
3. No repeated callback, refresh loop, duplicate refresh storm, or raw stolen-lock
   unhandled rejection. Do not silence unexpected exceptions to pass.
4. Record the resolved auth-js version, Node compatibility, deployment identity,
   full typecheck/unit results, and exact-commit smoke result.
5. No global sign-out; use local scope if test-session disposal is necessary.
   No customer rows, held lessons, migrations, cleanup, emails, or payouts.

PR #148's admin callback fixes do not prove this dashboard issue is solved.

## Fix and results (October 6, 2026)

Chosen version: @supabase/supabase-js 2.117.2 and @supabase/auth-js 2.117.2,
pinned exactly, with @supabase/ssr pinned at its current 0.9.0.

Why not 2.112.4. From 2.107 the default browser client takes no lock at all
(supabase-js #2392), so #2616 only matters to callers that pass a custom
`lock`, and Rooted passes none. The lockless versions before 2.117.1 have a
two-tab bug: a tab that loses a concurrent refresh reads `{ session: null }`
for one call and sends that request with the anon key, so RLS returns an empty
result (#2696, fixed by #2698 in 2.117.1). 2.117.2 is 2.117.1 with no auth code
change. Every release containing the fix needs Node 22+. Vercel runs this
project on Node 24.x; the smoke workflow moves from Node 20 to 24 to match.

Harness: `scripts/auth-lock-harness` runs the app's real `lib/supabase.ts`
client and `getUserWithRetry` in two Chromium tabs against rooted-staging,
signed in as the CI account (1954d827). Same harness, two installs:

| Scenario | 2.99.2 (production) | 2.117.2 (candidate) |
| --- | --- | --- |
| Natural 30s tick holds a slow refresh, other tab reads the session | Uncaught `AbortError: Lock broken by another request with the 'steal' option.` in the ticking tab; both tabs stay signed in | No page error or rejection; both tabs stay signed in |
| Tick invoked directly, 8s refresh, other tab reads | Tick rejects with raw AbortError after the other tab waits 5.8s and steals | Tick resolves |
| Same, refresh arrives 15s late | AbortError; the stale refresh then overwrites the other tab's newer session | Commit guard discards the stale refresh |
| Both tabs, expired token, getUser/getSession at once | 1 refresh, both signed in, reads return the row | 2 refreshes (one per tab), both signed in, reads return the row |
| Both tabs resume from background with expired token | 1 refresh | 2 refreshes (one per tab), both signed in |
| Genuine sign-out in one tab (local scope) | Other tab gets SIGNED_OUT, getUserWithRetry says signed-out | Same |

Every protected read returned the account's own profile row, and no scenario
redirected except the genuine sign-out. The 2.99.2 natural-tick result is the
same error and message as the three production events.

Not shown by these runs:
- The server's "refresh token already used" answer. Staging accepted a refresh
  15s late, so the #2698 path (a tab losing to another's rotation) did not run.
- Real OS backgrounding. Visibility was simulated in the page.
- iOS WKWebView and Safari.
- Open upstream issues still present in 2.117.2: #2731 (a renewal can delete or
  overwrite a session saved by a sign-in during the renewal's storage read),
  #2715 (a 429 or 408 on refresh of an expired token signs the user out),
  #2726 (getUser(jwt) for another token removes the stored session).
