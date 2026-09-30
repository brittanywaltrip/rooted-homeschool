# Completion-only review: the 5 excluded inferred-slot lessons (2026-09-30)

Read-only on production, rehearsed on rooted-staging. Nothing was written to production. The
labels continue from the recovery record (Families E and F). This is the continuation of
`RECOVERY-REHEARSAL-AND-FAMILY-PREVIEW-2026-09-29.md`.

## The lessons

| Family | Curriculum | Lesson | Start | Pointer | Now | Lesson id |
|---|---|---:|---:|---:|---|---|
| E | 1 | 3 | 4 | 3 | pinned Aug 24, no slot, below start | 48f75cd9-df75-4f1b-9257-bbb5619473d5 |
| E | 2 | 7 | 8 | 7 | pinned Aug 24, no slot, below start | ed8fe390-91f5-4306-8ff2-df9244a77f73 |
| E | 3 | 4 | 5 | 4 | pinned Aug 24, no slot, below start | d285d379-4533-4764-8836-4f3d0b2b6e2b |
| E | 4 | 6 | 5 | 6 | pinned Aug 24, no slot, **at/after start** | 216fbfb6-c5ea-4d1d-b9ba-b0c033d80f5d |
| F | 5 | 9 | 17 | 26 | unpinned, undated, no slot, below start | e98d941b-7f92-48e5-8255-926bf0670b36 |

**Live eligibility (production, read-only):**
- All 5 still match their 09-25 fingerprint, with no edit since the run.
- None has been re-logged or carries recorded time.
- Starting lesson, pointer and archived flag equal the frozen inventory; none is archived.
- Family E's four curricula have had no writes at all since the run. Family F's has 97 date
  shifts and moves on other rows, none on lesson 9.

## What completion-only does

Each lesson is un-completed and keeps `queue_position = NULL`. Hide-below-start stays on: the
three Family E lessons below their start lose their Aug 24 pin and date, and F lesson 9 already
has neither. The inventory's classification is not changed; completion-only is a mode of the run.

**How the app treats an open lesson with no slot** (code trace on origin/main 55689d0, plus the
live triggers):
- **Plan** draws stored rows by their stored date. It does not project them and does not need a
  slot (`usePlanV2Data.ts:166-176`, `MonthGrid.tsx:97-105`). A past, uncompleted row renders as a
  **missed** pill (`DayCell.tsx:372`). An undated row renders nowhere.
- **Today, the missed-work prompt and banner, and the catch-up** all work from projected slots
  (`dashboard/page.tsx:1455-1461`, `missed-work.ts`). `pinsFromRows` drops a pin with no slot
  (`scheduler.ts:1724`), so none of these ever shows such a row.
- **Automatic writes** leave it alone: page-load resync skips pinned and unslotted rows
  (`scheduler.ts:239, 245`), daily reconcile uses the same planner, and the gap heal only inserts
  a missing next lesson. Database triggers: un-completing recomputes the pointer to the same value,
  so the orphan-cleanup trigger (which fires only when the pointer rises) never runs.
- **Manual paths that can act:**
  - A parent re-spread unpins a slotless pin (`scheduler.ts:875`), but its date stays, so it still
    shows as missed.
  - **A Schedule Builder save deletes an unslotted open lesson** whose number is above the
    curriculum's highest completed lesson and that has no notes or minutes
    (`planPhase2Rows`, `scheduler.ts:2554+`).
  - ~~If the family then ticks "record history", the backfill re-creates lessons 1..pointer that no
    longer exist as **completed**.~~ **Corrected 2026-09-30:** the record-history backfill runs only
    for a brand-new curriculum (`historyRequested` needs `dbId == null`), so on an existing
    curriculum a deleted lesson is simply gone, never re-created as completed. Also, deletion needs
    the save to change that curriculum's schedule fields when the lesson is pinned, and any non-null
    `minutes_spent` (not only a positive one) protects it.
