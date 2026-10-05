# Admin auth callback review — October 5, 2026

Base: production commit b9904b6fa60223e9d183a64e3db898c0a1f286d7. Local branch fix/admin-auth-callbacks-2026-10-05. No remote write, staging fixture, deployment or production change.

## Concrete finding

Both app/admin/page.tsx and app/admin/resources/page.tsx await refreshSession inside an async onAuthStateChange INITIAL_SESSION callback. Installed @supabase/auth-js 2.99.2 explicitly warns in GoTrueClient.ts that async callbacks calling APIs requiring its exclusive lock can deadlock. Its navigatorLock implementation uses a five-second acquire timeout followed by steal recovery. Supabase's official auth-state documentation recommends a synchronous callback: https://supabase.com/docs/reference/javascript/auth-onauthstatechange .

The prepared change returns synchronously from each listener and schedules refresh work in a later timer task. Queued tasks are cancelled on unmount, and late refresh results are ignored before loading the page. Refresh errors fail closed: the summary shows a reload error; Resources redirects to login. Successful refresh still supplies the refreshed bearer token to the summary API. Existing server admin authorization remains authoritative and unchanged. Locks remain enabled, no telemetry is suppressed, and no SDK dependency is changed.

## Verification and limits

Five focused tests cover callback/microtask completion before refresh, cancellation before execution, handled rejection, suppression of late failures after unmount, and both page integrations. Full suite: 2,050 passed, zero failed, eight skipped (2,058 total). TypeScript passes. New helper/test lint and diff checks pass. Changed-page lint retains the pre-existing Resources set-state-in-effect error and Summary img warning. The baseline Resources source produces the same lint error.

Real-browser signed-in admin testing is still required: summary and payout loads, resource loads, non-admin refusal, session expiry, navigation before refresh, and concurrent tabs. No staging session was used while CC rehearsed Builder #145. This is a separate local prepared fix, not a release-ready claim.

## Customer Plan alert remains separate

Read-only PostHog follow-up since October 5 18:00 UTC still shows one occurrence, one session and one user for issue 01a10d3f-54a8-7031-a0d7-26c197d6bf17, last seen 18:06:53.586 UTC. There is no usable stack linking that Plan error to these admin callbacks. Their lock contention could affect other tabs of the same browser, but that is a hypothesis, not an established customer incident cause. Do not label the Plan issue fixed or resolved.

Reports review: prepared commit 9d0681fb correctly separates same-date note/time edits from deliberate date changes and rejects stale displayed dates. It is locally tested but still needs an integrated-current-main review and a production-shaped staging rehearsal with actual triggers, concurrent sessions, Reports, Today and Plan. Concurrent note/minute edits have no whole-row optimistic-concurrency guard. No Reports changes were made during this review.
