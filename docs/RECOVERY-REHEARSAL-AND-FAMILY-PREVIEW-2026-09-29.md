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
  by one. ~~Hours are unchanged; every lesson here carried 0 hours.~~ **CORRECTED 2026-09-30:**
  that was wrong. None of the 165 had recorded time, but a completed lesson with no recorded time
  counts as an estimated 30 minutes (lib/lesson-minutes.ts), so the recovery removed 82.5
  estimated hours from Reports and the progress-report PDF. See "Correction: estimated hours and
  the 165" below.
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

## Guard rehearsal: settings changed between inventory and apply (2026-09-29)

`apply-template.sql` now revalidates every approved lesson after taking the locks. It reclassifies
each one from live data using the inventory's own rules, and requires each curriculum's
start_at_lesson, archived flag and current_lesson to equal what the inventory recorded. Any
difference aborts before a row is written. The "other lessons unchanged" check now compares whole
rows (`to_jsonb`, every column including updated_at) instead of an md5 over 12 fields. Each approved
lesson must also be unchanged outside the 6 columns the run writes.

Rehearsed on rooted-staging against a new synthetic family with 4 curricula and 7 approved lessons
covering all three UNDO classes. The staging function body matched the committed template (same
hash with comments stripped). Every abort left the fixture byte-identical to its snapshot.

| Change after the inventory | New template | Previous template |
|---|---|---|
| S1 starting lesson 5 -> 3 (committed separately first) | Aborted: start [5, 3] on 4 lessons | Aborted, but only by chance (pointer moved) |
| S2 archived curriculum unarchived | Aborted: approved UNDO_archived, now UNDO_restore_slot | **Passed** (would write) |
| S3a drag fills the slot a lesson would return to | Aborted: now needs sign-off, slot 5 | Aborted by the unique slot index |
| S3b drag moves the one empty slot from 2 to 4 | Aborted: slot [2, 4] | Aborted by the unique slot index |
| S3c drag elsewhere makes the curriculum drifted | Aborted: approved restore_slot, now sign-off | **Passed** (would write) |
| S4 lesson re-logged as an extra | Aborted: now HOLD_relogged_as_extra | **Passed** (would write) |
| S5 family ticks a later lesson, pointer 4 -> 6 | Aborted: pointer [4, 6] | **Passed** (would write) |
| W1 side effect renames another lesson during the revert | Aborted: whole-row compare | **Passed** (title is outside the old hash) |
| W2 side effect changes an approved lesson's own title | Aborted: outside writable columns | not checked |

Clean run with nothing changed: 7 lessons written. Pointers unchanged, 0 duplicate slots, the 23
other lessons identical as whole rows, and the approved lessons identical outside the writable
columns. Below-start lessons were unpinned and undated, and the sign-off lesson went to slot 2.
Repeat run: aborted by the new guard (all 7 now HOLD_family_acted_on_row).

Cleanup: the synthetic user, curricula, lessons, snapshots, inventory, and the helper functions and
temporary triggers were all removed; 0 remain.

## PRODUCTION APPLY: UNDO_restore_slot only (2026-09-29)

Approved by Brittany: the 165 certain-slot lessons only, using apply-template.sql at 9236868, with
hide-below-start on. The only edit to the script was `v_classes := array['UNDO_restore_slot']`.

- **Inventory frozen:** 22:20:01 UTC, 258 rows. Counts matched the approval: restore_slot 165,
  sign-off 12, archived 35, review 40, holds 6. The 165 lesson ids were identical to the approved
  preview, across 25 families and 88 curricula.
- **Applied:** 22:22:47 UTC. 165 rows written, and every built-in guard passed.
- **Backups** (rooted_private; access revoked from public, anon and authenticated):
  - `recovery_20260925_inventory`: the frozen inventory, 258 rows
  - `recovery_20260925_backup`: the exact 258 inventory lessons before the apply
  - `recovery_20260925_backup_curricula_lessons`: every lesson in the 88 curricula, 10,663 rows
  - `recovery_20260925_backup_curricula`: the 88 curriculum rows

