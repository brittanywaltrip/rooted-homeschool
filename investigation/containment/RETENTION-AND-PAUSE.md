# Receipt retention and pause contract

Local candidate only. Installing definitions does not activate a cohort, run maintenance, schedule a job, or change existing family rows.

## Pause

A protected course may transition between `atomic_v2` and `paused`; it must never be downgraded to legacy. Pause refuses new move, completion, skip/delete, recalibration, history/healing, continuation, Builder, daily reconciliation and calendar mutations. Owned, exact operation replays remain available to resolve ambiguous responses. Calendar operations refuse when any affected owner course is paused.

Owned Undo remains available during pause only within its ten-minute window and when its complete postimage is unchanged. Move/bulk Undo, calendar Undo and cascade Undo already follow this policy. Continuation Undo must accept both protected modes; it still validates ownership, expiry, complete postimage and the untouched created row. Pause is not permission to overwrite subsequent edits.

## Retention

| Receipt | Short-lived content | Durable proof |
| --- | --- | --- |
| scheduler_action_receipts | move/skip before_state; continuation result.row | operation/owner/goal IDs, request_hash, after_hash, compact result including continuation rowId, timestamps |
| scheduler_calendar_receipts | full before_state and after_state | operation/owner IDs, request_hash, after_hash, compact result, timestamps |
| cascade_shift_receipts (inherited) | request, full before/after snapshots and moves currently remain | existing replay contract compares full request |

New calendar Undo rejects at ten minutes even if maintenance has not run. Successful calendar Undo clears its snapshots immediately. Continuation replay resolves its retained rowId against the current owned lesson; it must not reconstruct deleted content or insert again. A confirmed replay with no remaining row requires a client refresh, not an invitation to retry creation. The original continuation row is kept only for the short Undo window.

`rooted_private.expire_scheduler_receipts(limit)` scrubs expired or undone action/calendar payloads. Each table processes at most `limit` records (default 500, maximum 2000), ordered by age with `FOR UPDATE SKIP LOCKED`; live requests do not wait behind this maintenance. It returns counts, keeps replay IDs and hashes, and leaves lesson/goal records untouched. It is private and executable by neither authenticated clients nor service_role. The prior `expire_scheduler_undo()` entry delegates to the bounded implementation.

**Physical deletion is not automatic at ten minutes.** This patch installs no scheduler and does not invoke maintenance. Before cohort activation, approve an operational maintenance cadence and backlog monitoring; the retention duration is ten minutes plus that cadence/backlog. Repeated calls drain a backlog without unbounded transactions. Keeping compact replay proofs avoids admitting delayed duplicate requests after payload expiry. A durable-proof deletion horizon requires a separate replay-lifetime design.

Do not scrub the inherited cascade receipt through this function: its full request comparison and snapshot schema need a separately reviewed compact-proof migration. Existing Builder/daily receipt retention is also inherited. These are release retention limitations, not permission to claim all scheduler snapshots have bounded storage. No automatic purge, hosted cron, or old receipt rewrite is authorized by the local patch.

## Local validation scope

`retention-test.sql` runs in a transaction and rolls back all synthetic receipt inserts and scrubbing. It checks expired action content removal, continuation rowId preservation, calendar snapshot removal, unchanged request/after hashes and compact result, and private ACLs. Run against the isolated loopback Colima database after integrating current calendar/history definitions. Real RPC replay/Undo during pause and post-expiry belongs in the integrated synthetic regression before release.

### Rehearsal retention contention result

Executed `synthetic-runtime/retention-locks.py` against **only** `rooted_containment_rehearsal` in isolated Colima. Eight checks passed: invalid limits (NULL/0/2001) have no effects; limit 2 changes exactly two eligible receipts; repeated bounded calls drain four then return zero; unexpired payload and durable hashes/results remain unchanged; transactional inserts/maintenance roll back; a second session skips a locked receipt under a one-second statement timeout while scrubbing the unlocked receipt; both lock/maintenance transactions roll back; the authorized committed seed is deleted, restoring both receipt tables to their initial count of zero. No main database connection was used. Parent separately confirmed the basic transactional retention SQL test passed.

## Operator rehearsal

`retention-local-operator.py` is hard-wired to the isolated empty rehearsal database, verifies loopback container identity, limits rounds/batch sizes and uses transaction statement/lock timeouts. It prints scrub counts, latency, remaining backlog and an alert flag, returning exit 2 when backlog remains. A synthetic seven-receipt rehearsal proved alerting and subsequent drain, retaining every compact proof, then removed its receipts. This selects no hosted cadence and installs no automatic job. A proposed five-minute privileged maintenance cadence would target a 10–15 minute payload lifetime absent backlog; the actual cadence, monitoring and owner require release approval.