- Reports, the PDF, transcripts and the garden count completed rows only.
- Production has **zero** open numbered lessons without a slot in active curricula today, so this
  would be a new shape, though every path above tolerates it.

## Per-lesson preview (hide-below-start on)

| Lesson | Today | Plan | Builder-save exposure (highest completed lesson after) |
|---|---|---|---|
| E1 L3 | no change | no change (hidden) | deletable (2 < 3) |
| E2 L7 | no change | no change (hidden) | deletable (6 < 7) |
| E3 L4 | no change | no change (hidden) | deletable (3 < 4) |
| **E4 L6** | no change | **reappears on Aug 24 as a missed pill** (it shows done there today) | deletable (5 < 6) |
| F5 L9 | no change | no change (hidden) | protected (26 > 9) |

| Family | Completed count | Report and PDF hours | Linked transcript |
|---|---|---|---|
| E | 48 -> 44 | -2.0 h | two calculated courses; both round the same (2 h, 5 h) |
| F | 146 -> 145 | -0.5 h | none linked |
| **Total** | **-5** | **-2.5 h** | **no change** |

Pointers don't move: none of these lessons holds a slot, and the pointer is the highest completed
slot.

**Only lesson that reappears on Plan: Family E, curriculum 4, lesson 6**, on Aug 24, as missed.
That is how the earlier repair (`cleanup_sql`) had surfaced it before the auto-heal ticked it.

## Script: tested commit 98eda88

`apply-template.sql` gains `v_completion_only boolean := false`:
- When true, the UPDATE keeps each target's current `queue_position` (NULL) instead of writing a
  slot.
- It requires `v_lesson_ids`, and it aborts if any target ends with a slot.
- Everything else is unchanged: the post-lock revalidation (class, slot evidence, start, pointer,
  archived), the whole-row checks on other lessons and on every untargeted inventory row, and the
  pointer, below-start and duplicate-slot guards.

**For a production run:**
- `v_classes := array['UNDO_restore_only_hole_SIGNOFF']`
- `v_completion_only := true`
- `v_lesson_ids` set to the five ids above (or a subset)

## Staging rehearsal

A synthetic family had five curricula:
- **EA** (Family E below start): pinned Aug 24, lesson 4, start 5.
- **EB** (Family E lesson 6): pinned Aug 24, lesson 4, start 3.
- **FX** (F lesson 9): own-number slot, below start, unpinned and undated, with an unrelated
  10/11 swap.
- **SX:** an unlisted sign-off lesson.
- **P:** a certain-slot lesson.

The fixture used the same drag-swap shape and the replayed statement, with later parent work: a
20-minute completion in EB and a note in FX. The inventory was frozen with the committed
`inventory.sql`, and the staging function body matched 98eda88 (hash c420f7e7..., 216 lines; only
the three settings are parameters).

| Test | Result |
|---|---|
| Completion-only with no list | Aborted |
| List with the certain-slot lesson | Aborted, naming it and its class |
| Stale: EB's starting lesson 3 -> 5 | Aborted: start [3, 5] |
| Stale: EA's lesson re-logged as an extra | Aborted: now HOLD_relogged_as_extra |
| Stale: FX family ticks lesson 8 (pointer 7 -> 8) | Aborted: pointer [7, 8] |
| Stale: a drag fills EB's empty slot | Aborted: slot [3, 7] |
| Change only to unlisted SX | Did not block the listed run (passed inside a rolled-back test) |
| Clean run | 3 written, all un-completed with **slot still NULL** |
| Repeat run | Aborted: all 3 now HOLD_family_acted_on_row |

After every abort the fixture was byte-identical to its snapshot. After the clean run:
- **EA:** unpinned, date cleared (below start).
- **EB:** still pinned on Aug 24.
- **FX:** unchanged, unpinned and undated.
- Nothing else on those rows changed.
- The 38 other lessons, including unlisted SX and P (still completed, no slot, classes unchanged),
  were whole-row identical.
- 5 of 5 pointers were unchanged, with 0 duplicate slots.
- The 20-minute completion, the note and every recorded-time row were intact.

