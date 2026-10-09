# Protected scheduler containment — local candidate

Status: **not approved for activation or publication**. This branch adds local old-client containment and narrow replacement writers to the earlier preservation/lock package. No hosted writes, customer repair, push, PR, deployment or activation occurred.

## Problem and implemented behavior

The old Plan cascade calls a move RPC, then directly reprojects/unpins later lessons through separate requests. A later request or cached-client Undo can undo a valid protected schedule; the earlier pointer/daily guards do not cover ordinary tail writes. The real API matrix exercises a committed legacy first stage followed by activation and delayed direct tail/Undo/slot/detachment writes. Those later writes now raise an explicit refusal without changing protected state. New first-stage legacy move calls also refuse before mutation.

New private per-goal modes (`atomic_v2`, `paused`) and transaction capabilities authorize only reviewed operations and exact existing row/field or derived-insert scopes. Activation requires an exact full snapshot and locks; it is never automatic. Ordinary notes, minutes and title edits remain available. Goal/calendar/profile schedule dependencies are gated. A content edit can invalidate Undo, preserving later parent work.

Replacement operations cover single moves, skip/unskip, individual completion/deletion, recalibration, historical insertion, healing, continuation, and calendar changes. Existing cascade, daily, Builder and reopen implementations are wrapped with protection and NOWAIT acquisition. Durable operation receipts resolve ambiguous replies; exact unexpired Undo checks the whole postimage. Recalibration and historical cleanup protect notes, minutes, hours and start times. Current-client refusal handling was tightened in Plan and Today.

## Artifact and deterministic assembly

Apply neither migration remotely under this authorization. The existing `20261009174245_kandl_preserved_cascade_and_completion_locks.sql` remains unchanged. New CLI-created `20261009183309_kandl_protected_scheduler_containment.sql` is a second, single-transaction delta after that package and the reconciled PR146 prerequisites. `python3 investigation/containment/assemble.py` regenerates it and the review proposal from eight checked-in SQL sources. Manifest pins all source hashes. New migration SHA256: `9deeebc4fe5a9def751fe39c92ecdc1167451b9f4f21a4a9f227a30a790539fd`.

Exact baseline fingerprints cover the nine wrapped public overloads and cleanup trigger. The draft is not idempotent: duplicates/drift refuse, and must never be forced with loosened checks. Final source identity is the local commit containing this document; exact-commit build evidence is recorded separately under `synthetic-runtime` so no subsequent source rewrite is needed.

## Passed verification

- Aggregate: **2,280 passed, 8 existing skips, 0 failed**. Seven skips cover obsolete pre-queue behaviors; one historical save-day disappearance remains unresolved. TypeScript passes; selected changed helper/hook lint has zero errors. Existing broader lint failures remain, so this is not a full-lint pass.
- Core API: **25 checks** — actual TypeScript lost-response replay, bulk skip/unskip/Undo, delayed old tails, direct multi-row atomic refusal, activation lock refusal, owner/anonymous/private ACL, parent-content preservation, injected rollback, bounded lesson/profile/vacation/advisory contention and partial lock release, Builder replay and pause.
- History/healing: **15 checks**, including public history-wrapper lost-response retry, earlier work-field preservation, paused continuation Undo, payload scrubbing with live-row replay, and no replacement insertion after the original row disappears.
- Recalibration: **11 scenario groups**, including eight work-gap refusal cases, actual client retries and non-UTC profile/UTC-noon semantics.
- Calendar: **16 checks** — actual helper plus two lost responses, metadata-only/add/edit/end-now/remove, fresh inverse vs exact Undo, wrong owner/field refusal, injected rollback, preservation and later-edit refusal, locks, SHA256/expiry/idempotency. Separate disposable owner removed; original rows/goals/vacations/profiles compared exactly.
- Receipt maintenance: **8 checks** — batch bounds, invalid limits, live payload and replay-proof retention, backlog draining, and two-session SKIP LOCKED; empty rehearsal receipt tables restored.
- Complete migration installs in empty Colima rehearsal. Deliberate function drift causes transactional refusal with no new mode/read-state objects surviving. Rehearsal baseline reset initially left captured draft definitions; those metadata-only leftovers were removed before the final successful install. This is distinct from a target schema claim.
- Main tested installation and full migration rehearsal match **40 function bodies/security/search paths/ACLs** and all four private table RLS/ACL definitions. No active modes or reusable capabilities remain after fixture cleanup.

All database execution used synthetic isolated Colima. API clients use localhost only. No native PostgreSQL harness or hosted tests were used for this phase.

## Open activation/release gates

1. **Unsupported composite writers:** completion/catch-up can commit individual completion then attempt a refused direct tail re-spread. Bulk completion Undo, some add/edit/lifecycle/settings and recovery surfaces are not fully converted. See `REMAINING-WRITER-INVENTORY.md`; visible refusal does not equal supported operation. Do not activate a family needing these flows. Preflight is not a replacement for the authoritative guard during races.
2. **Real browser verification:** complete signed-in Plan/Today workflow and retry/reload E2E remain unrun; the existing local app schema lacks unrelated Today dependencies. No permissive schema stubs were added. API/helper tests do not replace this gate.
3. **Load and race coverage:** calendar globally locks membership tables NOWAIT, so unrelated families can receive busy refusals. Realistic family size/throughput, full pause matrix, calendar/profile/activation races, and explicit live pinned/one-off/completed calendar mix remain unrun. Existing single-family tests do not certify these.
4. **Retention operations:** new payload scrubbing is bounded but has no scheduled privileged invoker. Ten minutes is the Undo deadline; physical removal occurs when maintenance runs. Establish cadence, backlog monitoring and ownership before activation. Inherited cascade full snapshots remain outside this scrubber and need separate treatment.
5. **Other limits:** pending request identity lives in the current client instance; reload recovery is not certified. Error-only legacy response checks still do not prove a row was affected. Exact target schema/ledger/ACL/current source identity remain unverified remotely.
6. **Production build:** run the exact committed tree with the prepared isolated build runner. A pass is qualified by local test-font substitution, existing installed dependencies and synthetic endpoint configuration; actual font acquisition, clean install, hosted identity and runtime E2E remain unverified.

## Pause, rollback and safe proposed release path

Keep the protected cohort empty. After supported-writer and browser/load gates close, obtain approval for a truly isolated synthetic target and verify fresh schema/ledger/function/ACL identities. Shared PR146 staging must remain untouched. A push can create a Preview attached to the shared backend, and draft PR automation may perform credentialed smoke writes; neither is a harmless review-only step.

Capture exact schema/ACL/trigger/ledger definitions and a consistent recovery point before any separately approved installation. Install the two deltas in reviewed dependency order; no customer mutation or activation follows automatically. Test old and current clients against the isolated target. Scoped activation later requires fresh owner-specific full-state expectations and explicit customer-record/release approval.

On failure after committed protected operations, use scoped `paused` mode and a guarded forward correction. Preserve guards, markers and receipts; never downgrade to legacy or drop protection to make an old writer work. Exact owned replay remains available; unchanged unexpired Undo can remain available. The obsolete Builder-only pause artifact is not part of this package. Any customer-record rollback requires exact before/expected-after conditions and separate approval.

No new permission is needed for the remaining authorized local work. Publication, hosted configuration/migrations, maintenance scheduling, cohort activation, and customer repairs remain separate approval boundaries.
