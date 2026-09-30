# Batch five, prepared: 35 ambiguous lessons, completion-only (2026-09-30)

Nothing was written to production. The script change and a staging rehearsal are done, and the 35
lessons were re-checked read-only on production. It needs approval before anything is applied.
Family labels follow `RECOVERY-REVIEW-40-ambiguous-2026-09-30.md` (K to Q).

## Tested commit: 2c1a38d

Changes to `apply-template.sql`, on top of 98eda88:
- **Ambiguous lessons only as completion-only.** `REVIEW_slot_ambiguous` is accepted only with
  `v_completion_only = true` and an explicit `v_lesson_ids` list of full lesson ids. HOLD classes
  are still refused outright.
- **Schedule Builder guard, after the locks, from live data (completion-only).** For each target,
  the run computes the curriculum's highest completed lesson_number as it will stand after the run
  (all targets excluded). It aborts, listing the lessons, if a target is open, unskipped, above that
  floor, and carries no work (blank notes and `minutes_spent` NULL). This mirrors `planPhase2Rows`
  exactly:
  - `completedFloor` = max lesson_number over completed rows (`scheduler.ts:2612-2615`);
  - delete when `!completed && lesson_number > completedFloor` and not held back (`:2633-2643`);
  - work = non-blank notes or `minutes_spent != null` (`:2617-2618`);
  - `isBehind` needs a slot (`:2572-2573`), so it never protects a slotless lesson;
  - a pin protects only on saves that leave the schedule fields alone, so the guard ignores pins.
- **Unchanged guards:** fingerprint and live reclassification after the locks (class, start,
  pointer, archived); whole-row checks on other lessons and on every untargeted inventory row;
  targets must end unslotted; pointer, below-start and duplicate-slot guards; allowlist
  missing/duplicate/wrong-class checks.

**Correction to earlier docs:** "record history" only backfills brand-new curricula
(`historyRequested` needs `dbId == null`, `schedule/page.tsx:598-600`). On an existing curriculum a
lesson deleted by the Builder is gone; it is never re-created as completed. The completion-only and
40-lesson documents are corrected in the same commit.

## Staging rehearsal (the exact committed script)

The staging function body matched 2c1a38d (hash b71cb837..., 244 lines; only `v_classes`,
`v_lesson_ids` and `v_completion_only` are parameters). The synthetic family had six curricula:
- **R1:** 20 lessons, ten reordered, two empty slots, both affected lessons below the start.
- **R2:** two empty slots, two affected lessons pinned on past days at or after the start.
- **R3:** two affected lessons; lesson 5 would be Builder-exposed (floor 4), lesson 3 is safe.
- **X1:** an unlisted ambiguous curriculum.
- **X2:** one held lesson (15 minutes logged) and one ambiguous lesson.
- **P:** a certain-slot lesson.

Later parent work after the replayed damage: a 30-minute completion in R1 and a note in R2. The
inventory was frozen with the committed `inventory.sql`.

| Test | Result |
|---|---|
| Ambiguous class with a list, completion-only off | Refused |
| Ambiguous class, completion-only on, no list | Refused |
| HOLD class requested | Refused ("HOLD rows are never written here") |
| List includes the held lesson / the certain-slot lesson | Refused, naming each and its class |
| List includes R3 lesson 5 (Builder-exposed) | Refused: "would be exposed to Schedule Builder deletion... floor 4" |
| Live floor drop after the freeze (family un-ticks R3 lesson 4) | Refused (the pointer guard fires first; un-ticking that lesson also moves the pointer) |
| R3 lesson 3 alone (safe in a risky curriculum) | Passed (inside a rolled-back test) |
| Stale: R1 starting lesson 6 -> 3 | Refused |
| Stale: R2 lesson re-logged as an extra | Refused (now HOLD_relogged_as_extra) |
| Stale: R2 family ticks a later lesson (pointer 7 -> 10) | Refused |
| Change only to unlisted X1 | Did not block the listed run (rolled-back test) |
| Clean run (5 listed) | 5 un-completed, **slot still NULL**; R1's two below-start lessons unpinned and undated; R2's two kept their pins and dates; R3 lesson 3 unchanged otherwise |
| Repeat run | Refused (all 5 now HOLD_family_acted_on_row) |

