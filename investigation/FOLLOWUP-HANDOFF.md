# Follow-up: historical collision reproduction and isolated preflight candidate

## Latest user direction

No customer questions. Use synthetic fixtures and existing read-only evidence; do not write to the customer's or Brittany's account. Earlier discussion of asking the customer in GAP-SEMANTICS.md is superseded. Parent owns Supabase/PostHog reconstruction. No production, staging, migration, deployment, email, push or real-account action was performed here.

## Strong new evidence: exact synthetic historical fingerprint

The browser harness executed the actual historical `handleShiftAllForward` and `reprojectGoalTail` callbacks from `38b9bb8^`, with the automatic reconciler switch false, against synthetic rows and a local RPC model using `planQueueMove`.

| Weekly fixture | Trigger after move | Following lesson after move | Historical event |
| --- | --- | --- | --- |
| Sunday, 53 lessons, 1 complete | lesson 2, slot 3, Sep 27, pinned, plan_move | lesson 3, slot 2, Sep 27, unpinned, wizard_create | shift_forward_cascade, 1 school day, 52 succeeded, 0 failed |
| Tuesday, 53 lessons, 2 complete | lesson 3, slot 4, Sep 29, pinned, plan_move | lesson 4, slot 3, Sep 29, unpinned, wizard_create | shift_forward_cascade, 1 school day, 51 succeeded, 0 failed |

These exactly match the parent-provided pair shapes and event counts without using customer rows. The old callback:

1. `move_lesson_to_date` moves/pins the trigger and reorders the neighboring slots.
2. `reprojectGoalTail` unpins the rest, calls `reconcileGoalScheduleCache`, and unconditionally returns `ok:true` if unpinning succeeded.
3. With `NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED=false`, the reconciler returns without any dates changing.
4. The caller reports `snapshot.length` succeeded, even though the tail did not move. Thus success telemetry did not prove a successful shift.

This is a **strong causal candidate**, not unique proof of the deployed bundle or flag at the moment. `38b9bb84d489d54f824a008daed458010e34f1ea` (Sep 21, 10:14:52 -0700) separated parent writes from the automatic switch. `4b14d08899c15c3ba18e974a170daf7d33c24256` (Sep 24) added keep-slot moves. A deployment lag or still-open older bundle could explain the older behavior after the first commit existed locally. Verify through historical deployment/release/bundle evidence if available; do not infer from today's environment.

## Browser evidence and its limits

`node investigation/cascade-browser.mjs` runs a loopback-only local server, blocks non-loopback browser requests, renders the actual CascadeChoiceDialog markup with React, and invokes actual extracted callback bodies. The app shell, storage, and RPC are local stubs; RPC rules use the existing pure move planners. It is a **browser-level component/handler reproduction, not a full logged-in app or PostgreSQL end-to-end test**.

Eleven cases passed:
- Frozen-code Tuesday gap compression.
- Candidate Tuesday and Sunday gap refusals, zero writes and every row unchanged.
- Move-one keeps a deliberately spaced tail.
- Regular weekly shift-all.
- Repeated weekly shift-all.
- Holiday shift-all.
- Move-one holds the next week's own lesson (intentional same-day stacking).
- Repeated gap refusal stays write-free.
- Both historical Sunday and Tuesday collision/success fingerprints above.

Screenshots and structured results: `../investigation-evidence/isolated-browser/`. Run log: `../investigation-evidence/isolated-browser-run.txt`. The refusal screenshot was visually checked. The harness only uses deterministic synthetic dates and the lesson labels L1/L2/etc.

The sandbox initially blocked opening a loopback listener; the authorized local-browser command subsequently ran with tool approval. No blocked GitHub or account query was retried.

## Separate production candidate: preflight containment

New files: `app/lib/cascade-shift-preflight.ts` and `.test.ts`.

Before moving the trigger, `handleShiftAllForward` calls `checkCascadeShift` over its snapshot, the goal, breaks and current local day. It computes the existing projector's hypothetical output around the moved trigger and compares each row with the dialog's promised teaching-day offset. It refuses if the source changed, a tail would compress, earlier work/pins would change, the projector cannot date a promised row, or capacity means the promise cannot hold. The cascade's snapshot now includes completion/skip/backfill flags. Existing fallback tests stub the new preflight so they still isolate the RPC-response branch.

