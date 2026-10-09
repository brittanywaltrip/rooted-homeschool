# Remaining client writers and activation constraints

Read against the local release-package working tree during containment integration. Line numbers can shift as the Plan owner lands parallel fixes. A database refusal protects stored scheduling fields; it does **not** mean a client operation is converted or has acceptable success/Undo semantics.

## Material remaining behavior gaps

| Path | Current behavior for protected goals | Activation requirement |
| --- | --- | --- |
| `app/lib/scheduler.ts:664` `resyncGoalForParent` → `writeParentProjectedDates` → `confirmedLessonsUpdate` | Direct tail date PATCHes remain. A required re-spread refuses; callers generally report failure. A completion may already have committed before this tail step. | Do not claim fully working catch-up/completion re-spread. Either a bounded supported atomic replacement must land, or these composite operations need an explicit refusal before starting. |
| `app/lib/missed-work-answers.ts:71` `answerMissedYes` | Existing rows use contained completion and skip already-completed rows on retry. Missing-row insert at ~217 is still direct and refuses. Earlier completions can already be saved; `MissedCompletionError` reports partial completion and callers reload/keep the modal open. Later tail re-spread at ~260 can also refuse after completions saved. | Safe explicit partial failure, not a converted whole review. Missing-row recovery and required tail re-spread remain unavailable. Do not funnel this through history insert without preserving the offered date-choice/source semantics. |
| `app/lib/missed-work-answers.ts:277` `answerMissedNo` | Direct tail re-spread refuses visibly; answer marker is not written first. | Explicit unavailable operation; no silent schedule mutation. |
| `app/components/PlanV2/index.tsx` bulk completion (~4050–4220) | Individual completions use contained helper, but parallel same-goal calls may return busy/stale and the handler reports successful/failed counts. Tail re-spread is still direct. Undo ~4179 directly restores rows; protected rows refuse, then notice/reload. A mixed selection may undo only legacy rows. | Do not promise protected bulk completion Undo. Prefer a clear preflight refusal for unsupported composite behavior; broader conversion is not completed here. |
| Plan goal deletion (~2135) | Subject carry-forward metadata can save before protected unschedule/delete refuses. Error is visible. | Refuse protected goal retirement before metadata writes. Forwarded to Plan owner. |
| Plan stop curriculum (~2230) | At initial audit, both resolved errors were ignored and UI reported stopped. | False-success blocker forwarded to Plan owner; verify its final patch. |
| Plan deferred bulk delete (~3788, ~4444) | Active timer/flush checks refusal; unmount branch originally swallowed errors. One mixed DELETE statement is atomic under guard, so protected refusal prevents the whole statement. | Preflight before optimistic removal; do not claim unmount confirmation. Forwarded to Plan owner. |
| Plan Add/Edit (~1335, ~1816) | Protected inserts/placement edits refuse at one statement; modal surfaces raw database message. Content-only edits remain allowed. Add Undo ~1619 originally ignored resolved delete errors; edit Undo ~2044 checks errors/reloads. Activation between legacy Add and Undo exposes refusal. | Friendly protected refusal before unsupported schedule writes and checked Add Undo. Forwarded to Plan owner. |
| Builder `app/dashboard/plan/schedule/page.tsx:2637`, `3156` | Existing-goal scheduling settings use the atomic Builder RPC, including settings-only saves. Intent-guarded metadata can save earlier; multiple goals commit separately. Refusal copy acknowledges other settings may have saved. | Keep this distinction in release claims. A global all-goals transaction is not implemented or required for the narrow containment. |
| Builder archive/type change (~2580) and lesson wording (~4091) | Direct protected archive refuses and is checked. `lessons_per_unit` is in protected goal fields: the separate post-save wording write can refuse after schedule saved; visible wording-failed notice. | Explicit unavailable fields need documented UI constraints; do not call every Builder setting supported. |

## Today false-success fixes made in this pass

`app/dashboard/page.tsx` now checks resolved lesson edit/activity-edit errors before changing local state or closing the sheet. Child reassignment is preflighted before auxiliary subject creation. Protected deletion is refused before optimistic disappearance; delayed DELETE errors reload the saved rows and display failure.

Legacy Today reschedule paths (`runMissedAddToNextDays`, `runMissedPushBackNDays`, `rescheduleMoveTo`, `reschedulePushAll`, `rescheduleDoubleUp`, `rescheduleMissedDay`, and `undoReschedule`) now inspect **all targeted lessons and goal modes before the first write**. Protected targets receive an explicit unavailable notice; each subsequent response is checked, and an activation/transport race shows a failure and reload rather than success. These are refusal controls, not new scheduling implementations. Legacy multi-request operations retain their prior partial-commit possibility on a mid-action failure; the new message intentionally asks the parent to review saved state.

`confirmPriorLessonComplete` missing-row insertion remains unsupported for protected goals, but its thrown error now reaches a visible toast/reload instead of an unhandled rejection. Existing-row completion is supported by the contained completion helper, subject to the subsequent tail re-spread limitation above. Today `writeSkip` already checked errors/toasted/reloaded. Today `confirmExtraLessons` still performs one direct batch completion and checks the result: a protected refusal is visible and the statement is atomic; this bulk surface is unavailable rather than converted.

The Today changes use `scheduler-refusal.ts`; that helper never writes, fails closed on incomplete target reads, and leaves one-off / explicitly legacy goal actions available. Database guards remain authoritative against activation races.

## Evidence and scope

- The installed isolated cleanup correction was confirmed read-only to include minutes, and the 13 real API checks then passed. The dedicated case inserts a later history completion above an earlier notes-only, minutes-only, hours-only, or start-time-only row and compares that full earlier row exactly.
- 20 focused helper tests pass (including four refusal cases); 40 parent re-spread/recovery/completion tests pass. TypeScript and new-helper lint pass.
- This is a targeted inventory of the requested surfaces, not proof that every client writer in the entire application was audited. No hosted action or activation was performed.

Before activation, independently verify the Plan owner's false-success fixes and state an explicit supported-action list. Remaining refused composite operations must not be presented as fully converted. No broad new feature implementation is proposed by this inventory.