After each refusal the fixture was byte-identical to its snapshot. After the clean run:
- The 54 other lessons were whole-row identical, including every excluded inventory lesson (R3
  lesson 5, X1, X2's held and ambiguous lessons, P), all still completed with classes unchanged.
- 6 of 6 pointers were unchanged, with 0 duplicate slots.
- The 30-minute completion, the note and all 8 rows with recorded minutes were intact.

**One finding, by design.** A drag that filled one of R2's two empty slots (leaving one, still with
two affected lessons) did **not** stop the run:
- The live class stayed `REVIEW_slot_ambiguous`, the pointer didn't move, and completion-only writes
  no slot, so the layout of empty slots is not part of these lessons' eligibility. Only the
  sign-off class compares slot evidence.
- That test was meant to roll back but committed on staging. Its result was itself correct (the
  same 5 lessons, slots NULL, nothing else changed), and the fixture was rebuilt for the isolation,
  clean and repeat tests above.
- If you want any empty-slot change in a target's curriculum to count as stale, the inventory would
  need to record each curriculum's empty slots at freeze time. That is a small follow-up, not done
  here.

Cleanup: all synthetic data, the frozen inventory and the functions were removed; 0 remain.

## Production re-check (read-only)

All 35 are still:
- `REVIEW_slot_ambiguous` in the batch-four frozen inventory, on the 09-25/26/27 fingerprint;
- in curricula with unchanged starting lesson, pointer and archived flag;
- without recorded time.

**0 are Builder-exposed** under the guard's exact rule, computed with all 35 excluded together.

## Preview: the 27 hidden lessons

| Family | Curriculum | Lessons | Lesson ids |
|---|---|---|---|
| K | cb201868 | 1, 2 | ed7a18ad-1ca2-4af1-b92f-03f5a948bbe3, 355d1a50-a8e6-4817-9a95-996cbfdfe93a |
| L | af251b44 | 31-39 | a9815257-7035-4fd1-9b27-a7b3c7762c66, 42e52fa1-14bd-48af-a49d-352c0c8e22ae, 5f95cf0f-1779-4261-be39-a4a0f590902d, f111fe85-df1e-4dbe-813e-a94fed569c60, be103808-ec76-4210-9bfa-3b4f52d9347e, c8fe2599-9746-478f-88a7-7b61021db46d, 9792015b-c320-49d8-81c5-05e9602817e8, 44330a48-e9fb-403e-b48d-6ecc62edf493, 1514cb20-4616-4d90-a850-84019e59fb5c |
| M | d5ff0d26 | 3, 4 | 6ce77730-8968-4951-9035-dbc29440abf0, 20222bdf-6d22-4110-b52f-258f7337ce98 |
| N | 1d2af23e | 8, 13, 16, 17 | cc6690f7-e41a-4026-9369-b89faf3d44cd, 8f1e58b4-4d2a-40a6-b1cb-13a8cba581cd, 5de511ab-d88e-4837-85c8-cc8179ef5cc4, 937d71aa-deab-4a41-b313-5d042f380923 |
| N | 255b9ed9 | 2 | 0e894880-4a25-443a-b83b-26f51b85692e |
| O | f0b2675a | 2, 3, 7, 8 | a09595b1-c3e3-4bac-bf37-ba4cfdaa0e1c, 46570b93-a2ee-4c17-8f70-596963677693, 80aa4d0f-d81e-4be9-bacc-868d5ca4b90f, b658e6b0-694f-4b85-808a-a69f97368a8a |
| P | 01d9bf53 | 5 | 4204d27c-21d5-4f13-87de-a42cdda057a2 |
| P | 7f00152c | 39 | 437023da-8941-453c-886a-85363aab0d28 |
| Q | 2d74cadb | 23, 26, 28 | ac9db6a1-e942-4523-b533-f1c03cfcb79d, 5b6ed098-fc34-4f9e-87c8-557af78ebc07, 48a5ad5f-eb0d-4124-b29e-314ed6e5d03f |

