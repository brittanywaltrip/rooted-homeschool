# Account deletion billing and cleanup safeguards

Draft PR #133 change, based on main commit 55689d0. Not deployed. No real account,
subscription, file, database row, or outbound email was changed by testing.

## Problem and change

The deletion endpoint removed family data and the profile before canceling Stripe
subscriptions. It ignored profile-read errors and cancellation errors, listed only
active subscriptions, and read only the first page. A successful deletion response
could therefore leave a renewing subscription without its app billing mapping.

The endpoint now checks billing before any deletion log insert, file removal,
record removal, or auth deletion. Profile errors or a missing profile refuse the
request. A stored subscription without a customer mapping also refuses it. For a
mapped Stripe customer, it reads every page with status=all, cancels every
nonterminal subscription without final invoicing or proration, verifies each
cancellation response, and reads every page again to check none remains open.
Canceled and incomplete_expired subscriptions are already terminal.

Billing failure returns 503 with dataDeleted=false. Its message explains that family data
was preserved but some subscriptions may already have been canceled. Keeping the
profile makes a partial cancellation retry possible. A missing profile after an
older partial deletion requires support; the endpoint must not guess at billing.

## Cleanup safeguards

Reuses the recursive storage listing already in draft PR #132, with its nested
certificate and family-isolation tests. After a clean removal attempt, each bucket
is listed again. Leftover files or listing errors stop deletion before any family
database record, deletion log, profile, or login is removed. Some files may already
be gone; the response says so and preserves login/profile for a cleanup retry.

Each explicit database deletion now checks its error. A failure stops later
steps and returns partial-deletion status; Settings already disables its delete
button for that response and directs the family to support. Auth deletion failure
likewise sends no success email. The goodbye email acknowledges retained
administrative records and backups without inventing a retention period.

## Live schema and billing evidence

Read-only production schema checks confirmed that daily_reflections, child_ui_prefs
and app_events have neither a user-owner cascade nor another foreign-key cascade.
They are now explicitly deleted by authenticated user_id before profile/login
removal. Tests assert each owner scope and verify that reflection-delete failure
stops the operation. These tables and their uuid user_id columns also exist on staging.

Aggregate-only production checks found one daily_reflections row and 424 app_events
rows with a non-null owner ID absent from auth.users; child_ui_prefs had zero.
No row contents were read, no cause was inferred and no historical cleanup was
applied. A separate review must establish scope and retention obligations before
historical writes. subject_goals does cascade through children/subjects.

Read-only live Stripe lists returned zero subscription schedules and zero pending
invoice items, each with has_more=false. This is current evidence, not an ongoing
guarantee. Vercel denied team access (403), so this session cannot perform the
rooted-staging deployment. CI waits for the exact head's staging deployment.

## Validation

Thirty-five focused tests pass: profile errors, missing profile, free-account behavior,
missing customer mapping, all subscription statuses and pages, a second-page
failure before cancellation, partial cancellation retry, unconfirmed cancellation,
an open subscription on the final read, missing stored subscription, malformed
pagination, and nine actual-route tests covering billing order, preservation of
records/login on storage failure, cleanup retry, checked record deletion and auth
deletion failure. Storage tests cover nested files, isolation, dry runs, removal
failures and post-removal verification.

The route tests transpile the actual endpoint and inject fake providers. They do
not call real Stripe, Supabase, storage, or email. TypeScript and focused ESLint
checks pass. No provider sandbox or deployed staging rehearsal has run yet.

## Remaining release work

- Rehearse against Stripe test mode with synthetic accounts and injected failures.
  rooted-staging intentionally has no Stripe credential; do not add production
  credentials or exercise live customers to bypass that restriction.
- Rehearse storage, database and auth failures with real isolated staging services.
  Those cases pass with fake providers locally. No live-family deletion is authorized.
- Review future subscription schedules, pending invoice items, incomplete billing
  mappings, alternate sales channels, and concurrent checkout/deletion. This check
  covers subscriptions attached to the stored Stripe customer and is not a global
  guarantee that no later charge can occur.
- Establish durable follow-up cleanup and verify backup retention before publishing
  deletion guarantees. This patch preserves the account for storage retry but does
  not add an automatic retry queue, atomic cross-provider deletion, a concurrent
  write lock or automatic repair of historical partial deletions. Audit/backup
  retention (including lessons_resync_blocked and the historical backfill table),
  reviews and resource reports that detach their owner rather than cascade, and
  third-party analytics deletion still require review.
- Keep Terms/Privacy changes in draft pending the broader evidence/legal review.
