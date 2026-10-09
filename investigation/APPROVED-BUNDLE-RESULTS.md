# Approved local bundle and browser validation

The approved three-table/seven-function bundle is installed in the isolated Colima database. A newly exposed Builder preservation defect has a tested local TypeScript correction. The candidate is **not ready to release**: completion races reproduced deadlocks in six newly available RPC entry points, and the real midnight test remains unrun.

No hosted writes, customer-record changes, deployments, pushes, merges, migrations ledger writes, settings/access changes, new runtime, or system-clock changes occurred. Shared PR146 staging and the frozen source worktrees were not changed.

## Installed and verified

Installer: `synthetic-runtime/remaining-candidate-install.sql`, SHA256 `10f0f2c6d05876e00514bc88170ae7c50df00128794af99cb65ede2feebc6c61`.

The only additions were public.badges, public.user_badges, rooted_private.builder_commit_log; the private lesson_carries_work helper; both apply_builder_rebuild overloads; reopen_lesson; restore_queue_book_order; move_lesson_keep_slot; and move_lesson_to_date. Installation used the reviewed transaction, exact hosted metadata where applicable, and reviewed candidate Builder definitions. All 29 prior app functions and scheduler triggers stayed unchanged. Final readback confirms all 36 installed functions retain their body fingerprint, owner, ACL, and configuration. Badge columns, defaults, constraints, indexes, policies, owner, ACL and RLS match the reviewed metadata. Authenticated/anonymous roles cannot read the private Builder receipt table or execute its private helper; anonymous callers cannot execute Builder.

Evidence: remaining-install-verification.json, remaining-access-verification.json, remaining-final-readback.json, remaining-installed-catalog.json.

## Exposed defect and local correction

At head 70d68fd, two ordinary real Builder saves each retried four times and received HTTP200 with `failed: Preserved unfinished work cannot be rescheduled implicitly`. The database correctly rolled those attempts back. Builder had omitted queue_preserved from its reads and its row planner, so it tried to redate preserved prefix work.

The correction reads the marker for preview and saving; retains preserved holds even when ordinary pins are released; excludes preserved rows from make-up conversions, implicit redates and orphan-cleanup predictions; and rejects plans that delete, unpin, redate, convert or retire preserved unfinished work before calling the RPC. Shortening past preserved work is a safe refusal, not a supported implicit release. Three regression tests cover pinned/unpinned and behind/ahead combinations, scheduling pin release, shortening with or without family notes, and pointer advancement. Static wiring checks were updated to require the marker.

Changed implementation: app/dashboard/plan/schedule/page.tsx, app/lib/scheduler.ts, app/lib/phase2-commit.ts, app/lib/builder-settings-restore.ts. No database function was modified after installing the exact bundle.

## Real serial browser evidence

All browser requests were confined to 127.0.0.1:3106 and 127.0.0.1:54321, using real synthetic Auth and PostgREST. No response mocks or clock mocks were used in this phase.

- Two ordinary Builder saves after the correction reached the success page; full snapshots exactly matched the original marked baseline. These were no-op saves and did not invoke the commit RPC.
- A synthetic curriculum rename and restoration succeeded without lesson changes. These metadata-only saves did not invoke the scheduling RPC.
- On a separate three-lesson lifecycle course, two changed start-date saves invoked the five-argument Builder RPC and returned applied. A repeated unchanged save succeeded. Two Builder receipts remain. Lesson dates and the main marked cohort remained unchanged during those settings saves.
- Real Plan reopening of the completed preserved Sunday lesson returned requeued. Only that row's completion-related fields and its course pointer changed. Completing it again using its original planned day restored every original business field. Parent resync touched timestamps on some unchanged rows; the before/after files retain that evidence. No cleanup reset was necessary.
- Real Today completion and Plan reopening succeeded for a disposable lifecycle lesson, with no request failures in that flow.
- Real forward movement invoked move_lesson_keep_slot (HTTP200 moved); backward movement invoked the legacy move_lesson_to_date (HTTP204, empty response). The forward action pinned its target and one neighboring hold; the inverse restored the selected date and queue order but intentionally retained those move-created pins. Both actions were confined to the disposable course. Do not call this an exact Undo round trip.
- Garden read both badge tables with HTTP200. Its real badge pipeline awarded first_leaf and a garden-stage marker to the synthetic account. No creative tier was earned. Garden separately issued two affiliates-table 404 requests; affiliates is outside this installed bundle and was not added. Thus badge access/awarding is demonstrated, not an entirely error-free Garden page.