- **Today, the missed-work prompt and Plan:** no change. 26 are below their starting lesson (pin and
  date cleared by hide-below-start; old values in the backup), and 1 is already unpinned and
  undated.
- **Pointers:** unchanged.
- **Builder:** all 27 safe.
- **Counts and hours:** completed -27, estimated report and PDF hours -13.5 (K -1.0, L -4.5, M -1.0,
  N -2.5, O -2.0, P -1.0, Q -1.5).
- **Transcripts:** P's 7f00152c course is affected jointly with its group-B lesson (below); no other
  group-A curriculum has a linked course.

## Preview: the 8 lessons that reappear on Plan

| Family | Curriculum | Lesson | Original date (Plan shows it missed there) | Lesson id |
|---|---|---:|---|---|
| K | 22fdeaba | 3 | Aug 20 | 225388b0-be82-4502-a40f-6196170817b0 |
| K | 7ae3cc2d | 6 | Aug 22 | b46c607b-1389-476b-b10b-4c5ad54e407e |
| K | 7d8bfa2b | 3 | Aug 20 | 5fbc7a56-7ea4-4303-b8a8-65aa7343155a |
| K | a7ff8d0b | 5 | Aug 20 | 01323ddd-5c7c-4aca-99bf-a50aa87dd637 |
| K | a7ff8d0b | 6 | Sep 2 | 0215bdc0-4313-4e90-aef0-857f12d82abd |
| M | b5235fa4 | 3 | Aug 23 | a768c775-55c9-4be8-9a8a-b99e9116c678 |
| M | d5ff0d26 | 5 | Aug 24 | 475e52f0-983a-4f9e-b9ac-340171a0a2b3 |
| P | 7f00152c | 38 | Sep 25 | 55c29cea-7d59-4842-ad04-bf07286cea0c |

- **Affected families:** K (5 lessons), M (2), P (1).
- **Today:** no change. Today only shows slotted lessons, and none of these has a slot.
- **Plan:** each shows as a missed pill on its original date.
- **Counts and hours:** completed -8, estimated report and PDF hours -4.0 (K -2.5, M -1.0, P -0.5).
- **Transcripts** (calculated courses, next page open, groups A+B together): K 22fdeaba 3 -> 2 h,
  P 7f00152c 5 -> 4 h. K 7ae3cc2d, M b5235fa4 and P 01d9bf53 round the same.
- **Builder:** all 8 are safe (at or below their curriculum's highest completed lesson).

**How a parent resolves one of these from Plan** (code trace, origin/main). They open that day's
panel from the month grid (`index.tsx:6004-6008`); each lesson card has check, Edit, Reschedule,
Continue, Skip and Delete, none gated on a queue slot (`TodayLessonCard.tsx:344-386`).
- **Mark it done:** works. A past lesson opens the completion-date chooser: keep the planned date,
  or today (`completeLessonOnDate.ts`). It writes the completion and date and leaves the slot NULL.
  Nothing errors. The pointer doesn't move, because it only counts slotted completions. Once done,
  the Builder can never delete it.
- **Skip:** works. It writes `skipped = true`, clears the date and pin, and leaves the calendar. A
  skipped lesson is always kept by the Builder.
- **Delete:** works; the pointer doesn't move.
- **Reschedule / Edit date:** re-dates it and keeps it pinned and slotless (`move_lesson_to_date`'s
  NULL-slot branch). It shows on the new day and doesn't reach Today; it becomes missed again once
  that day passes. This moves it but does not resolve it.
- **Lesson search** finds it and jumps to its day; the search itself is read-only.
- **One caveat:** choosing "shift the rest" on another lesson in the same curriculum unpins a
  slotless pin (`reprojectGoalForParent`). All 8 are Builder-safe, so an unpinned lesson still
  survives a Builder save and stays on its date as missed.

## Proposed for approval

`v_classes := array['REVIEW_slot_ambiguous']`, `v_completion_only := true`, hide-below-start on,
and `v_lesson_ids` set to the 35 ids above:
- **the 27 hidden lessons**; and
- **the 8 Plan-visible lessons**, only if the Plan change is accepted. Otherwise approve the 27
  alone.

Held and untouched: group C's five (5072c4eb..., f38ed3cf..., d4bd38e1..., 7ff15341...,
597ac7cd...), Family E's four, and the six held lessons. Before applying:
- Re-freeze the inventory (Families P and Q are active) into a new batch table, and back it up.
- The run then re-checks everything, including Builder safety, under its locks.

