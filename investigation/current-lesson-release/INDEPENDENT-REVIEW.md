# Independent current-lesson release review

Reviewed the uncommitted candidate in `rooted-current-lesson-release` against live source `fddea641709c6cdbd7b97a5d6e757bc8592b9bd1`. Review covered actual Builder preflight, the new `builder-resume-guidance.ts`, both menu entry points, recalibration client and durable journal, and existing transaction/Undo SQL in `scheduler_containment.sql`. No external, hosted, database, auth, or security-audit actions were performed.

## Findings

The prior blocking finding is resolved: the original blanket referral could direct legacy preserved courses to an action that explicitly refuses them. The revised helper reads existing state without mutation, requires the matching goal in `atomic_v2`, requires exactly one unfinished selected row, and requires the real recalibration planner to produce a date for that selected ID. Legacy, paused, unreadable and unavailable target cases receive review-needed refusal instead. The actual action rereads state and owns concurrency validation; this guidance is not an authorization or availability reservation.

No additional blocking defect found in this narrow candidate. The preflight remains before Builder writes. The new same-session regression shows an ordinary Save after explicit recalibration preserves the new pointer and only patches the independent rename, despite its older form baseline. Existing unrecorded-floor edits remain allowed.

## Database and scope

The usable menus, preserved-resume client and atomic transaction already exist in live source and are unchanged. The examined atomic transaction uses operation receipt replay, row/goal/profile/owner locking, exact snapshot and local-day checks, independent server projection checks, field/membership preservation certification, and receipt insertion in the same transaction. Selected pin/preservation release is explicit; it is not a promise that every pin is unchanged. Undo is limited to ten minutes and an unchanged after-state.

No migration or cohort enrollment belongs in this candidate. Retain existing modes, SQL functions and receipts on application rollback; do not revert protected courses to legacy. Existing legacy multi-step recalibration does not gain atomic guarantees from this release. The UI still exposes the existing action on legacy courses, but this new guard no longer recommends that unavailable protected resume.

## Validation and limits

Independent pure tests: Builder guidance, actual-page Builder adapters/preflight, contained recalibration and recovery journal. All 51 tests passed, zero failures or skips. These include the original 39 checks plus ten helper cases and two additional Builder cases.

Hosted verification remains required for exact release packaging and the mode-dependent UI flow, including two children, same-session recalibrate then ordinary Save, dropped recalibration responses, a newer-work conflict and reload. I did not freshly attest installed database definitions/modes or execute real transactions. No claim is made that existing skipped tests, unrelated lint diagnostics, all legacy scheduling, arbitrary completed targets or sparse queues are fixed. The narrow change safely refuses when it cannot establish usable guidance.
