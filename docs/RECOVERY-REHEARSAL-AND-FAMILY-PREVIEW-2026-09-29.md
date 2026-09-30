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