## PRODUCTION APPLY, batch five (2026-09-30)

Approved: all 35 lessons above, including the 8 that return as unfinished on Plan. The script was
apply-template.sql at **2c1a38d**; the only edits were
`v_classes := array['REVIEW_slot_ambiguous']`, the exact 35-id `v_lesson_ids` and
`v_completion_only := true`. Hide-below-start stayed on.

**Before applying:**
- **Earlier batches preserved:** the batch-four inventory was renamed to
  `recovery_20260925_inventory_batch4` (51 rows). The batch-one to batch-three inventories and all
  earlier backups are unchanged.
- **Inventory refreshed and frozen:** 05:38:46 UTC, 50 rows: review 40, sign-off 4, holds 6.
- **Approved set confirmed unchanged:**
  - the 35 ids match this document exactly, and all 35 are `REVIEW_slot_ambiguous` in both the
    batch-four and the new inventory;
  - fingerprint intact, and starting lesson, pointer and archived flag unchanged;
  - no recorded time;
  - 26 below start plus 1 already hidden, and 8 visible on the approved dates;
  - 0 Builder-exposed, and 17.5 estimated hours.

**Applied:** 05:40:38 UTC. **35 rows written** in 14 curricula, and every built-in guard passed,
including the post-lock Builder guard.

**Batch-five backups** (rooted_private; access revoked from public, anon and authenticated):
- `recovery_20260925_inventory`: the batch-five frozen inventory, 50 rows
- `recovery_20260925_b5_backup`: all 50 inventory lessons before the apply
- `recovery_20260925_b5_backup_curricula_lessons`: every lesson in the 14 curricula, 1,191 rows
- `recovery_20260925_b5_backup_curricula`: the 14 curriculum rows

**Verification after the apply:**
- **The 35 reversals:** exactly 35 of the 50 inventory rows changed.
  - All 35 are un-completed with `queue_position` still NULL. Nothing else on the rows changed, and
    minutes and hours fields are kept.
  - **Hidden:** the 26 below their start are now unpinned and undated. The one unpinned, undated
    lesson at or after its start is unchanged.
  - **Plan:** the 8 visible lessons kept their original pin and date: K Aug 20, Aug 22, Aug 20,
    Aug 20, Sep 2; M Aug 23, Aug 24; P Sep 25.
- **Curricula:** pointers, starting lessons and archived flags are unchanged in 14 of 14. There are
  0 duplicate slots and 0 new lessons, and 0 targets are Builder-exposed after the run.
- **Parent work:** the other 1,156 lessons in those curricula are identical as whole rows, including
  all 130 of the families' own completions (66 with recorded time).
- **Hours:** estimated report and PDF hours fell by exactly **17.5**. The 35 targets carried 0
  recorded minutes, so **no recorded time was removed**.
- **Excluded lessons:** the other 15 inventory lessons are identical as whole rows and still
  completed: the 5 risky ambiguous lessons, Family E's 4, and the 6 held.
- **Earlier repairs:** batches one (165), two (35), three (7) and four (1) are all intact, with 0
  touched since their applies.

Now 243 of the 258 are repaired. Still pending, untouched: 5 risky ambiguous lessons, Family E's 4
and 6 held. The integrity routine is still paused, and no email was sent.
