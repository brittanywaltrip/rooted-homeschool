# Recovery rehearsal and eight-family preview, 2026-09-29

No production data was changed. The rehearsal ran on rooted-staging (`cvgqovweybggrqakhdtd`) with
synthetic families, and was fully cleaned up afterwards. The preview below comes from read-only
production queries and names no family, child or curriculum.

## Current production scope (read-only, 2026-09-29)

258 lessons are still falsely marked done. The 259th, an inferred-slot lesson, was un-ticked by its
family on 09-29 01:01 UTC and now shows correctly as their next lesson.

| Class | 09-25 run | 09-26/27 runs | Plan |
|---|---:|---:|---|
| Certain slot | 165 | 0 | First batch, rule v2 |
| Inferred slot (sign-off) | 12 | 0 | Held for individual sign-off |
| Archived curriculum | 29 | 6 | Completion undone only |
| Ambiguous slot (review) | 37 | 3 | Excluded |
| Family acted / carries time / re-logged (hold) | 6 | 0 | Excluded |

## Staging rehearsal

Synthetic family R (10 curricula) and family Z (1 curriculum, never damaged). They were built to
cover every production shape:

| Curriculum | Shape | Class after damage |
|---|---|---|
| G1 | Pinned make-up on a past day, at/after the start; later parent completion after the damage | Certain slot |
| G2 | Start at lesson 5; lessons 1-4 behind the start: pinned+dated, unpinned+dated, unpinned+undated, pinned+dated; pointer = start - 1 | Certain slot, below start |
| G3 | Unpinned, undated lesson behind the pointer | Certain slot, pointer-hidden |
| G4 | Reordered (slot swap), one open lesson behind the pointer | Inferred slot |
| G5 | Archived curriculum | Archived |
| G6 | Reordered, two open lessons behind the pointer | Review |
| G7 | Three open lessons: one edited by the family after the damage, one carrying logged minutes, one re-logged as an extra | Hold (x3) |
| G8 | Like G6, one lesson previously un-ticked (`manual_uncomplete`), damaged by a **second** run | Review |
| G9 | Archived, damaged by a **third** run | Archived |
| G10 | Reordered, one lesson pinned to a **future** date (`plan_move`), damaged by the third run | Review |

Steps:
1. Snapshot every lesson.
2. Replay the 09-25 statement verbatim in three separate transactions, giving three distinct
   fingerprints: 13 + 2 + 4 = 19 lessons falsely completed.
3. The family ticks G1 lesson 7, edits G7 lesson 5, and re-logs G7 lesson 7, in a later transaction.
4. Freeze `inventory.sql` exactly as committed, with only the run timestamps changed. All 19 lessons
   were classified as designed.
5. Run `apply-template.sql` exactly as committed, with all three UNDO classes approved and
   hide-below-start on: 10 lessons written in 6 curricula, and every built-in guard passed.

Independent verification, all 111 lessons of both families checked against the snapshots:

| Check | Result |
|---|---|
| Recovered lessons (10) | Completion undone. Slot back to the pre-damage value (certain: lesson number; inferred: the eliminated slot 4). Archived: no slot, as designed |
| Pins and dates at/after the start | Exactly the pre-damage values (G1 make-up pinned on Aug 20 again; G4 keeps its date, restored to slot 4) |
| Below the start (G2, 4 lessons) | All unpinned with no date, hidden. Two were pinned and three dated before |
| Pointer-hidden lesson (G3) | Still hidden (not surfaced) |
| Review (6) and hold (3) lessons | Byte-identical to after the damage (untouched) |
| Later parent work (G1 lesson 7) and all other lessons | Byte-identical |
| Family Z | Byte-identical |
| Pointers | 0 moved (G2 stays on start - 1, G1 stays at 7) |
| Duplicate slots | 0 |
| Repeat run | Refused: "wrote 0 of 10 approved rows ... Nothing kept." |

Cleanup: all 111 synthetic lessons, 11 curricula, both accounts, the frozen inventory and both
snapshots were deleted. 0 rows remain.

## What families would see after the first batch (165 certain-slot lessons)

