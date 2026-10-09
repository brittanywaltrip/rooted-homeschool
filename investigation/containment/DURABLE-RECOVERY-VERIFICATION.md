# Local compatibility and durable recovery continuation

This continuation starts at a2ddd19393cb0b88ac59aca051252663f187269e. It remains a local review candidate with an empty activation cohort. No hosted migration, deployment, customer repair, push, merge, or communication is authorized by this document.

## Changes

Browser scheduling mutations persist the original UUID and payload before sending. Per-owner Web Locks serialize issuance and recovery across tabs. Unknown outcomes retain the exact request indefinitely; explicit recovery replays that request, including after reload. Confirmed completions and history insertions retain only a compact receipt identity and required tail source. A tail refresh clears only obligations captured before it started. Recovered changes preserve their supported Undo receipt. Definitive stale and rollback responses are distinguished from busy, transport errors, and generic invalid responses.

A fixed authenticated read-only recovery endpoint distinguishes active and archived courses from deletion proven by an owned retirement receipt. Archived work remains deferred. Verified course deletion supersedes obsolete requests and tails; it does not prove an absent operation never committed. Generic missing/other-owner results never authorize discarding recovery. Cascade receipts have an existing goal-delete cascade, so their absence cannot establish a no-commit outcome.

Compatibility changes support explicit edits/moves of preserved work, completed single moves with legacy semantics, preserved rows in calendar shifts, narrowly scoped school-year closing, and fixed cross-course reassignment plus receipt Undo. Numbered course slot holders retain the existing split/refusal behavior. Recalibration handles sparse book order, extra history, selected pin release, other pins, and backfill exclusion. SQL capabilities constrain exact rows/fields and postconditions check membership, business fields, and goal pointers.

## Verification before review checkpoint

- Aggregate: 2,327 passed, eight skipped, zero failures. TypeScript passed.
- Lost-response browser tests: edit plus reload/exact replay/recovered Undo; completion response loss plus reload, followed by tail-response loss plus a second reload. Original UUID/payload retained, one server write per operation, zero background failures.
- Everyday browser checks: actual reassignment/Undo, selected bulk placement/Undo, deferred deletion cancellation before sending and commit after the Undo window; Stop/Delete retain completed and unfinished recorded work. The initial combined harness timed out on a menu locator after its first five assertions passed; corrected lifecycle-only run passed. No claim of one uninterrupted combined success.
- API checks added: preservation seven; completed moves four; reassignment 14; recalibration four aggregate cases; midnight stale refusal; lifecycle recovery seven; silent trigger suppression for Add/Stop/reassign three. Existing Edit nine, placement eight, Add/delete 11 and history-healing regression matrix also passed during this continuation.
- Silent trigger suppression leaves no partial writes, receipt, or reusable capability. New reader refuses arbitrary missing/other-owner deletion proof.
- Full migration installation and exact function/ACL comparison were verified on an intermediate candidate. The final candidate must be reinstalled and compared, reviewed, compiled and checked using its exact commit identity; the external handoff records those final results.

Private synthetic credentials are not repository deliverables. Browser/API evidence lives under the task's synthetic-runtime directory. Harness retries and failed intermediate assertions are retained there; successful results do not imply all prior attempts passed.

## Remaining product and release gates

An explicit choice of a previously preserved unfinished lesson as “I'm actually on lesson X” is still refused. Whether this explicit choice should return that lesson to the active queue while preserving its notes/time, or require a separate move, is an unanswered product choice. Do not silently clear the preservation marker. This prevents claiming complete everyday compatibility or proposing restricted customer activation.

Destination migration fingerprints/order, client transition, retention maintenance, deployment identity, and rollback remain separate release-plan gates. Shared staging stays reserved for PR146. Exact customer row IDs/current versions are unavailable, and no executable customer repair may be inferred from approximate counts. The old whole-course reorder/respread path remains the reproduced original symptom source; this compatibility work is not evidence that a guard alone repairs Kandl's records.
