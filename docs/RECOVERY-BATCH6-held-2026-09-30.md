# Batch six, prepared: the 6 held lessons (2026-09-30)

Nothing was written to production. The script change is done and rehearsed on staging, and the six
lessons were re-checked read-only. It needs approval before anything is applied. Families are
labelled as in `RECOVERY-REVIEW-6-held-2026-09-30.md` (R, S, T, U).

## Tested commit: 96870ec

Changes, on top of 2c1a38d:
- **Held classes, completion-only, by id.** `inventory.sql` now records `row_json`, the whole
  lesson row at the freeze. `apply-template.sql` accepts `HOLD_family_acted_on_row`,
  `HOLD_carries_time` and `HOLD_relogged_as_extra` only with `v_completion_only = true` and an
  explicit `v_lesson_ids` list of full lesson ids.
- **Frozen-row check, after the locks.** Each listed held lesson must still be byte-identical to its
  `row_json`, completed, with `completed_at` = the statement's fingerprint. Any change since the
  freeze (a drag, an edit, a minutes change) aborts. This replaces the `updated_at = run time`
  check, which a held lesson fails by definition.
- **Slots are kept, not cleared.** "Completion-only must end with no slot" is now "every target
  must end with exactly the slot it had". That is NULL for the statement's own rows (unchanged
  behaviour) and the 09-28 repaired slot for R's and U's lessons.
- **Unchanged:** everything else. The live reclassification after the locks (class, start, pointer,
  archived), the Builder guard, the pointer guard, whole-row checks on other lessons and on every
  untargeted inventory row, the target-outside-writable-columns check, below-start and
  duplicate-slot guards.
- **The only fields ever written on a held lesson:** `completed` (true -> false) and `completed_at`
  (fingerprint -> NULL); `updated_at` is stamped by its trigger. `queue_position`,
  `queue_pinned`, `scheduled_date`, `skipped`, `minutes_spent`, `hours`, `notes` and every other
  column are proven unchanged. T is below its start, but it is already unpinned and undated, so
  hide-below-start changes nothing there.

## Staging rehearsal (the exact committed script)

The staging function body matched 96870ec (hash bcd03bf1..., 266 lines; only `v_classes`,
`v_lesson_ids` and `v_completion_only` are parameters). The fixture reproduced each production
shape:
- **HR** (R-like): a family-pinned drag on Sep 17, the damage, then a slot repair.
- **HU** (U-like): a completion with 30 minutes, reopened by the family as a pinned make-up on Sep
  22, the damage, then a slot repair.
- **HT** (T-like): ticked with 30 minutes, then un-ticked and skipped, below the start, then the
  damage.
- **HS1 / HS2** (S-like): the damage, then the family re-logging lesson 9 as an extra. HS2 stays
  unlisted.
- **P:** a certain-slot lesson.

The inventory was frozen with the committed `inventory.sql` (row_json recorded for all six), and the
classes matched production's held lessons exactly.

| Test | Result |
|---|---|
| Held classes with completion-only off | Refused |
| Held classes with no list | Refused |
| List includes the certain-slot lesson | Refused, naming it and its class |
| Stale: HR lesson re-dragged after the freeze | Refused: "held lessons changed since the freeze" |
| Stale: HT's recorded minutes 30 -> 45 | Refused (reclassified as edited) |
| Stale: HS1's extra deleted | Refused (no longer re-logged) |
| Stale: HU family ticks a later lesson (pointer 3 -> 4) | Refused |
| Stale: HR starting lesson 3 -> 6 | Refused |
| Change only to unlisted HS2 | Did not block the listed run (rolled-back test) |
| Clean run A (HR, HU, HT) | 3 un-completed. **HR kept slot 5, pin, Sep 17; HU kept slot 2, pin, Sep 22, and its 30 minutes; HT kept skipped = true, no slot, and its 30 minutes / 0.5 hours.** Nothing else on the rows changed. |
| Clean run B (HS1, separately) | Numbered lesson un-completed, slot still NULL. **Both re-logged extras (HS1's and HS2's) whole-row identical.** |
| Repeat run | Refused |

- **After each refusal:** the fixture was byte-identical to its snapshot.
- **After both runs:** the 48 other lessons were identical, including HS2 and P (still completed,
  classes unchanged); 6 of 6 pointers were unchanged, with 0 duplicate slots; both rows with
  recorded minutes kept them.
- **Cleanup:** all synthetic data, the frozen inventory and the functions were removed; 0 remain.

## Production re-check (read-only)

All six are:
- unchanged since the batch-five backup, with the statement's `completed_at`;
- still in the classes above;
- in curricula whose pointer would not move (3, 6, 34, 19, 10, 22 before and after).

The current production inventory predates `row_json`, so the apply must re-freeze with the new
`inventory.sql` first.

## Option A: the four strongly supported lessons

`v_classes := array['HOLD_family_acted_on_row', 'HOLD_carries_time']`, `v_completion_only := true`:

| Family | Lesson | Lesson id | Fields changed | Kept exactly |
|---|---|---|---|---|
| R | 31203a47 L5 | 2643fccc-556d-4733-aecf-3d9c37b9775b | completed true -> false; completed_at -> NULL | slot 5, pinned, Sep 17 |
| R | 5c8888ad L29 | ae143bb4-c859-46b3-8c6e-bb036f698e4a | same | slot 29, pinned, Sep 22 |
| U | 2efa5424 L2 | 0d18b05b-d653-4bb7-86e0-dcd5e83c50c9 | same | slot 2, pinned, Sep 22, minutes 30, hours 0.5 |
| T | b353e95c L14 | c71c225e-4416-4623-abdc-a76355bf1d9c | same | no slot, unpinned, undated, skipped, minutes 30, hours 0.5 |

**Customer impact:**
- **Plan:** R's two and U's one appear as unfinished on their past days (**Sep 17, Sep 22, Sep
  22**). T's is hidden (below its start, skipped).
- **Today, pointers and Builder:**
  - Today doesn't change: the three slotted lessons sit behind the pointer on past dates, and T's
    is hidden.
  - Pointers don't move.
  - All four are Builder-safe: R's and U's are slotted behind the pointer, and T's is skipped.
- **Counts:** completed -4 (R -2, U -1, T -1).
- **Estimated hours:** -1.0 (R's two lessons).
- **Recorded time:** **60 recorded minutes** (U 30, T 30) are **excluded from Reports**, because
  Reports count completed lessons only. The stored `minutes_spent` and `hours` values are **not
  deleted**; they stay on the rows. Both belong to completions the families themselves had undone.
- **Transcripts:** none linked.

## Option B: S's two judgment-call lessons

`v_classes := array['HOLD_relogged_as_extra']`, `v_completion_only := true`:

| Family | Lesson | Lesson id | Fields changed | Kept exactly |
|---|---|---|---|---|
| S | 4a4e0d9d L9 | f2af530f-4314-483c-94d6-989102796476 | completed true -> false; completed_at -> NULL | no slot, unpinned, undated |
| S | 4bcdda4c L21 | 0c3e88d5-ca32-4608-abe4-50b55fc9599b | same | no slot, unpinned, undated |

**The family's genuine extras** ("Language Arts · Lesson 9" and "Handwriting · Lesson 21",
completed, dated Sep 24) are not targets. They sit in the same curricula, so the whole-row guard
proves them identical in every column.

**Customer impact:**
- **Today and Plan:** no change (unpinned and undated, behind the pointer). Pointers don't move.
- **Builder:** safe (9 <= 10 and 21 <= 22 stay completed).
- **Counts and hours:** completed -2, removing the double count; estimated hours -1.0. Each extra
  keeps its own estimated 30 minutes.
- **Trade-off:** lessons 9 and 21 read "not done" by lesson number, while the extras say done.
  Declining B leaves the double count in place.

## Totals

| | Option A | Option B | A + B |
|---|---|---|---|
| Lessons | 4 | 2 | 6 |
| Back on Plan (past days) | 3 (Sep 17, 22, 22) | 0 | 3 |
| Completed count | -4 | -2 | -6 |
| Estimated report hours | -1.0 | -1.0 | **-2.0** |
| Recorded minutes excluded from Reports (stored values kept) | 60 | 0 | **60** |

## Before applying (either option)

- Re-freeze with `inventory.sql` at 96870ec, so `row_json` is recorded. Rename the current table to
  `recovery_20260925_inventory_batch5`, and take fresh protected backups.
- Run A and B as separate runs if both are approved, so each is its own record.

Untouched: the nine Builder-risk lessons (group C's five, Family E's four). The integrity routine
is still paused.

## Apply attempt, Option A (2026-09-30 19:02 UTC): STOPPED before any lesson write

Approved: Option A's four lessons, script 96870ec, completion-only, with the instruction to stop
without writing if anything had changed or the impact differed.

**Done (no lesson written):**
- Confirmed the committed script: unchanged since 96870ec, and its body hash equals the rehearsed
  one (bcd03bf1..., 266 lines). The four ids are in this record.
- Preserved the batch-five inventory as `recovery_20260925_inventory_batch5` (50 rows). The batch-one
  to batch-four inventories and all earlier backups are unchanged.
- Froze a fresh inventory with full-row snapshots at 19:02:54 UTC: `recovery_20260925_inventory`,
  15 rows, all with `row_json`.
- Took protected backups (access revoked from public, anon and authenticated):
  - `recovery_20260925_b6_backup`: 15 rows
  - `recovery_20260925_b6_backup_curricula_lessons`: 433 rows
  - `recovery_20260925_b6_backup_curricula`: 4 rows

**Differences found, so no write:**
1. **Family R, curriculum 5c8888ad: the pointer moved from 34 to 35.** The family completed another
   lesson after the review. Lesson 29's own row is unchanged. Its impact is the same: slot 29 stays
   behind the pointer, and it returns to Plan unfinished on Sep 22.