- **Today:** nothing changes. Pointers do not move, so each child's next lesson is the same. A
  restored make-up only appears on Today when its date is today or later, and every returning
  lesson is dated Aug 3 to Sep 3.
- **Missed-work prompt and Plan's missed banner:** not triggered. Missed work is projected from each
  curriculum's settings and never reads lesson dates (`app/lib/missed-work.ts`).
- **Plan calendar:** a returning lesson reappears as unfinished on its original past day.
- **Counts:** each undone completion lowers lesson counts (reports, weekly summary, garden leaves)
  by one. Hours are unchanged; every lesson here carried 0 hours.
- **Kept hidden:** lessons below the family's starting lesson (rule v2) and the 20 pointer-hidden
  lessons in 6 other families (not in these 8).

### The eight families (anonymous)

The 165 lessons belong to 25 families. **17 families see nothing appear** (99 lessons: 79 below
their starting lesson, 20 hidden behind the pointer); only their completed-lesson counts drop. The 8
families below are the ones who would see lessons come back.

The "Back on Plan as unfinished" column shows lesson number and original day.

| Family | Child | Curricula affected | Back on Plan as unfinished | Kept hidden (below start) | Completions undone | Held back, not in this batch | Later parent work in those curricula |
|---|---|---:|---|---:|---:|---:|---|
| 1 | Child 1 | 8 | 8 lessons: Aug 23 (3), Aug 25 (5) | 0 | 8 | 0 | 6 of 8 |
| 1 | Child 2 | 8 | 9 lessons: Aug 23 (2), Aug 25 (7) | 0 | 9 | 0 | 7 of 8 |
| 1 | Child 3 | 8 | 11 lessons: Aug 23 (4), Aug 25 (6), Aug 26 (1) | 0 | 11 | 0 | 6 of 8 |
| 2 | Child 1 | 5 | 5 lessons, all Aug 9 | 5 | 10 | 0 | none |
| 3 | Child 1 | 4 | 2 lessons: Aug 20, Aug 25 | 1 | 3 | 4 | none |
| 3 | Child 2 | 5 | 2 lessons: Aug 20, Aug 25 | 1 | 3 | 6 | none |
| 4 | Child 1 | 1 | 1 lesson: Aug 24 | 0 | 1 | 0 | none |
| 4 | Child 2 | 3 | 2 lessons: Aug 24 (2) | 2 | 4 | 3 | none |
| 4 | Child 3 | 3 | 0 | 3 | 3 | 2 | none |
| 5 | Child 1 | 3 | 3 lessons: Aug 4 (2), Aug 23 | 0 | 3 | 0 | none |
| 6 | Child 1 | 2 | 2 lessons: Aug 24 (2) | 0 | 2 | 0 | none |
| 7 | Child 1 | 2 | 1 lesson: Sep 3 | 1 | 2 | 0 | none |
| 7 | Child 2 | 1 | 0 | 6 | 6 | 0 | none |
| 8 | Child 1 | 1 | 1 lesson: Aug 8 | 0 | 1 | 0 | none |
| **Total** | | | **47** | **19** | **66** | **15** | |

Notes:
- **Family 1** is the heaviest: 28 lessons across three children, all dated Aug 23 to 26, in
  curricula where the family has mostly kept going since. These are old make-ups that
  were pinned there before 09-25. After recovery the family would see one or two unfinished August
  lessons per curriculum on Plan, and nothing new on Today. Candidates for a heads-up, or for hiding
  as well.
- **Family 7 Child 2** and **Family 4 Child 3** see nothing: every undone lesson is below the
  starting lesson and stays hidden. Only their counts drop.
- "Held back" lessons (Families 3 and 4) are ambiguous or held rows. They stay marked done until
  decided separately.

## Status

- **Production recovery not applied.** Nothing was written to production customer data.
- **The integrity routine stays paused.**
- **Next, when approved:**
  1. Re-run `inventory.sql` on production and confirm the counts above.
  2. Freeze the inventory and back up the rows.
  3. Apply `UNDO_restore_slot` only (165), with hide-below-start on.
  4. Check Today and Plan for Family 1 and one small family.
- The inferred-slot (12), archived (35), review (40) and hold (6) groups each follow their own
  decision.