Independent verification after the apply:
- 165 of 165 undone and back in slot = lesson_number, unchanged outside the writable columns.
- 98 below the starting lesson are unpinned with no date. 95 of them had a pin or date before;
  the old values are in the backup.
- 67 at or after the start kept their exact pin and date. 47 are back on Plan on past days (Aug 3
  to Sep 3), 0 are dated today or later, and 20 pointer-hidden lessons are still hidden.
- Pointers: 88 of 88 unchanged. Duplicate slots: 0. New lessons since the freeze: 0.
- The other 10,498 lessons in those curricula are identical as whole rows, including all 1,081
  of the families' own completions.
- The other 93 inventory rows (sign-off, archived, review, hold) are identical as whole rows.
- Family 1: 24 curricula, pointers and next lesson unchanged in all 24. 28 lessons are back on
  their original pinned days (Aug 23, 25, 26), and none land on Today. Completed count 676 -> 648.
- Family 8: next lesson unchanged, lesson 5 back on Aug 8 (pinned, same as before). Completed
  count 210 -> 209.

## Review: the 35 archived-curriculum lessons (read-only, 2026-09-29)

Nothing was written. This batch uses letters (Families A to D) so its labels don't collide with the
numbered families above.

Live eligibility, using the rules the guarded script applies after its locks:
- 35 of 35 still match their run's fingerprint (completed_at, updated_at, no slot): 29 from the
  09-25 run, 6 from 09-27.
- 35 of 35 are still in archived curricula, and 35 of 35 carry no recorded time.
- 0 have been re-logged as an extra, and no row has been edited since its run.
- Every row is identical to the backup taken at 22:20 UTC, and each curriculum's starting lesson,
  archived flag and pointer still match the frozen inventory. **Eligibility has not changed.**

| Family | Curricula | Lessons | Below start | Completed count | Report hours (30 min estimate each) | Transcript (calculated hours) |
|---|---:|---:|---:|---|---|---|
| A | 2 | 17 | 17 (3 pinned) | 589 -> 572 | -8.5 h (Aug 7 to Sep 22) | two courses: 51 -> 46.5 h, 52 -> 48 h |
| B | 1 | 10 | 10 | 639 -> 629 | -5.0 h (Sep 23 to Oct 8) | no linked course |
| C | 1 | 6 | 0 | 225 -> 219 | -3.0 h (Sep 17, 20) | one course: 55 -> 52 h |
| D | 1 | 2 | 2 | 587 -> 585 | -1.0 h (Sep 16, 17) | no linked course |
| **Total** | **5** | **35** | **29** | **-35** | **-17.5 h** | **-11.5 h across 3 courses** |

Why hours move although no time was logged: every completed lesson without recorded time counts as
an estimated 30 minutes (lib/lesson-minutes.ts) in Reports, the progress-report PDF and linked
transcript courses. The transcript rewrites a calculated course's hours the next time that page
opens, so those three numbers change then, not at the moment of the reversal. Garden leaves drop
by one per lesson. The Monday email counts by scheduled_date: only 3 of these rows have one (Aug 7,
Sep 9 and 10), so no past or upcoming weekly email counted or would count them. Family B's lessons
carry cache dates up to Oct 8, so today Reports show 10 "completed" lessons on days that haven't
happened yet; the reversal removes them.

What a completion-only reversal leaves unchanged:
- **Pointers:** unchanged in all 5 curricula. None of these rows holds a slot, and the pointer after
  the trigger recompute equals today's in every one.
