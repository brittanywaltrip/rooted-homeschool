# Recovery plan: the 250 lessons falsely marked done on 2026-09-25

Status: PLAN ONLY. Nothing here has run against production. Every production
number below comes from `scripts/recovery-2026-09-25/inventory.sql`, a single
read-only SELECT, run 2026-09-28.

## What happened, in one paragraph

At 2026-09-25 15:11:35 UTC the scheduled Claude task
`rooted-curriculum-integrity-check` ran its "drift G auto-heal" on production
through the Supabase MCP (role `postgres`, no signed-in user). The statement
set `completed = true`, `completed_at = now() - 1 day` and `queue_position =
NULL` on every unfinished lesson whose `lesson_number <= current_lesson`, then
forced `current_lesson` back to its old value. It touched no other column and
no other row. The task is report-only as of 2026-09-28, and PR #130 adds a
database guard that refuses this statement (verified on rooted-staging).

## Inventory (production, read-only, 2026-09-28)

Confirms Sol's count:
- 250 rows still complete, 34 families, 123 curricula.
- 247 with a NULL slot.
- All 250 at or before `current_lesson`.
- 31 curricula have later completions by `completed_at` (40 lessons).
  Counting completions the family back-dated or edited after the run adds
  1 more curriculum, so the plan protects **32**.

| Action | Rows | Curricula | Families | Curricula with later parent work | Pinned | Would stay hidden after undo |
|---|---:|---:|---:|---:|---:|---:|
| `UNDO_restore_slot` | 165 | 88 | 25 | 23 | 133 | 20 |
| `UNDO_restore_only_hole_SIGNOFF` | 13 | 13 | 7 | 2 | 4 | 8 |
| `UNDO_archived` | 29 | 4 | 3 | 2 | 3 | 0 |
| `REVIEW_slot_ambiguous` | 37 | 13 | 7 | 1 | 36 | 0 |
| `HOLD_family_acted_on_row` | 3 | 3 | 2 | 2 | 3 | 0 |
| `HOLD_relogged_as_extra` | 2 | 2 | 1 | 2 | 0 | 2 |
| `HOLD_carries_time` | 1 | 1 | 1 | 1 | 0 | 0 |
| **Total** | **250** | | **34** | | | |

What each class means:

- **UNDO_restore_slot.** The curriculum is otherwise in book order and slot
  `lesson_number` is empty, so the erased slot is provably `lesson_number`.
- **UNDO_restore_only_hole_SIGNOFF.** The curriculum was reordered by a
  family's drag, so `lesson_number` proves nothing. But it has exactly one
  empty slot and exactly one affected row without a slot, so that slot is the
  one erased. This covers Lewis Harrison's Gather Round: Chemistry lesson 6
  (slot 5) and brandylee341's Foundations lesson 21 (slot 20), Math With
  Confidence K lesson 74 (slot 73) and Kindergarten Prep lesson 9 (slot 8).
  It needs a reviewer's sign-off because it relies on elimination, not identity.
- **UNDO_archived.** The curriculum is in a closed year. Revert the completion
  only; no slot is restored.
- **REVIEW_slot_ambiguous.** A reordered curriculum with more than one
  candidate slot. 36 of the 37 rows are pinned and 25 sit below the family's
  starting lesson. Decide each curriculum by hand, or leave these completed
  and tell the family.
- **HOLD.** The family has touched the row since (Ted Bendriem's Math With
  Confidence lesson 2, Gilbert Harrison's Chemistry lesson 5, Lewis Harrison's
  Handwriting lesson 29), re-logged the lesson as an extra (brandylee341's
  "Handwriting · Lesson 21" and one other), or it carries logged time. Never
  written by the template. Ask the family.

Rows below the family's starting lesson (`start_at_lesson`) are lessons the
family chose to skip. 157 of the 250 are in that position. An exact undo puts
them back to what the family had: incomplete, and not shown.

## Principles

