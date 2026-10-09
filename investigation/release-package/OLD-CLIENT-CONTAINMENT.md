# Old-client containment design review — not implemented or activated

## Concrete gap

At verified main b9904b6, PlanV2's cascade first calls `move_lesson_keep_slot` with `holdBetween:false`, falling back to `move_lesson_to_date` only for unavailable/not-movable responses. It then calls `reprojectGoalForParent`, which directly PATCHes lesson dates and pins in multiple requests. Its Undo also directly restores rows. Even a fresh successful first RPC followed by refused tail writes leaves a partial action. Refusing only `move_lesson_to_date` is insufficient. A client-version banner or app deployment does not cancel requests queued by an already-open tab.

a108's Builder version1 expectation, daily preservation expectation and preserved-prefix trigger cover narrower cases. The trigger permits ordinary unpreserved tail writes; NOWAIT prevents reproduced lock cycles but does not change the legacy multi-request algorithm. General parent re-spread remains multi-request. These are real release gaps, not missing publication.

## Recommended bounded design

Use an explicit server-owned per-goal scheduling mode, default `legacy`, with reviewed transition to `atomic_v2` only after all required new paths exist. This is a proposal requiring new SQL/client code and tests; no mode column/table or customer marker was installed by this work. The flag is not a customer repair field and activation needs its own exact scope.

For protected goals, enforce the boundary at the database **before any scheduling write**. Cover OLD and NEW goal membership so a writer cannot evade it by detaching/reassigning a lesson. Cover inserts/deletes and goal dependencies, not dates alone. Do not rely on a browser header, client-selected scheduled_source, freely settable GUC or `current_user=postgres` alone as proof of an authorized operation.

One implementation option is a private, transaction-bound operation capability populated only by restricted internal helpers called from reviewed SECURITY DEFINER RPCs. Bind it to transaction, authenticated owner, goal, operation type and exact row/field scope. Browser roles cannot read/write it or execute its helper. Clean it on success and exception; it must not survive a committed transaction or be usable by a later request. Every RPC authenticates ownership, validates the complete expected state/day window, obtains goal/all relevant rows deterministically with NOWAIT, and compares exact postconditions. Capability scope is not a substitute for those checks.

| Writer/path | Required behavior in atomic_v2 |
| --- | --- |
| Old keep-slot RPC with hold_between=false | Refuse before its first change, with `invalid/client_upgrade_required` (parsed as failed, **not** unavailable/not_movable). Never manufacture PGRST202, which invites fallback. |
| Old legacy reorder RPC on curriculum | Raise an explicit non-missing-function error before mutation; retain the void contract. One-off rows remain outside this curriculum-only restriction. |
| Old direct lesson PATCH/unpin/re-spread/Undo | Reject scheduling-field changes, goal reassignment and scheduling inserts/deletes without the scoped trusted operation. Includes delayed requests already queued before activation. |
| New cascade and Undo | Existing atomic snapshot/commit/receipt behavior, extended to acquire trusted capability and gate mode. Receipt replay must precede fresh-write refusal where it can safely confirm an owned prior commit. |
| New single forward/backward move and Undo | New versioned expected-state RPCs with atomic authoritative Undo. Convert current direct `restoreLessonSnapshot` and legacy fallback; do not disable fallback globally before replacement exists. |
| Builder 4/5 overloads | Require guarded protocol; final implementation creates capability only for its validated transaction. Settings-only/no-op paths must also use an authorized goal-settings transaction. Preserve exact request replay and no misleading whole-Builder atomicity claim. |
| Daily reconciliation | Preservation-aware guarded RPC creates capability; obsolete direct queue-resync and old payloads refuse. Existing switch is honored, not silently toggled. |
| Completion/reopen/skip/backfill/continue/recalibrate | Audit and migrate any scheduling/pointer effects to reviewed atomic endpoints. Pointer triggers run inside that operation. Do not grant a generic bypass merely because `completed` also changes. |
| Goal start/pace/school-days/pointer/ownership/lifecycle | Gate plan-dependent changes and include their snapshot versions in operations; simple date-only lesson gating otherwise leaves a back door to conflicting projection. |
| Ordinary notes/minutes/content edits | Retain normal owner-scoped access when no scheduling/lifecycle field changes. Test triggers so a “notes-only” request cannot inadvertently enter a denied or privileged scheduling path. |

## Rollout sequence and supported failure

1. Implement capability/gate and all required RPC/client replacements locally; run the matrix below. Keep mode legacy; deployment alone must not mark family goals.
2. Validate a separate staging synthetic cohort, old/current bundles and network-delayed requests. New client loads server capability/mode and offers reload/review on upgrade refusal. Old clients may only show a generic error; explicitly plan this support experience.
3. During a separately approved scoped activation, lock the target goal and relevant rows, verify exact state, then change server mode. Gate triggers must serialize or fail NOWAIT against this transition, including already-started writes. Requests which committed earlier are captured in the fresh expected state; queued later writes refuse. No assumption that a waiting browser is idle.
4. Test refresh and ordinary safe logging before expanding scope. If an essential writer is not converted, **do not activate** for those goals. Do not temporarily disable the guard to get a passing test.

An emergency narrower refusal of hold_between=false plus legacy curriculum moves can prevent newly started old cascades, but does not contain queued direct tail writes or other old writers. It is not sufficient evidence for stable customer repair or full activation.

## Required acceptance tests (still locally fixable)

- Execute actual extracted old-main and older fallback cascade closures against real PostgREST: first call refuses with zero lesson/goal/audit/receipt writes and no fallback.
- Pause a cached client after its first RPC; activate gate; release its queued unpin/re-spread and Undo requests. All late writes refuse. Explicitly account for the earlier committed first stage in the activation before-image.
- Attempt direct PATCH, batch insert/delete, detach/reassign, pin/source spoof, and goal-setting changes; exact protected-state snapshots remain unchanged.
- Verify new cascade, both Undo modes, single earlier/later moves, Builder/settings-only/replay, daily, completion/reopen/skip/continue/backfill/recalibration and notes/minutes. Each success has expected exact changes; each busy/stale/refusal has zero unexpected effects.
- Test wrong owner/anonymous, capability forgery/reuse, exception cleanup, partial lock release, concurrent completion and activation, and lost responses followed by retry.
- Test legacy-mode/unrelated goals and one-offs remain unaffected; test projected/stored dates after reload and real midnight. Rehearse pause/resume without dropping state or reviving unsafe writers.

## Review verdict

Design is actionable but materially wider than the packaged migration. Keep this implementation and its regression work local; neither a push nor a draft PR is needed to finish it. Once implemented, it produces a new SHA, a new migration delta and updated evidence. a108 plus the packaging-only migration must not be described as old-client-contained or production-ready.