- **Queue slots:** unchanged. UNDO_archived writes no slot, and the rows stay without one.
- **Dates:** unchanged. **Pins:** unchanged, with one exception: if hide-below-start stays on (the
  script's default), Family A's 3 pinned below-start lessons lose their pin and date. That is not
  visible today.
- **Today and Plan:** no visible change. Today loads only unarchived curricula, and Plan hides
  archived curricula's lessons. If a family ever unarchives, the 35 would be open lessons behind the
  pointer with no slot, so nothing would be projected. With hide on, the 3 pinned ones stay hidden
  too.

Recommendation: approve all 35 (ids below), with hide-below-start **on**. With it off, those 3
pinned lessons below the starting lesson would come back as missed on Plan if Family A unarchived,
which rule v2 exists to prevent. Right before applying, re-freeze the inventory: rename the current
table to `recovery_20260925_inventory_batch1` and create a fresh one, because the script's pointer
check compares against the frozen values and Families A and C are still completing lessons in these
curricula.

Eligible ids (UNDO_archived, 35):
07c14499-3ad4-476a-ab48-0b507a64770b, 120f5d6d-1e07-4009-bb1d-f75d043d457f, 228e949e-e5ad-479f-8ead-1d00c621ffbe,
2636767c-ee46-4b44-b729-afe2232c278f, 2680f5d4-6134-4e9c-a4e9-5269e2db3d1c, 2c393549-982d-4abd-95c0-13500ed3a9f9,
3fadc01b-7269-4e6e-9b31-5c059d7845c1, 3ff14b33-6ea5-4325-884b-635332976cef, 4329bcfb-7195-439f-bb0c-959efc8a9274,
54a88867-4a56-4f94-8e09-23e6b291c553, 570293f0-15fb-45dd-997b-7d8e613a6508, 593e3140-20e6-49ad-b575-e947fbd4a484,
60667dcf-6c17-451d-a66b-b4ce54b74ac0, 68bcfe9b-1ae5-4eea-8f83-a1de66c34449, 6b28526a-9d1f-4a39-b5c0-d3e49e384c2e,
6c29a463-348a-47d5-bad1-4459a72b049a, 7a5165a0-8e48-4999-84d5-9a7b9cae2249, 7cc93656-f3e4-4b6a-a058-b86d9d57e077,
86cdd046-669e-4d51-8c93-4167a41ffcc0, 8d9b40d6-97a4-4df8-9dd5-44c4a963bfc3, 94ec2873-c262-45cb-8576-6c74f3552dc1,
9507fbea-a8ac-43e3-97b6-cf3b38cede62, 9bf366e4-11ab-4fed-9433-0d67605c7f5d, 9f9c75d5-e36e-49eb-b8bf-d273ba5e20c4,
ae61131c-8d31-4bc7-b17a-45ce66adb8f4, b41bb91a-4269-43c2-ab4c-1d8c1ba57b92, bec3472c-b048-475b-97ce-9be97305ab93,
c65abe96-971d-45e4-95fc-a9d8b99d7466, d25e356e-bc63-468d-9403-4e6d94b07e84, d27207ab-dd89-498e-a00e-adba0226f5ea,
d838ba6e-e7cb-4a3e-b07b-9884924c4d21, de00b647-9569-4450-a5f4-46bb8fddb0b0, ecb68206-dde5-4772-beff-e03708db1458,
ef01c1b9-7af9-43a1-bdea-340fc1b8008b, fa7b2e52-ba4a-4e3c-bf30-8b50c07381b0

## Correction: estimated hours and the 165 (read-only, 2026-09-30)

The preview above said the recovery would leave hours unchanged. That was wrong. Every one of the
165 lessons had no recorded time (minutes_spent NULL, hours 0; none recorded as 0 minutes). Reports,
the progress-report PDF and linked transcript courses all price such a lesson at an estimated 30
minutes (lib/lesson-minutes.ts, `lessonMinutes`). So while the lessons were falsely completed (from
the 09-25 run until 22:22 UTC 09-29), each one added 0.5 estimated hours, and the recovery took
those hours back out. The recovery returned hours to where they were before the auto-heal. It did
not remove any time a family recorded.

Computed from the batch-one backup (`recovery_20260925_backup`, `..._backup_curricula_lessons`).
Families are labelled R1 to R25 by hours removed. R1 is Family 1 and R25 is Family 8 from the
preview above. Reports and PDF compute hours live from lessons, so this change took effect at the
apply.

| Family | Lessons | Shown on Plan | Report and PDF hours removed | Report days | Hours in affected curricula, before -> after |
|---|---:|---:|---:|---|---|
| R1 (Family 1) | 28 | 28 | 14.0 | Aug 23 to 26 | 297.5 -> 283.5 |
| R2 | 18 | 0 | 9.0 | Sep 2 | 9.3 -> 0.3 |
| R3 | 17 | 0 | 8.5 | Aug 11 to 14 | 31.3 -> 22.8 |
| R4 | 10 | 5 | 5.0 | Aug 3 to 9 | 10.3 -> 5.3 |
| R5 | 10 | 0 | 5.0 | Aug 22 to Sep 15 | 6.5 -> 1.5 |
| R6 | 10 | 0 | 5.0 | Sep 15 to 18 | 25.5 -> 20.5 |
| R7 | 9 | 0 | 4.5 | Aug 12 to 27 | 37.4 -> 32.9 |
| R8 | 8 | 0 | 4.0 | Aug 10 | 17.0 -> 13.0 |
| R9 | 8 | 3 | 4.0 | Aug 13 to 24 | 13.5 -> 9.5 |
| R10 | 8 | 1 | 4.0 | Sep 3 | 19.3 -> 15.3 |
| R11 | 7 | 0 | 3.5 | Aug 3 | 13.0 -> 9.5 |
| R12 | 6 | 4 | 3.0 | Aug 20 to 25 | 13.0 -> 10.0 |
| R13 | 4 | 0 | 2.0 | Aug 18 to Sep 16 | 18.7 -> 16.7 |
| R14 | 3 | 0 | 1.5 | Sep 16 | 13.7 -> 12.2 |
| R15 | 3 | 0 | 1.5 | Sep 6 | 6.0 -> 4.5 |
| R16 | 3 | 3 | 1.5 | Aug 4 to 23 | 38.0 -> 36.5 |
| R17 | 2 | 2 | 1.0 | Aug 24 | 14.3 -> 13.3 |
| R18 | 2 | 0 | 1.0 | Aug 27 | 14.3 -> 13.3 |
| R19 | 2 | 0 | 1.0 | Sep 25 to Oct 2 | 9.8 -> 8.8 |
| R20 | 2 | 0 | 1.0 | Aug 18 to 23 | 6.1 -> 5.1 |
| R21 | 1 | 0 | 0.5 | Sep 14 | 3.6 -> 3.1 |
| R22 | 1 | 0 | 0.5 | Sep 14 | 5.0 -> 4.5 |
| R23 | 1 | 0 | 0.5 | Sep 18 | 5.3 -> 4.8 |
| R24 | 1 | 0 | 0.5 | Aug 17 | 10.0 -> 9.5 |
| R25 (Family 8) | 1 | 1 | 0.5 | Aug 8 | 11.5 -> 11.0 |
| **Total** | **165** | **47** | **82.5** | | |

"Hours in affected curricula" is the estimated-plus-recorded total over the curricula that held
recovered lessons, not the family's whole report. A report for a narrower date range moves only by
the lessons dated inside it.

**Linked transcripts:** 45 transcript courses link to curricula that held recovered lessons. None
of them has had its stored hours written since Sep 15, before the first auto-heal run. So no stored
transcript number ever absorbed the false completions, and none changed at the apply. The transcript
page rewrites only `hours_source = 'calculated'` courses when it opens, rounding to whole hours
(`hoursFromMinutes`). On the next open, 10 of those calculated courses will write a value lower than
they would have without the recovery, 19 whole hours in total (R5 -5, R10 -3, R7 -4 over two
courses, R6 -2, R17 -2 over two, R9 -2 over two, R4 -1). The other calculated courses round to the
same number either way. Courses with hours_source NULL are never rewritten on page open, so the
recovery does not change them. Many stored values already differ from the calculation for older
reasons (the #96 hours_source work); that is unrelated to this recovery.

**Who could have seen the inflated hours** (PostHog, 09-25 15:11 to 09-29 22:23 UTC): events were
recorded for 11 of the 25 families. One (R22) opened Reports once. No transcript page views, and no
`plan_pdf_downloaded` (the Reports-page PDF). The Plan-page PDF download is not tracked, and the 14
families with no events cannot be ruled in or out.

**The 35 archived lessons (next batch)** follow the same rule, as the review above already states:
-17.5 report hours across 4 families. Hide-below-start stays on in the proposed batch.

## PRODUCTION APPLY, batch two: UNDO_archived only (2026-09-30)

Approved by Brittany: the 35 archived-curriculum lessons listed in the review at 215ebf1, with
hide-below-start on. The script was apply-template.sql at 9236868; the only edit was
`v_classes := array['UNDO_archived']`.

- **Batch one preserved:** the batch-one inventory was renamed to
  `recovery_20260925_inventory_batch1` (258 rows, contents unchanged). The batch-one backups keep
  their names.
- **Inventory refreshed and frozen:** 02:05:15 UTC, 93 rows: archived 35, sign-off 12, review 40,
  holds 6. The 35 archived ids were identical to the approved list, and all 35 rows were
  byte-identical to the batch-one backup (untouched since the review).
- **Applied:** 02:06:37 UTC. 35 rows written in 5 curricula for 4 families, and every built-in
  guard passed.
- **Batch-two backups** (rooted_private; access revoked from public, anon and authenticated):
  - `recovery_20260925_inventory`: the batch-two frozen inventory, 93 rows
  - `recovery_20260925_b2_backup`: all 93 inventory lessons before the apply
  - `recovery_20260925_b2_backup_curricula_lessons`: every lesson in the 5 curricula, 648 rows
  - `recovery_20260925_b2_backup_curricula`: the 5 curriculum rows

Verification after the apply:
- 35 of 35 are un-completed with no slot. They are unchanged outside the writable columns, and
  minutes and hours are kept.
- 29 below the starting lesson are now unpinned with no date. 3 of them had a pin or date before,
  and the old values are in the backup. The 6 at or after the start kept their pin and date.
- Pointers, archived flags and starting lessons are unchanged in 5 of 5 curricula. Duplicate slots:
  0. New lessons: 0.
- The other 613 lessons in those curricula are identical as whole rows, including all 396 of the
  families' own completions (166 of them with recorded time).
- The other 58 inventory rows (sign-off, review, hold) are identical as whole rows.
- Completed counts match the review: A 572, B 629, C 219, D 585. Report and PDF hours fell by 17.5
  estimated hours (A 8.5, B 5.0, C 3.0, D 1.0). No transcript course has been rewritten yet; the
  three calculated courses (A x2, C) update on their next page open.
- Batch one is intact: all 165 are still undone in their slot, 0 touched since, 98 below-start
  still hidden, 67 pins and dates kept, 88 pointers unchanged, 0 duplicate slots, and the other
  10,498 lessons unchanged.

Still pending, untouched: sign-off 12, review 40, holds 6. The integrity routine is still paused.

## Review: the 12 inferred-slot lessons (read-only, 2026-09-30)

Nothing was written. Families are labelled E to J so they don't collide with A to D (batch two).
Source: the batch-two frozen inventory (`recovery_20260925_inventory`, 02:05 UTC) plus live data.

**Rechecked live, all 12:**
- Each still matches its 09-25 fingerprint, and no row has been edited since the run.
- None has been re-logged as an extra, and none has recorded time (minutes NULL, hours 0).
- Every curriculum's starting lesson, pointer and archived flag equal the frozen values. None is
  archived.
- Each curriculum has exactly one empty slot and exactly one unslotted affected lesson.

**The shared shape (11 of 12):** lesson N lost its slot, lesson N-1 sits in slot N, and slot N-1 is
the only empty slot. That is what a Plan drag leaves: the pre-#102 `move_lesson_to_date` swaps the
two slots, the family ticks N-1, the pointer jumps to slot N, and the 09-25 statement completed N
behind it and erased its slot. In every case the lesson in slot N has not been written since before
the run (updated_at < run time), so it held slot N when the statement ran, and lesson N cannot have
been in slot N.

### Tier 1: strongly supported (7 lessons). Recommend.

| Family | Curriculum | Lesson -> slot | Pre-damage evidence |
|---|---|---|---|
| F | twin curricula x2 | 11 -> 10 | On 09-22 13:38, the audit clears lesson 11's scheduled date within 0.2 s of lesson 10's completion in slot 11: the pointer passed an open lesson 11 sitting behind slot 11. One later write in each curriculum (a completion in its own numbered slot) cannot touch slot 10. |
| G | twin curricula x2 | 11 -> 10 | On 09-22 01:10, lesson 10 is dragged (`plan_move`, pinned) onto lesson 11's day; lesson 11's scheduled date is cleared 14 s later. That is a recorded swap before the run. No writes since the run. |
| H | 1 | 6 -> 5 | Lesson 5's pre-completion source was `plan_move` (a drag). On 09-24 13:33 its completion and the clearing of lesson 6's scheduled date are 0.4 s apart. No writes since the run. |
| I | 1 | 14 -> 13 | Lesson 13's pre-completion source was `plan_move`. On 09-23 19:27, lesson 14 is cleared 0.4 s after lesson 13's completion. 485 later writes are date shifts and moves, all on rows in their own numbered slot. |
| J | 1 | 13 -> 12 | On 09-22 18:58, lesson 13 is cleared within 25 ms of lesson 12's completion in slot 13. 107 later writes are all on rows in their own numbered slot. |

Assumption: no drag is recorded for F's and J's slot-N lesson (it happened before the audit began
on 09-21, or carried no date change). The support is the audit timing plus the single empty slot.
Uncertainty is low.

### Tier 2: supported by the own-number rule (1 lesson). Recommend, flagged.

| Family | Lesson -> slot | Evidence |
|---|---|---|
| F | 9 -> 9 | The empty slot is the lesson's own number, with 8 in 8 and 10 in 10. The curriculum counts as "drifted" only because of a 24/25 swap the family made on 09-28/29. **Flag:** its source is `cleanup_sql` (an earlier repair), so it may already have had no slot before 09-25. It is below the starting lesson (9 < 17), so hide-below-start keeps it invisible either way. |

### Tier 3: not sufficiently supported (4 lessons, Family E). Hold.

Lessons 3 -> 2, 7 -> 6, 4 -> 3 and 6 -> 5 in four curricula. The shape matches (lesson N-1 was
dragged, pinned `plan_move`, and completed on Aug 25; pointer = N; nothing written since the run).
**But every one has source `cleanup_sql` and a pin on Aug 24.** That is the signature of the earlier
phantom-repair step that pins "reverted rows the projector cannot place" (CLAUDE.md step 5), rows
that typically had **no slot**. Everything predates the audit table (begins 09-21), so there is no
record either way. If they were slotless before 09-25, the empty slot was a gap the auto-heal did
not create, and restoring into it would make a placement that never existed.

Options for E, your call:
- **(a) Hold as is.**
- **(b) Completion-only.** Undo the completion and leave the slot empty, which matches the
  most likely pre-heal state. This needs a small template change and a rehearsal.

The visible result is the same either way. Three are below their starting lesson and stay hidden.
One (lesson 6, start 5) stays pinned on Aug 24 and reappears on Plan as unfinished on that day,
which is how the earlier repair left it.

### Preview for the recommended 8 (hide-below-start on)

| Family | Lessons | Today | Plan | Completed count | Report and PDF hours | Linked transcript |
|---|---:|---|---|---|---|---|
| F | 3 | no change | no change (all hidden) | 148 -> 145 | -1.5 h | none linked |
| G | 2 | no change | no change | 148 -> 146 | -1.0 h | none linked |
| H | 1 | no change | no change | 842 -> 841 | -0.5 h | none linked |
| I | 1 | no change | no change | 816 -> 815 | -0.5 h | 1 calculated course: rounds to 8 h either way |
| J | 1 | no change | no change | 150 -> 149 | -0.5 h | 1 calculated course: next page open writes 8 h instead of 9 (stored value currently empty) |
| **Total** | **8** | | | **-8** | **-4.0 h** | **-1 h, one course** |

- **Today:** unchanged. Every restored slot is below the pointer and none is pinned for today or
  later, so the next lesson and the pointer stay the same.
- **Plan:** unchanged. The 7 at or after their start are unpinned with no scheduled date (they
  stay hidden behind the pointer, like the 20 pointer-hidden lessons in batch one). The one below
  its start is already unpinned and undated.
- **Family E (held):** it would be 48 -> 44 completed and -2.0 h; its two calculated transcript
  courses round the same either way.

**Before an apply:** `apply-template.sql` approves a whole class, and the recommendation is 8 of
the 12. That needs either an explicit lesson-id allowlist in the script, or the 4 Family E rows
re-marked as held in the frozen inventory, and a staging rehearsal of whichever is chosen. Re-freeze
right before applying: Families F, I and J are actively using these curricula.

## Tier 1 allowlist: 7 inferred-slot lessons (staging rehearsal, 2026-09-30)

Nothing was written to production.

**Tested commit: 038ae64** (`apply-template.sql`). It adds `v_lesson_ids uuid[] := null`:
- NULL keeps the old whole-class behaviour, and a list narrows the run to exactly those lessons.
- Approving `UNDO_restore_only_hole_SIGNOFF` without a list aborts.
- A listed id that is missing from the inventory, duplicated, or under a class that isn't approved
  aborts before any lock. So does an empty list.
- Every inventory lesson the run does not target, in any curriculum, must be whole-row identical
  before and after.
- The script never writes the inventory, so the original classifications stay as they are (the
  excluded five stay `UNDO_restore_only_hole_SIGNOFF` in the frozen table).

**Allowlist for the production apply** (paste into `v_lesson_ids`, with
`v_classes := array['UNDO_restore_only_hole_SIGNOFF']`):

| Family | Curriculum | Lesson -> slot | Lesson id |
|---|---|---|---|
| F | twin A | 11 -> 10 | 162ab7fe-2357-4a90-9054-4e31e6f1ccae |
| F | twin B | 11 -> 10 | e12f4763-1c28-445a-bbac-56987105921f |
| G | twin A | 11 -> 10 | c3314d39-c45d-46ed-a202-af78a58530b0 |
| G | twin B | 11 -> 10 | 7e03daaf-b9a2-40c0-a93a-0ddb5b9152f8 |
| H | 1 | 6 -> 5 | d3cd303d-5721-4c61-99ce-0966c15d5274 |
| I | 1 | 14 -> 13 | acc03397-96a4-4498-9278-7e4eaae6ef2e |
| J | 1 | 13 -> 12 | 9c914f5a-ef7e-43a6-812e-29a0ac283f49 |

```sql
v_lesson_ids uuid[] := array[
  '162ab7fe-2357-4a90-9054-4e31e6f1ccae', 'e12f4763-1c28-445a-bbac-56987105921f',
  'c3314d39-c45d-46ed-a202-af78a58530b0', '7e03daaf-b9a2-40c0-a93a-0ddb5b9152f8',
  'd3cd303d-5721-4c61-99ce-0966c15d5274', 'acc03397-96a4-4498-9278-7e4eaae6ef2e',
  '9c914f5a-ef7e-43a6-812e-29a0ac283f49']::uuid[];
```

Excluded and left as classified: Family F lesson 9 (e98d941b-7f92-48e5-8255-926bf0670b36) and
Family E's four (48f75cd9-df75-4f1b-9257-bbb5619473d5, ed8fe390-91f5-4306-8ff2-df9244a77f73,
d285d379-4533-4764-8836-4f3d0b2b6e2b, 216fbfb6-c5ea-4d1d-b9ba-b0c033d80f5d).

**Production re-check (read-only, after the rehearsal):** all 7 are still `SIGNOFF` in the frozen
inventory, still match their fingerprint, sit in curricula with unchanged starting lessons,
pointers and archived flags, and their target slot is still empty. None has recorded time, none is
below its starting lesson, and none is pinned or dated.

**Staging rehearsal.** A synthetic family had five curricula:
- two listed curricula with the drag-swap shape, lesson 4 -> slot 3;
- one unlisted curriculum with the same shape (stands in for Family E);
- one unlisted own-number sign-off (stands in for F lesson 9);
- one certain-slot lesson (a class that isn't approved).

Later parent work came after the replayed damage: a completion with 25 minutes in S1 and a note in
S2. The inventory was frozen with the committed `inventory.sql`, and the staging function body
matched 038ae64 (hash b0e6184a..., 203 lines; the only difference is that `v_classes` and
`v_lesson_ids` are parameters).

| Test | Result |
|---|---|
| Sign-off class with no list | Aborted: "needs an explicit v_lesson_ids list" |
| List with an id not in the inventory | Aborted, naming the id |
| List with the certain-slot lesson (class not approved) | Aborted, naming it and its class |
| Duplicated id / empty list | Aborted |
| Stale: listed curriculum's starting lesson 1 -> 3 | Aborted: start [1, 3] |
| Stale: a drag fills the listed lesson's empty slot | Aborted: slot [3, 7] |
| Stale: listed lesson re-logged as an extra | Aborted: now HOLD_relogged_as_extra |
| Stale: family ticks a later lesson (pointer 5 -> 6) | Aborted: pointer [5, 6] |
| Change only to an UNLISTED curriculum | Did not block the listed run (passed inside a rolled-back test) |
| Side effect touches an excluded lesson in another curriculum | Aborted: "an inventory lesson outside this run changed" |
| Clean run | 2 written: both un-completed in slot 3, pins and dates unchanged |
| Repeat run | Aborted: both now HOLD_family_acted_on_row |

After every abort the fixture was byte-identical to its snapshot. After the clean run:
- the 37 other lessons, including all three excluded inventory lessons (still completed with no
  slot), were whole-row identical;
- 5 of 5 pointers were unchanged, with 0 duplicate slots;
- the parent completion (25 minutes) and the note were intact.

Cleanup: user, curricula, lessons, snapshots, frozen inventory, functions and the temporary trigger
were all removed; 0 remain.

### Seven-lesson preview (hide-below-start on)

| Family | Lessons | Today | Plan | Completed count | Report and PDF hours | Linked transcript |
|---|---:|---|---|---|---|---|
| F | 2 | no change | no change | 148 -> 146 | -1.0 h | none linked |
| G | 2 | no change | no change | 148 -> 146 | -1.0 h | none linked |
| H | 1 | no change | no change | 842 -> 841 | -0.5 h | none linked |
| I | 1 | no change | no change | 816 -> 815 | -0.5 h | calculated course rounds to 8 h either way |
| J | 1 | no change | no change | 150 -> 149 | -0.5 h | calculated course: next open writes 8 h instead of 9 |
| **Total** | **7** | | | **-7** | **-3.5 h** | **-1 h, one course** |

Each lesson goes into the empty slot just behind the lesson that was dragged, below the pointer,
unpinned and undated. It stays hidden, and Today's next lesson doesn't change.

**Remaining assumptions:**
- **F and J.** No drag is recorded for the lesson now in slot N, because it predates the audit
  (21 Sep). The support is the audit timing: the lesson's schedule entry was cleared within 25 to
  200 ms of that lesson's completion. That alone shows the lesson sat behind it.
- **Slotted before the auto-heal.** All 7 carry a scheduler source (`queue_resync` or
  `catchup_spread`) and a projected date, which means they were in the queue. There is no direct
  record of their queue_position before 09-25; no table records slot history.
- **Queue order.** Restoring puts lesson N ahead of lesson N-1 in queue order. That is the order
  the family's drag created, not book order. Both lessons are behind the pointer, so nothing on
  Today or Plan changes.
- **Re-freeze.** Re-freeze right before applying. Families F, I and J are active in these
  curricula, and any change since the freeze aborts the run.