1. **An exact undo, nothing more.** The statement wrote three columns, so the
   recovery writes those three back: `completed = false`,
   `completed_at = NULL`, and the slot. Dates, pins and sources were never
   touched and already hold what the family had. A pinned make-up the
   statement "completed" becomes the pinned make-up it was.
2. **Later parent work is never written.** The template records an md5 of
   every other lesson in each affected curriculum before the write, and aborts
   unless they are identical after it.
3. **Pointers do not move.** `current_lesson` is recomputed as
   `GREATEST(start_at_lesson - 1, MAX(completed slot))`. The reverted rows hold
   no slot while completed, so un-completing them cannot move it. The template
   asserts every pointer is unchanged and aborts otherwise. This protects the
   5 curricula whose pointer sits on `start_at_lesson - 1` with nothing
   completed below it (for example Holden's CLE Language Arts 3, pointer 8,
   zero real completions).
4. **No blanket reversal.** The template refuses to run until specific
   classes are named, and it refuses HOLD and REVIEW outright.
5. **Row-level freshness.** A row is written only if it is still exactly as
   the statement left it (`updated_at` equals the statement's time). If anything
   changed between the inventory and the run, the count check fails and
   nothing is kept.

## Surfacing (a separate decision, per family)

28 of the revertible rows (20 restore-slot, 8 only-hole) would be unpinned,
undated and behind the pointer after the undo.
That is where they were before 2026-09-25: no screen shows them. For the ones
at or above the family's starting lesson, Brittany can choose to show them as
missed work (`queue_pinned = true, scheduled_date = date`). This is step 2 in
the template, and it is never automatic. For a family who has since re-logged
the lesson (brandylee341), the answer is no.

## Staging rehearsal (2026-09-28, rooted-staging `cvgqovweybggrqakhdtd`)

Built with a synthetic family (e2e@rooted-staging.test) in two throwaway
curricula; everything was deleted afterwards.

1. **Family actions, as the family.** In curriculum A, lessons 1, 2 and 5 were
   ticked, leaving 3 and 4 behind the pointer. In curriculum B, lessons 1-3
   were ticked, lesson 4 was dragged onto lesson 5's day (the slots swapped),
   then lesson 4 was ticked.
2. **The 09-25 statement, verbatim, in its own transaction.** The guard from
   PR #130 is live on staging, so it ran under an explicit attestation to
   reproduce the damage. 3 rows were falsely completed.
3. **Later parent work, in a later transaction.** A's lesson 6 was ticked, and
   the falsely completed lesson 3 was edited.
4. **`inventory.sql` verbatim.** Only the two timestamps were changed. Result:
   A-3 `HOLD_family_acted_on_row`, A-4 `UNDO_restore_slot`,
   B-5 `UNDO_restore_only_hole_SIGNOFF` (slot 4).
5. **`apply-template.sql` verbatim, with both UNDO classes approved.**
   - A-4 is open in slot 4.
   - A-3 is untouched (still done, with the family's note).
   - A-6 is untouched, and A's pointer is still 6.
   - B-5 is open in slot 4, exactly as the family's drag left it, and B's
     pointer is still 5.
6. **Re-run:** refused, "wrote 0 of 2 approved rows ... Nothing kept".
   **Naming a REVIEW class:** refused.

## To run it on production (each step needs Brittany's go-ahead)

1. Apply PR #130's guard. It does not block un-completing, but it closes the
   door the damage came through.
2. Re-run `inventory.sql`. Its counts must match the table above; if they
   drift, re-plan.
3. Freeze the inventory and back up the rows (step 0 in the template).
4. Run `UNDO_restore_slot` first (165 rows). Check Today and Plan for 2 or 3
   of those families.
5. Then `UNDO_archived` (29), and `UNDO_restore_only_hole_SIGNOFF` (13) once
   signed off.
6. Handle REVIEW (37) and HOLD (6) per family, by hand or by asking.
7. Decide on surfacing, per family.

Not included: badges. One affected family received 16 garden-stage badges at
21:21 on 2026-09-25, six hours after the run and all at once. That looks like
a stage backfill, not something these rows caused. Leave badges alone.
