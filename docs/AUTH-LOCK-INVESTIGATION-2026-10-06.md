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

The Chromium test is prepared but unrun: no local executable was installed and
Playwright's browser download returned invalid/truncated ZIP files. Its server
is closed even when browser launch fails. Do not report it as passing.

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
