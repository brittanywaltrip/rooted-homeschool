# Fixed calendar operations — local draft

`calendar.sql` and the calendar helpers in `scheduler-contained.ts` replace protected PlanV2 calendar writes. Installation alone activates no course. Backend integration/independent review must pass before release.

## Preserved behavior

- Add without shift, edit and end-now change calendar metadata only. Stored lessons remain byte-for-byte unchanged. The existing distinction between stored dates and projection under a changed calendar remains; these choices do not promise re-projection.
- Add with shift uses the existing profile-school-days mapper, including lowercase full day names, break-interior ordinal mapping and one-offs. Every currently incomplete row with a scheduled date on/after the break start is included. A completed row is untouched. An unfinished preserved row that would move refuses the entire operation, without clearing its marker.
- Remove with shift is an explicit inverse request against fresh current membership and the current break period. It is **not** represented as restoring the original creation membership. `shift_applied = false` retains the old no-shift behavior.
- Receipt Undo restores exactly the calendar mutation and date/source changes made by that operation. It refuses after any later owner lesson/goal/calendar or relevant profile change, including notes, time and completion. A repeated Undo is idempotent.
- Pins, preservation flags, notes, time, completion, identity, queue slots and goal pointers cannot change. Only confirmed targeted `date`, `scheduled_date`, `scheduled_source` and their normal `updated_at` may differ.

## Transaction boundary

Read returns all owned goals (including archived), all owned lessons (including one-offs), all owned vacation blocks, and the relevant profile school-days/timezone values. Commit compares that entire preimage under deterministic locks. Fixed actions are add/edit/remove/endnow; caller-supplied arbitrary column patches are rejected. SQL verifies every supplied target using teaching-day counts and exact row membership. It does not silently choose different dates.

Locks are NOWAIT and acquired in the same order for commit/Undo: goals table membership lock, ordered owned goals, lessons table membership lock, ordered owned lessons, owner profile, vacation table, operation advisory/receipt lock. Failure rolls back the inner transaction, including partial capabilities, calendar changes and receipts. Private capabilities permit only the validated changed row IDs/fields and calendar operation; the shared calendar guard must recognize that operation only for vacation writes, never timezone edits.

**Material contention cost:** table membership locks briefly conflict with other families' writes. They prevent phantom inserts/deletes that owner-row locks alone cannot exclude. Measure realistic family sizes and concurrent traffic before release; do not weaken these locks without replacing the membership guarantee. This design is a bounded first implementation, not a claim of production throughput readiness.

## Retry and validation

The UI retains the original operation/preimage/target list, retries an ambiguous transport outcome once, and keeps it across busy/stale replays until an owned receipt confirms success. A different calendar choice cannot replace an unresolved operation. These attempts are in-memory for the current browser client; after a full reload the user must review actual state.

Expected local integration matrix: add with/without shift; edit; end-now; explicit remove inverse; existing pins and notes unchanged; preserved row refusal before writes; full/lowercase school-day parity; one-offs; completed rows; fresh membership drift; lost commit responses; wrong-owner request/receipt; target or field injection; mid-operation failure rollback; busy lock release; exact Undo; Undo refusal after later notes/time/completion; capability cleanup; concurrent activation/calendar/profile changes. Test all cases on the isolated synthetic backend only.

No calendar migration, cohort activation, hosted write, settings change, customer repair or publication is authorized by this draft.

## Validation recorded in this local session

The isolated Colima/PostgREST rehearsal passed **16 checks**. It used a separate synthetic auth user, child, school year and course. On cleanup, the pre-existing lesson, goal, vacation and profile snapshots were exactly equal to their starting values. Disposable course/entities and calendar receipts were removed. Evidence lives in the task workspace's `synthetic-runtime/calendar-postgrest.py`, `calendar-postgrest.txt` and `calendar-postgrest-results.json`; the actual TypeScript lost-response/Undo bridge is `calendar-client-bridge.mjs` beside this document.

Passed: transactional SQL compilation; metadata-only add; exact add Undo and already-undone replay; real TS mapper with lowercase school days and two lost responses; explicit inverse and its own Undo; extra-field/other-owner refusal; forced failure after calendar insertion during a lesson update with full rollback; edit/end-now/remove with exact Undo; later-note stale/refusal; preserved unfinished refusal; NOWAIT contention/partial-lock release; SHA256 receipts; 10-minute Undo expiry with snapshot scrubbing and durable replay identity.

**Explicitly unrun:** a live true-pin + one-off + completed-row combination, concurrent calendar/profile/activation races, and production-size throughput/contention measurement. These remain release gates. No additional DB matrix was run after the parent reserved the backend for final retention/pause checks. Unit coverage covers the calendar mapper and receipt retry routing; it does not replace these outstanding integration gates.

Undo snapshots are nullable and scrubbed after successful Undo or a 10-minute expiry. Compact request/after hashes and result survive so retries remain idempotent. The separate receipt-maintenance implementation owns scheduled/explicit expiry cleanup. Metadata-only cache/projection differences are retained legacy semantics and are not claimed repaired by containment.