Cleanup: all synthetic data, the frozen inventory and the functions were removed; 0 remain.

## Uncertainties and recommendation

- **What was true before 09-25 is still unknown** for these five. Completion-only is chosen
  because it writes no slot. It matches the most likely pre-heal state for Family E (a pinned
  make-up with no slot), and it is always true that nobody completed these lessons.
- **Builder-save exposure (Family E, all four):** once un-completed, a Builder save on those
  curricula could delete the row (see the correction above: it would not be re-created as
  completed). Their current (falsely completed) state is not exposed this way. F lesson 9 is not
  exposed.
- **Visible change:** E lesson 6 goes from done to missed on Aug 24.

Recommendation:
- **F lesson 9:** supported. Invisible, Builder-safe, -0.5 h.
- **Family E's three below-start lessons:** supported, invisible. Accept or decline the
  Builder-save exposure above.
- **Family E lesson 6:** supported only with an explicit OK for the Plan change. Otherwise hold it
  and run the other four.

## PRODUCTION APPLY, batch four: Family F lesson 9, completion-only (2026-09-30)

Approved by Brittany: e98d941b-7f92-48e5-8255-926bf0670b36 only, conditional on unchanged
eligibility. The script was apply-template.sql at **98eda88**, and the only edits were
`v_classes := array['UNDO_restore_only_hole_SIGNOFF']`, `v_lesson_ids := array['e98d941b-...']`
and `v_completion_only := true`. Hide-below-start stayed on. Family E's four were held.

- **Earlier batches preserved:** the batch-three inventory was renamed to
  `recovery_20260925_inventory_batch3` (58 rows). The batch-one and batch-two inventories and all
  earlier backups are unchanged.
- **Inventory refreshed and frozen:** 04:51:21 UTC, 51 rows: sign-off 5, review 40, holds 6.
- **Conditions rechecked, all met:**
  - still `SIGNOFF` with the same slot evidence (9);
  - untouched since the run, with no slot;
  - unpinned and undated, below start (9 < 17);
  - hours 0 and minutes NULL, not re-logged;
  - starting lesson 17 and pointer 26 unchanged;
  - highest completed lesson 26 > 9, so it stays outside the Builder deletion path;
  - 0 writes in the curriculum since batch three.
- **Applied:** 04:52:20 UTC. **1 row written**, and every built-in guard passed.
- **Batch-four backups** (rooted_private; access revoked from public, anon and authenticated):
  - `recovery_20260925_inventory`: the batch-four frozen inventory, 51 rows
  - `recovery_20260925_b4_backup`: all 51 inventory lessons before the apply
  - `recovery_20260925_b4_backup_curricula_lessons`: every lesson in the curriculum, 120 rows
  - `recovery_20260925_b4_backup_curricula`: the curriculum row

Verification after the apply:
- **The one reversal:** exactly 1 of the 51 inventory rows changed.
  - Lesson 9 is un-completed with **queue_position still NULL**, still unpinned and undated.
  - Nothing else on the row changed, and its minutes and hours fields are kept.
- **Curriculum and parent work:** pointer (26), starting lesson and archived flag are unchanged.
  The other 119 lessons are identical as whole rows, including all 24 of the family's own
  completions (8 with recorded time). 0 duplicate slots, 0 new lessons, and the Builder floor is
  still 26.
- **Hours and counts:** -0.5 estimated report and PDF hours. Family F completed 146 -> 145. No
  transcript is linked.
- **Excluded and held:** the other 50 inventory rows are identical as whole rows with classes
  unchanged (sign-off 4, review 40, holds 6). Family E's four are still completed and unchanged.
- **Earlier repairs:** batch one 165 of 165, batch two 35 of 35 and batch three 7 of 7 are all
  still in place, with 0 touched since.

Now 208 of the 258 are repaired. Still pending, untouched: Family E's 4 (held), 40 review and
6 held. The integrity routine is still paused.