Evidence: marked-installed-builder-results.json; marked-confirmed-builder-results.json; marked-reopen-builder-results.json; marked-recomplete-verified-builder-results.json; marked-lifecycle-changed-builder-results.json; marked-lifecycle-repeat-builder-results.json; marked-lifecycle-badges-builder-results.json; marked-lifecycle-move-final-builder-results.json; marked-garden-builder-results.json; remaining-synthetic-side-effects.json. Earlier harness timeouts/selector and empty-204 parsing errors are retained separately; final claims use successful responses plus database readback, not process exit alone.

## Concurrency: confirmed release blockers

Actual separate authenticated transactions reproduced a deadlock for each entry point:

1. apply_builder_rebuild, four arguments.
2. apply_builder_rebuild, five arguments.
3. reopen_lesson.
4. move_lesson_keep_slot.
5. restore_queue_book_order, using an actually inverted two-row disposable queue.
6. move_lesson_to_date, using two ordinary disposable rows and completion-trigger cleanup.

For the first five, the RPC owns the goal while waiting on a lesson; completion owns that lesson and its trigger waits on the goal. The legacy mover has a different lesson-to-lesson cycle; it must not be described as having an upfront goal lock. Each test observed a real lock wait before triggering completion. PostgreSQL reported the deadlock, both sessions were rolled back, and exact snapshots matched the pre-race state. The temporary contention course was deleted afterward. Restore's cleanup-suppression flag was also verified to remain transaction-local and clear on rollback.

Evidence: remaining-locks-red-results.json and remaining-order-locks-results.json. Prior cascade/Undo/daily NOWAIT passes do not cover these functions.

Proposed next correction: separately review acquisition of the goal and every affected lesson in a deterministic, nonwaiting exception subtransaction, ensuring a refusal releases all locks. Keep-slot must cover neighboring holds; reopen and legacy movement must cover lessons touched by triggers. Preserve the void legacy RPC's error contract and verify that busy/refused calls never fall through to another writer. Test busy refusal with the refusing transaction still open, completion progress, exact no-write/no-receipt behavior, fresh retry and every serial browser flow before considering installation or release. This proposal was not installed or represented as a fix.

## Test results and scope

Final aggregate: 2,233 passed, eight skipped, zero failed (2,241 total). TypeScript passed. Changed library/test lint: zero errors, two pre-existing warnings. The broader app-page lint baseline's existing errors are not claimed fixed. All eleven PR146 compatibility invocations passed, including the native database Builder and calendar-window cases. An independent read-only review found the two initial edge gaps; both were corrected and rechecked.

The eight existing skips comprise seven obsolete pre-queue scheduling specifications retained for rollback and one explicitly unresolved save-day lesson-loss placeholder without a reproduction. This phase did not unskip or claim to resolve that placeholder.

Evidence: remaining-release-aggregate.txt, remaining-final-typecheck.txt, remaining-final-lint.txt, remaining-final-compat-results.json.

## Real midnight: unrun, bounded timing limitation

At actual PostgreSQL time 2026-10-09T16:29:52.916770Z, an inventory of supported regional IANA zones found no next midnight five to twenty minutes away. The earliest was 17:00 UTC, including Asia/Bangkok, 30.12 minutes away. This exceeds the approved maximum twenty-minute wait after readiness. No account or browser timezone was changed and no midnight pass is claimed.

A continuation prepared at 16:40–16:55 UTC could target the 17:00 UTC Bangkok boundary, after rechecking actual time. The existing three-lesson lifecycle course is retained for a positive control, but needs a deliberate before-midnight configuration with unpinned unfinished lessons due on the old day and a school-day pattern spanning the transition. Its current October9 daily receipt must be retained as evidence. Keep the original marked cohort unchanged. Follow KANDL-MINIMUM-ROLLOVER-PLAN.md for stale preview, fresh action, cross-midnight Undo, repeated reconciliation, Builder and completion checks. Stop within ten minutes after the boundary. No monitor or future run was scheduled.

Evidence: rollover-ready-boundary-assessment.json.

## Preserved runtime and release path

The local app was stopped after testing; the isolated database is retained. There are 107 lessons/four goals: the original104/three plus the clearly labeled three-lesson lifecycle control. Original104 lessons and three goals match the preserved baseline in every business field; updated_at values retain real UI activity. Four preservation markers and both selected anchors remain. Date audit count is4968 (ten added control-only date changes), schedule-intent and blocked counts remain zero. There are two Builder receipts, one daily receipt belonging only to the lifecycle course, and two synthetic user_badges. All old evidence and receipts remain.

Do not deploy or repair Kandl's records from this result. First resolve/review the six locking paths and complete the bounded rollover test; then reconcile the candidate against the exact proposed release revision, run the agreed isolated regression set, and produce an explicit release/rollback plan. Customer repair remains a separate account-specific before-image, exact proposed changes and rollback plan requiring approval. Avoid recommending another bulk shift or Builder rebuild as a workaround until the deployed behavior and account-specific plan are verified.