This candidate prevents the current gap-compression result. It **does not implement successful shifting of deliberately gapped schedules**. It is a containment patch: regular schedules keep working; unsupported shifts explain that nothing moved. It must not be presented as the complete solution to the family's request.

Why not simply shift every row's date: unpinned date-only writes get overwritten or disagree with Today; pinning the entire tail freezes auto-roll and is explicitly prohibited by the existing scheduler invariants. Durable gap-aware scheduling needs a deliberate design and cross-surface tests. Existing manual anchors might be shifted and preserved selectively, but that is insufficient for unpinned gaps and uneven capacity and is not implemented here.

Remaining technical limits: preflight and writes are not one transaction, so concurrent changes after the snapshot remain possible. The existing goal reads are not paginated. Trigger and tail writes can still fail independently. The candidate does not reconstruct or repair pre-existing swapped queues or overlaps. Do not treat the guard as a transaction guarantee.

## Verification

On the isolated candidate checkout:
- 16 direct preflight/fallback tests passed.
- Full suite: 2,071 tests, 2,063 passed, 8 existing skips, zero failures.
- TypeScript `--noEmit --incremental false`: clean.
- Changed-source ESLint: zero errors, the same 12 existing Plan warnings.
- `git diff --check`: clean.
- Eleven browser harness cases passed, including exact historical success fingerprints.

## Branch isolation and concurrent-edit incident

Frozen independent-review checkout: `/Users/brittanywaltrip/Documents/Codex/2026-10-08/task-6/rooted-kandl`, unchanged at `beb53fa9479dc63ed723a519637a6d7eafcf947d`.

Initial analysis commit: `cfe38a4c82cf93a67d24df5b99ab70f3ef7063c0`, child of beb53fa. It contains only the gap analysis and six characterization cases.

While working in `rooted-gap-analysis`, another worker added `cascade-preview.ts` / `.test.ts`, `cascadeMatchesPromisedDates`, and `browser-repro.mjs` to that same checkout. Concurrent edits briefly produced duplicate guards and a duplicate test property, invalidating that mixed-checkout typecheck/browser attempt. I copied my implementation into a new independent local clone:

`/Users/brittanywaltrip/Documents/Codex/2026-10-08/task-6/rooted-gap-preflight-isolated`

Branch: `fix/cascade-shift-preflight-isolated`, based on cfe38a4. I then removed ONLY my duplicate import/check block and duplicate test property from the old analysis checkout, leaving the other worker's helper/harness and their implementation in place. My untracked standalone helper/test/harness files remain there as copies; do not stage them indiscriminately. All successful candidate results above are from the isolated checkout, not the mixed one. No changes were made to frozen rooted-kandl.

## Privacy-preserving impact estimate (proposal, not executed)

Do not count every Rooted family as affected. Separately quantify:
1. Distinct internal users/goals with `shift_forward_cascade` events during the historical vulnerable bundle interval, grouped by day/release if available. Return counts, not emails/names/titles/raw payloads.
2. Within those goals, count potential fingerprint matches: trigger row pinned with plan_move; adjacent book lessons in swapped queue slots; same stored date for trigger and next lesson; next lesson retaining an older source; incomplete and not skipped. This is a suspected-exposure cohort, not confirmed corruption.
3. Separately estimate current gap-compression exposure by simulating the cascade preflight read-only on event-linked goal snapshots where available. Current rows alone cannot prove a historical gap was user-intended.
4. Report event coverage gaps and whether the data is historical or current. Intentional manual stacks are permitted, so generic overcapacity is not a reliable impact count.

Use existing authorized evidence access. Do not retry canceled queries, widen to private content, or export identifiable row sets unnecessarily. No new impact scan has been performed by this task.

## Reconstructing a reset without asking the customer

Try available per-move events, historical row/audit snapshots, and PostHog session/release evidence for these two exact actions. Screens or analytics may corroborate dates but are not an authoritative full row snapshot. The identified bulk event lacks prior dates, prior pin states and the changed row set. In this old path the entire tail was unpinned, so swapping two slots back alone cannot prove an exact undo.

If a historical database backup or point-in-time snapshot exists, a separately approved isolated restore could supply a before-state for comparison; never rewind the live database. Compare each candidate row against all later completions, notes, minutes, edits and later scheduling actions. Build a minimal checked before/after repair plan and rollback manifest. Without that evidence, report a proposed reconstruction with uncertainty, not “reset to before the move.” The original change in the customer's goal may have additional effects beyond the two visible collisions.