2. **Excluded Builder-risk lesson 597ac7cd (Family P, lesson 8) is now labelled
   `UNDO_restore_only_hole_SIGNOFF` instead of `REVIEW_slot_ambiguous`.**
   - Batch five un-completed lesson 5 in the same curriculum, so lesson 8 is now the only affected
     lesson there, with one empty slot (6).
   - Its row is byte-identical to the batch-five backup, and nothing in that curriculum has been
     written since batch five.
   - It stays excluded and untouched (not in the allowlist). The composition is now: review 4,
     sign-off 5 (Family E's four plus this one), holds 6.

**The four approved lessons, checked at the freeze:**
- All four match their frozen row exactly, are unchanged since the batch-five backup, and carry the
  statement's `completed_at`. Classes are unchanged (3 family-acted, 1 carries-time).
- Pointers after un-completing equal the current ones (3, 6, 35, 19). None is Builder-exposed.
- Reviewed impact unchanged:
  - 3 past lessons back on Plan (Sep 17, Sep 22, Sep 22);
  - completed -4;
  - estimated hours -1.0;
  - 60 recorded minutes leave Reports while staying stored on the rows.

Re-running requires only a fresh approval. The run re-checks everything under its locks, and would
compare against a new freeze taken immediately before.

## PRODUCTION APPLY, Option A (2026-09-30 19:29 UTC)

Re-confirmed by Brittany for the same four ids. Family R's pointer of 35 was accepted as the new
baseline, and Family P's lesson 597ac7cd stays excluded whatever its label. The script was
apply-template.sql at **96870ec**; the only edits were
`v_classes := array['HOLD_family_acted_on_row', 'HOLD_carries_time']`, the four-id `v_lesson_ids`
and `v_completion_only := true`. Hide-below-start stayed on.

**Before applying:**
- **Stopped attempt preserved:** its inventory was renamed to
  `recovery_20260925_inventory_batch6_stopped` (15 rows), and its backups keep their names
  (`recovery_20260925_b6_backup*`). The batch-one to batch-five inventories and all earlier backups
  are unchanged.
- **Fresh freeze** with full-row snapshots at 19:28:22 UTC: `recovery_20260925_inventory`, 15 rows.
- **Fresh backups** (access revoked from public, anon and authenticated):
  - `recovery_20260925_b7_backup`: all 15 inventory lessons
  - `recovery_20260925_b7_backup_curricula_lessons`: every lesson in the 4 curricula, 433 rows
  - `recovery_20260925_b7_backup_curricula`: the 4 curriculum rows
- **Checked against the stopped freeze:** all four targets are byte-identical, with the same classes
  and pointers (3, 6, 35, 19). No excluded lesson changed.

**Applied:** 19:29:45 UTC. **4 rows written**, and every built-in guard passed: the post-lock
revalidation, the frozen-row check, the Builder guard, pointers, slots unchanged, and the whole-row
checks.

**Verification against the batch-seven backups:**
- **The four targets:** exactly 4 of the 15 inventory rows changed, and on each only `completed`
  (true -> false), `completed_at` (-> NULL) and the trigger-stamped `updated_at` changed.
  - R L5: slot 5, pinned, Sep 17.
  - R L29: slot 29, pinned, Sep 22.
  - U L2: slot 2, pinned, Sep 22, minutes 30, hours 0.5.
  - T L14: no slot, unpinned, undated, skipped, minutes 30, hours 0.5.
- **Pointers:** 19, 35, 3, 6, all equal to the backup. The curriculum rows are unchanged apart from
  `updated_at`. 0 duplicate slots, 0 new lessons.
- **Parent work:** the other 429 lessons in those curricula are identical as whole rows, including
  all 57 of the families' own completions (45 with recorded time) and Family R's later completion.
- **Excluded lessons:** the other 11 inventory lessons are identical as whole rows and still
  completed: Option B's two S lessons, and the nine Builder-risk lessons (Family E's four, the four
  remaining ambiguous lessons, and 597ac7cd).
- **Family S's genuine extras** ("Language Arts · Lesson 9", "Handwriting · Lesson 21") are
  untouched: last written 09-27 when the family created them, and in curricula outside this run.
- **Plan:** three lessons are back as unfinished on past days, each slotted behind its pointer
  (Sep 17, Sep 22, Sep 22).
- **Reports:** estimated hours fell by 1.0 (R's two lessons). **60 recorded minutes** (U 30, T 30)
  no longer count in Reports, and **all 60 minutes are still stored** on the rows.
- **Earlier batches intact, none touched since their applies:** one 165, two 35, three 7, four 1,
  five 35.

Now 247 of the 258 are repaired. Still pending and untouched: Option B's two lessons and the nine
Builder-risk lessons. The integrity routine is still paused, and no family was contacted.
