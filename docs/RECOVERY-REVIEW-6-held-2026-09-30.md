# Review: the 6 held lessons (read-only, 2026-09-30)

Production reads only. Nothing was written, and no family was contacted. The lessons were
reconciled against the batch-five frozen inventory (`rooted_private.recovery_20260925_inventory`,
05:38 UTC), its backup `recovery_20260925_b5_backup` (all six identical to the backup), and the
batch-one backup (09-29 22:20 UTC). Families are labelled R to U.

All six still have `completed_at` = the 09-25 statement's exact fingerprint (2026-09-24
15:11:35.834303), so **every completion was written by the auto-heal, not by a person**. They are
held because something about the row changed or was recorded around it. That later work is what
this review separates out.

## Per lesson

### R1. Family R, curriculum 31203a47, lesson 5: held as "family acted on row"
- **Why held:** updated_at is 2026-09-28 17:56:17, after the run.
- **What that write was:** not family activity.
  - Between 17:56:05 and 17:56:31 UTC on 09-28, exactly three curricula in two families were
    rewritten, one statement per curriculum, each setting `queue_position = lesson_number`: this
    one, R2 below, and U1's.
  - These are the two families from the original queue-slot report.
  - `restore_queue_book_order` ("I'm actually on lesson X") only reorders slots a curriculum
    already holds. It cannot give a slot to a lesson the auto-heal had un-slotted, but this lesson
    now has one. So the 17:56 write was a slot repair aimed at these families (the same effect as
    the hand-run `scripts/fix-null-queue-positions.ts`).
  - No schedule transaction or intent was recorded for it. My first production write in this
    recovery was the guard at 20:54 UTC, so this is not from the recovery work, and I can't say
    from the data who ran it.
- **What it left:** the completion is still the auto-heal's (completed_at = fingerprint, completed
  true). The slot (5) was set by that repair. The pin and date (Sep 17, `plan_move`) are the
  family's own drag from before the run. No notes, no recorded time (hours 0, minutes NULL), no
  re-logged extra, no audit rows.
- **Classification:** auto-heal completion + a later slot repair + the family's earlier pin.
- **Recommend: recover completion-only, keeping the current slot, pin and date.** No slot is
  guessed or written.
  - The pointer stays 6 (lesson 6 is genuinely completed at slot 6).
  - The lesson is open at slot 5, behind the pointer and pinned on Sep 17: **Plan shows it as
    missed on Sep 17**, and Today does not show it (a pin at or behind the pointer is not
    projected).
  - Builder: slotted and behind the pointer, so always kept.
  - Completed count -1; estimated hours -0.5; no linked transcript.

### R2. Family R, curriculum 5c8888ad, lesson 29: held as "family acted on row"
- Same pattern as R1: written by the same 09-28 17:56:30 slot repair (slot 29), completion still
  the auto-heal's, the family's own pin on Sep 22 (`plan_move`). No notes, no recorded time, no
  re-logged extra.
- **Recommend: recover completion-only, keeping the current slot, pin and date.**
  - The pointer stays 34.
  - **Plan shows it as missed on Sep 22**; Today does not.
  - Builder: slotted and behind the pointer, so always kept.
  - Completed count -1; estimated hours -0.5; no linked transcript.

### U1. Family U, curriculum 2efa5424, lesson 2: held as "family acted on row"
- **Why held:** updated_at 2026-09-28 17:56:05, the same slot repair as R1 and R2 (slot 2).
- **What the family did first:** the row's source is `reopened`. `reopen_lesson` sets that only
  when a family **un-ticks** a completed lesson; it then re-pins it as a make-up (Sep 22 here). So
  the family had explicitly reopened lesson 2, and the auto-heal re-completed it on 09-25.
- **Recorded time:** minutes 30 and hours 0.5. `reopen_lesson` doesn't clear minutes, so this is
  left over from the completion the family itself reversed. No notes, no extra, and the only audit
  row is a 09-22 re-date.
- **Classification:** auto-heal completion of a lesson the family had deliberately reopened, plus a
  later slot repair.
- **Recommend: recover completion-only, keeping the current slot, pin and date.**
  - The pointer stays 3.
  - **Plan shows it as missed on Sep 22**, the make-up date the family's reopen created. Today
    does not (the date is past).
  - Builder: slotted and behind the pointer, so always kept.
  - Completed count -1.
  - **Reports lose 30 recorded minutes.** Those minutes belong to a completion the family had
    undone; the minutes value itself stays on the row.

### T1. Family T, curriculum b353e95c, lesson 14: held as "carries time"
- **Why held:** minutes 30, hours 0.5.
- **What the family did:**
  - The audit shows the family ticking it on 09-23 21:49 (role `authenticated`, new_completed
    true).
  - The source is now `manual_uncomplete`, and **skipped = true**: the family un-ticked it, then
    skipped it.
  - The auto-heal completed it anyway on 09-25. The row has not been written since
    (updated_at = run time).
