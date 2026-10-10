# Narrow current-lesson candidate

Base: recorded live source `fddea641709c6cdbd7b97a5d6e757bc8592b9bd1`.
Branch: `fix/current-lesson-release`. Derived from the reviewed concern in `2ffbaffa2dc7de8d967f343b9947014c94b9567c`, not a cherry-pick of its recovery branch.

## Included behavior and availability

Two runtime files: Builder page preflight and new read-only `builder-resume-guidance.ts`. A backwards next-lesson edit behind recorded progress refuses before any Builder write. It recommends the existing “I'm actually on...” menu only after a fresh read finds matching `atomic_v2` state, one unfinished selected lesson, and the real recalibration planner can date that selected lesson. Legacy, paused, malformed/unreadable, completed, missing or unresumable targets receive honest review-needed wording. The action itself rereads/validates; advice does not reserve future availability.

The usable Builder and Plan menus, explicit resume, durable client journal, server command, and Undo already exist byte-identically in the live base. Earlier local actual-UI acceptance on the recovery branch exercises those same implementations (see its ACCEPTANCE-REPORT.md). This candidate does not add history restoration, an arbitrary schedule mover, auth changes, auto enrollment, migrations or data repairs. The two recorded Kandl target courses are already protected per production completion receipt; freshly read definitions/modes must be checked before any proposed release. Legacy multi-step recalibration is not newly atomic, and selected pins/preservation may be released by the explicit chosen resume. Other protected work is preserved or the command refuses.

## Independent review and database verification

Independent implementation review caught and resolved the original blanket referral to unavailable legacy preserved resume. Reviewer traced actual menus/client/journal and transaction SQL, then reran 51 pure tests; no remaining blocking finding in the narrowed candidate. See INDEPENDENT-REVIEW.md.

The existing transaction locks request identity, goal, lessons, profile and owner calendar; compares exact snapshot/day; validates projection and field/membership preservation; saves receipt and changes in one transaction. Local database tests clone the installed live-chain template only: no migrations are applied. They verify projection-failure rollback, newer-note conflict, completion/time/pin/other-child preservation, identical replay, altered-token refusal, newer-work Undo refusal and exact bounded Undo plus already-undone replay. `database-results.json` contains exact database/function fingerprints. This verifies that local template, not fresh hosted definitions.

## Inventory and rollback

New migrations: **none**. Mode changes: **none**. `migration-inventory.json` lists and SHA256-checks the seven existing recorded release migrations, including preserved cascade/locks and protected scheduler containment. Dependency manifests/auth source/scheduler SQL are unchanged.

Rollback is application-only to the exact prior verified deployment. Keep existing server functions, protected modes and receipts: new candidate writes the same existing request shapes and receipt format, so the prior deployed UI understands them. Existing Undo is ten minutes and refuses changed after-state; deployment rollback never reverses family records. Do not drop SQL, revert modes to legacy, or replay a new operation to guess an old result.

## Verification and known limits

- Exact narrow-tree focused suite: 786 tests, **778 pass, 8 pre-existing skips**, zero failures. Includes required scheduler tests, Builder/current guidance, recalibration, phase2, cascade, preservation, journal and daily reconciliation.
- TypeScript and lint of changed library/test files pass.
- Whole Builder page retains baseline one `react/no-children-prop` error and two unused-variable warnings. They are unchanged unrelated lines; no global lint-clean claim.
- Existing skips remain: two `planCompressAfterExtra`, five `planAddToNextSchoolDays` density cases, one explicitly unresolved save-day disappearance characterization. No skips added, deleted or represented as solved. Their potential broader scheduling impact remains a release caveat.
- Commit-exact compiler rehearsal is recorded separately after commit; it is local with blocked external egress, existing dependencies, test font fixtures and test environment. It does not replace hosted identity/smoke verification.
- No hosted writes, deployment, push, migration, real account UI, private Chrome, auth settings or reset rehearsal action occurred. The blocked separate security audit stays stopped.

## Hosted verification plan — requires separate authorization

Use a new dedicated scheduling-only preview project/alias and disposable backend or an explicitly reserved independent environment. Do not use or modify auth-reset task `01a12692-e652-70d9-b5ac-ce05ab990004`, its project/alias/backend/private Chrome, nor shared PR #146 staging. Confirm exact commit/build digest/backend identity and expected function fingerprints first. Provision only synthetic fixtures after authorization; never use a real family's records.

1. Verify protected and legacy courses across two synthetic children. The backwards Builder field must make no writes; only usable protected targets get the menu direction. Confirm unavailable/paused/read-error targets show review-needed refusal.
2. From both Builder and Plan menus, resume unfinished lesson 2 behind completed 1/3/4 with notes/time and manual pins. Leave history choice No. Compare row IDs, completions/timestamps, notes/photos/time, other pins/children; selected placement release must match displayed intent.
3. Reload/reopen, inspect Today and Plan, then ordinary Builder rename/Save in the same session. Verify no pointer regression, duplicate completion or hours. Check report totals.
4. Drop committed recalibration responses, reload and Check saved changes. Confirm same operation receipt and no repeated movement. Add a newer note/completion between read and commit; require conflict and preserve new work. Check bounded Undo and refusal after newer work.
5. Original weekly forward-shift case, reopen, next-day boundary and unrelated course/child preservation; verify exact schedule dates, no stacking/backward pull. Confirm protected-mode behavior survives application rollback without SQL rollback.

Only after reviewed hosted results and a specific release approval should a deployment/promotion be proposed. No deployment is authorized by this packet.

## Estimate

The narrow implementation, independent review, pure regressions and local database checks are complete. Allow **2–4 focused engineering hours** for packaging the separate hosted fixture, executing its acceptance matrix, and reviewing results if access/environment are ready and no defect appears. A failure or source/database drift requires re-estimation. Owner-dependent time is separate: approval and allocation of an isolated hosted environment, then final release approval; no defensible elapsed-time promise while those are pending. Broader legacy atomic enrollment and historical restoration are excluded and are not covered by this estimate.
