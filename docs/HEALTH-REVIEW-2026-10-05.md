# Rooted health review — October 5, 2026

Production was read only. No customer messages, payments, migrations, deployments or recovery writes were made.

## Verified

- Customer mailbox swept since October 2, including spam. No new customer requests. Brandy's October 2 reply is present in Sent. Older spam contains a Resend receipt and a domain solicitation, not a customer request.
- Public home, login, dashboard shell and health endpoints return HTTP 200. This is not an authenticated end-to-end test.
- Production remains commit 55689d02, READY deployment dpl_4twdaMVmtr4CUW3u3bpRudkkJMwo. Health reports `env: unknown`, `identityOk: false`, `unresolvable_project_ref`; this known identity/configuration issue is unresolved.
- October 5 weekly summary: 73 send-log rows for 73 distinct recipients. One delivered copy is confirmed in the owner's mailbox; log entries alone do not prove delivery to every recipient.
- Partner ledger: 13 active partners, 7 conversions, $53.32 earned and $53.32 recorded paid. Every individual partner balance is zero. Bank settlement was not checked.
- Stripe search (all results, no additional page): 66 active subscriptions, all matched to the correct customer/profile with Pro access; all latest invoices paid. No trialing, past-due or unpaid subscriptions returned. Search has eventual-consistency limitations.
- Profile drift persists: 8 linked profiles lack a paid-through date; 3 have a legacy-free flag. No active subscription profile lacks Pro access. No profile repairs applied.
- No duplicate non-null queue slots within curricula. The server-side completion guard remains installed and enabled.
- All 11 held recovery lessons still equal their frozen row snapshots. One previously repaired Option A lesson is completed again, updated October 1; no date-change audit row identifies the actor. Do not reverse it from timestamp evidence alone.
- Draft PRs #144 and #142 remain open; no recent PR search results since October 2. Their older staging checks were not rerun today.

## Error evidence and limits

PostHog's weekly digest reports 27 exceptions (down 68%), 414 sessions and 97.1% crash-free sessions, including two new issues. Sentry's September 26–October 3 digest reports 57 errors (down 45%) and 8 ongoing issues. These are historical digests, not a live error review. Vercel runtime logs returned 403; a Sentry API credential is unavailable. Cowork's integrity routine state could not be independently verified from this environment; keep it paused pending its instruction update.

## Local forward progress

The weekly link checker passes a relative resource path directly to server `fetch`, which rejects it before making a request. This explains the Fall Photo Frame connection failure; it does not prove the signed-in printable works.

The prepared change resolves relative paths against the canonical Rooted origin, preserves external web URLs and query parameters, and rejects non-web protocols. It leaves catalog links and visibility untouched. This branch already contains the earlier catalog-read failure guard.

Validation: 18 targeted tests passed; TypeScript and lint passed; diff whitespace check passed. No staging or production deployment. External timeout/403 entries remain inconclusive and should not cause removal of resources.

Next release work: production identity/configuration, verified partner release #144, and Builder/unslotted protections including #142's start-lesson trigger gap. Verify exact integrated commits on staging before release. Keep the remaining recovery lessons untouched until each relevant protection and approval is in place.


## Afternoon customer, payment and error sweep

Read-only review after the #136 and #144 production releases.

- Rooted mailbox including spam/trash searched since October 2: no newer customer request beyond Brandy's grading question. The thread contains the October 2 SENT reply accurately explaining course-level transcript grades and the absence of a daily assignment gradebook. No new reply sent.
- Stripe live Rooted account: one invoice created since October 2 Pacific, paid $9.99 on its first attempt; corresponding payment intent succeeded without last_payment_error. All pages exhausted. No open invoices, and subscription search returned no past_due, unpaid or incomplete subscriptions. Search-based results may lag recent updates; bank settlement/disputes were not audited.
- PostHog project 370667, UTC project timezone, window from October 2 07:00 UTC: six active issue groups, 15 occurrences summed across groups. Each group reports one affected user; these users cannot be summed without deduplication. One new Plan AbortError at October 5 18:06:53 UTC, one occurrence/session/user. Other groups include failed fetch (1), lock stolen (1), generic script errors (7), lock broken with steal (3), and window.ethereum errors on tour (2). Browser-extension involvement in the ethereum event is a hypothesis only.
- Sentry email ROOTED-HOMESCHOOL-1W corroborates the new Plan AbortError in production, Firefox on Mac, release 55689d02. Two emails notify the same event/issue, not evidence of two failures. Both telemetry samples lack usable stack frames. It predates today's identity and partner releases. Installed auth-js browser lock implementation uses AbortController timeout and recovery by steal, making authentication lock contention a hypothesis worth controlled reproduction. No lock behavior or telemetry suppression changed.
- Resend provider-wide delivery/bounce audit remains blocked: remote browser requires sign-in; no local Resend API credential was available. User's local Mac Chrome tab is not exposed in the connected browser inventory. Received weekly and link-check emails establish delivery only to the owner's inbox.
- Weekly resource checker labels the relative Fall Photo Frame path as timeout/DNS. The already-prepared link-check normalization fix addresses that false positive; it is not deployed. 55 persistent 403 responses must not be equated with 55 dead customer links.

Follow-ups: reproduce browser auth lock failure safely; finish Resend delivery audit when an authenticated supported session is available; rehearse/release the prepared link-check correction separately. No production data writes, customer contact, payments, recovery action or integrity-routine changes.