- **Recorded time:** the 30 minutes come from the family's own 09-23 tick, which they reversed.
- **Classification:** auto-heal completion of a lesson the family had un-ticked and skipped.
- **Recommend: recover completion-only (slot stays NULL).**
  - Below the start (14 < 16), unpinned and undated: no change on Today or Plan.
  - Skipped, so the Builder always keeps it. The pointer stays 19.
  - Completed count -1. **Reports lose 30 recorded minutes** attached to the reversed completion;
    the minutes value itself stays on the row.

### S1 and S2. Family S, curricula 4a4e0d9d (lesson 9) and 4bcdda4c (lesson 21): held as "re-logged as extra"
- **Why held:**
  - On 09-27 at 02:33 and 02:38 the family logged extras titled "Language Arts · Lesson 9" and
    "Handwriting · Lesson 21" (source `extra_log`), both completed and dated Sep 24.
  - The numbered rows themselves are untouched since the run: slot NULL, unpinned, no date, no
    notes, no time.
  - The audit shows only the scheduler re-dating them 09-22/23.
- **Classification:**
  - The numbered rows' completions are auto-heal damage.
  - **The extras are genuine parent work** and must be preserved. The family did these lessons on
    Sep 24, and recorded them as extras, most likely because the numbered rows had been hidden
    (no slot, no date) by then.
  - Today each lesson is counted twice: once by the fabricated numbered completion, once by the
    extra.
- **Recommend: recover completion-only on the two numbered rows, leaving the extras untouched.**
  - This removes the duplicate while keeping the family's own record.
  - At or after the start but unpinned and undated: no change on Today or Plan.
  - Builder: 9 <= 10 and 21 <= 22 remain completed, so both are safe.
  - Pointers stay 10 and 22.
  - Completed count -2; estimated hours -1.0. The extras keep their own estimated 30 minutes each.
  - Trade-off: lesson 9 and lesson 21 will read "not done" by lesson number while the extras say
    done. **Continue holding** is the alternative if that matters more than the double count.

## Summary

| Lesson | Held because | Auto-heal damage | Later work to preserve | Recommend | Visible |
|---|---|---|---|---|---|
| R1 L5 | row edited 09-28 | completion | slot repair (09-28), family pin Sep 17 | recover, keep slot | Plan: missed Sep 17 |
| R2 L29 | row edited 09-28 | completion | slot repair (09-28), family pin Sep 22 | recover, keep slot | Plan: missed Sep 22 |
| U1 L2 | row edited 09-28 | completion (family had reopened it) | slot repair, reopen make-up pin Sep 22 | recover, keep slot | Plan: missed Sep 22 |
| T1 L14 | carries 30 min | completion (family had un-ticked and skipped it) | skip, minutes value | recover, no slot | none |
| S1 L9 | re-logged as extra | numbered completion | the extra (Sep 24) | recover numbered row | none |
| S2 L21 | re-logged as extra | numbered completion | the extra (Sep 24) | recover numbered row | none |

- **Customer impact if all six are recovered:** completed counts -6 (R -2, S -2, T -1, U -1).
- **Hours:** estimated report hours -2.0 (R1, R2, S1, S2). **Recorded** report minutes -60 (T1, U1):
  both are minutes attached to completions the families themselves reversed. No minutes values
  are deleted from any row.
- **Plan:** 3 lessons back as missed on past days. Today doesn't change for any family.
- **Pointers, transcripts, Builder:** pointers unchanged, no linked transcripts, all six
  Builder-safe.

## Before any apply

`apply-template.sql` (2c1a38d) cannot run these as they stand, by design:
- HOLD classes are refused outright.
- Completion-only asserts that targets end with no slot. R1, R2 and U1 now hold slots from the
  09-28 repair, and those slots should be kept, not cleared.

A separate, narrow change would be needed:
- **HOLD, per id.** Allow `HOLD_*` lessons only with an explicit list and a new "keep current
  slot" completion-only mode.
- **Row check, per class.** Instead of `updated_at = run time`, require `completed_at` = the
  fingerprint, and compare each row with the frozen backup: every column except completed and
  completed_at must be unchanged since the freeze.
- **Keep the rest.** All existing guards (pointer, whole-row on other lessons and untargeted
  inventory rows, Builder) still apply.
- **Rehearse** it on staging with a slotted held lesson, a skipped held lesson, and a re-logged
  extra that must stay identical.

Untouched by this review: the nine Builder-risk lessons (group C's five and Family E's four). The
integrity routine is still paused.
