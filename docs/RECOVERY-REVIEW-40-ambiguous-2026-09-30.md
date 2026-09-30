# Review: the 40 ambiguous-slot lessons (read-only, 2026-09-30)

Production reads only. Nothing was written, and no family was contacted. The lessons were
reconciled against the latest frozen inventory (`rooted_private.recovery_20260925_inventory`,
batch four, frozen 04:51 UTC) and its backup (`recovery_20260925_b4_backup`). Families are labelled
K to Q, continuing after J.

## What is proven, and what isn't

Per lesson, live, all 40:
- The completion still carries the statement's fingerprint: `completed_at` = the run's fingerprint
  and `updated_at` = the run time. It is whole-row identical to the batch-four backup.
- No recorded time (minutes NULL, hours 0), and no re-logged replacement. Either of those would
  have classified it as held.
- Starting lesson, pointer and archived flag equal the frozen inventory. None is archived.

**Classification:**
- **Proven false completion: 40 of 40.** The 09-25/26/27 statement only completed rows that were
  open, and nobody has touched these since. One is doubly clear: Family P's lesson 5 had been
  un-ticked by the family on 09-26 (source `manual_uncomplete`) and was re-completed by the
  statement the same day.
- **Genuine parent work: 0.** There is no parent edit, no recorded time, and no re-logged lesson.
  The unique (curriculum, lesson_number) constraint rules out a second row for the same lesson.
- **Insufficient evidence: the slot, for all 40.** Each curriculum has several empty slots or
  several affected lessons, often with heavy drift (up to 134 moved rows), so no single slot can be
  proven. Some are plausible (Family K's twin curricula look like a lesson 4/5 swap; Family L's
  empty slots 31-39 equal its lesson numbers). Plausible is not proven, so **no slot is proposed**.

**Proposed repair: completion-only.** Un-complete the lesson and leave `queue_position` NULL, with
hide-below-start on. This is the mode used for Family F lesson 9 (98eda88). Its effects follow from
the code trace in `RECOVERY-REHEARSAL-AND-FAMILY-PREVIEW-2026-09-30-completion-only.md`:
- **Today, the missed-work prompt and the catch-up:** never show a lesson without a slot.
- **Plan:** draws a pinned, dated, uncompleted lesson on its date (a missed pill if past). An
  undated one appears nowhere.
- **Pointer:** unchanged. The pointer is the highest completed slot, and none of these holds one.
- **Schedule Builder:** a save deletes an unslotted open lesson whose number is above the
  curriculum's highest completed lesson (unless it carries notes or minutes). ~~With "record
  history" ticked, it can re-create it as completed.~~ **Corrected 2026-09-30:** record history only
  backfills brand-new curricula, so on an existing curriculum a deleted lesson is just gone.

## The three groups

### A. Hidden, Builder-safe (27). Recommend.

Below the starting lesson (26) or unpinned and undated (1): no visible change. Each is below its
curriculum's highest completed lesson, so a Builder save keeps it.

| Family | Curriculum | Lessons | Lesson ids |
|---|---|---|---|
| K | cb201868 | 1, 2 | ed7a18ad-1ca2-4af1-b92f-03f5a948bbe3, 355d1a50-a8e6-4817-9a95-996cbfdfe93a |
| L | af251b44 | 31-39 | a9815257-7035-4fd1-9b27-a7b3c7762c66, 42e52fa1-14bd-48af-a49d-352c0c8e22ae, 5f95cf0f-1779-4261-be39-a4a0f590902d, f111fe85-df1e-4dbe-813e-a94fed569c60, be103808-ec76-4210-9bfa-3b4f52d9347e, c8fe2599-9746-478f-88a7-7b61021db46d, 9792015b-c320-49d8-81c5-05e9602817e8, 44330a48-e9fb-403e-b48d-6ecc62edf493, 1514cb20-4616-4d90-a850-84019e59fb5c |
| M | d5ff0d26 | 3, 4 | 6ce77730-8968-4951-9035-dbc29440abf0, 20222bdf-6d22-4110-b52f-258f7337ce98 |
| N | 1d2af23e | 8, 13, 16, 17 | cc6690f7-e41a-4026-9369-b89faf3d44cd, 8f1e58b4-4d2a-40a6-b1cb-13a8cba581cd, 5de511ab-d88e-4837-85c8-cc8179ef5cc4, 937d71aa-deab-4a41-b313-5d042f380923 |
| N | 255b9ed9 | 2 | 0e894880-4a25-443a-b83b-26f51b85692e |
| O | f0b2675a | 2, 3, 7, 8 | a09595b1-c3e3-4bac-bf37-ba4cfdaa0e1c, 46570b93-a2ee-4c17-8f70-596963677693, 80aa4d0f-d81e-4be9-bacc-868d5ca4b90f, b658e6b0-694f-4b85-808a-a69f97368a8a |
| P | 01d9bf53 | 5 | 4204d27c-21d5-4f13-87de-a42cdda057a2 |
| P | 7f00152c | 39 (unpinned, undated) | 437023da-8941-453c-886a-85363aab0d28 |
| Q | 2d74cadb | 23, 26, 28 | ac9db6a1-e942-4523-b533-f1c03cfcb79d, 5b6ed098-fc34-4f9e-87c8-557af78ebc07, 48a5ad5f-eb0d-4124-b29e-314ed6e5d03f |

Hide-below-start clears the pin and date on the 25 pinned or dated rows among the 26 below start.
The old values are in the backup.

### B. Visible on Plan, Builder-safe (8). Recommend, with an OK for the Plan change.

At or after the starting lesson, pinned on a past day. After completion-only each shows on Plan as
**missed** on that day, as batch one's 47 did. Each is still below the curriculum's highest
completed lesson, so a Builder save keeps it.

| Family | Curriculum | Lesson | Plan day | Lesson id |
|---|---|---:|---|---|
| K | 22fdeaba | 3 | Aug 20 | 225388b0-be82-4502-a40f-6196170817b0 |
| K | 7ae3cc2d | 6 | Aug 22 | b46c607b-1389-476b-b10b-4c5ad54e407e |
| K | 7d8bfa2b | 3 | Aug 20 | 5fbc7a56-7ea4-4303-b8a8-65aa7343155a |
| K | a7ff8d0b | 5 | Aug 20 | 01323ddd-5c7c-4aca-99bf-a50aa87dd637 |
| K | a7ff8d0b | 6 | Sep 2 | 0215bdc0-4313-4e90-aef0-857f12d82abd |
| M | b5235fa4 | 3 | Aug 23 | a768c775-55c9-4be8-9a8a-b99e9116c678 |
| M | d5ff0d26 | 5 | Aug 24 | 475e52f0-983a-4f9e-b9ac-340171a0a2b3 |
| P | 7f00152c | 38 | Sep 25 | 55c29cea-7d59-4842-ad04-bf07286cea0c |

### C. Hold (5)

Visible on Plan **and** exposed to Builder-save deletion: each lesson number is above the
curriculum's highest completed lesson once un-completed.

| Family | Curriculum | Lesson | Why held | Lesson id |
|---|---|---:|---|---|
| K | 22fdeaba | 5 | pinned Aug 31; Builder-deletable (floor 4) | 5072c4eb-8de0-4ebb-8ad3-efe53609ebe9 |
| K | 7ae3cc2d | 8 | pinned Sep 2; Builder-deletable (floor 7) | f38ed3cf-6fe5-4bef-b8be-f98ff739a0cd |
| K | 7d8bfa2b | 5 | pinned Aug 31; Builder-deletable (floor 4) | d4bd38e1-8e16-4680-b6fc-f9dc37df1b7a |
| M | b5235fa4 | 6 | pinned Aug 24; Builder-deletable (floor 5) | 7ff15341-0e83-426c-9896-2b144ddcdde5 |
| P | 01d9bf53 | 8 | family pinned it to **Oct 2 (future)**; without a slot, Today would not show it that day, only Plan. Builder-deletable (floor 7) | 597ac7cd-139e-412a-aba4-b4ff80054c46 |

These five are the ones where a slot matters. They should wait for either a supported slot or a
Builder change that protects unslotted open lessons.

## Preview for the recommended 35 (A + B)

| Family | Lessons (A + B) | Today | Plan | Completed count | Report and PDF hours | Linked transcript (calculated, next page open) |
|---|---|---|---|---|---|---|
| K | 7 (2 + 5) | no change | 5 lessons back as missed (Aug 20 x3, Aug 22, Sep 2) | 70 -> 63 | -3.5 h | 22fdeaba 3 -> 2 h; 7ae3cc2d rounds the same (4 h) |
| L | 9 (9 + 0) | no change | no change | 70 -> 61 | -4.5 h | none linked |
| M | 4 (2 + 2) | no change | 2 back as missed (Aug 23, Aug 24) | 97 -> 93 | -2.0 h | b5235fa4 rounds the same (3 h) |
| N | 5 (5 + 0) | no change | no change | 48 -> 43 | -2.5 h | none linked |
| O | 4 (4 + 0) | no change | no change | 129 -> 125 | -2.0 h | none linked |
| P | 3 (2 + 1) | no change | 1 back as missed (Sep 25) | 817 -> 814 | -1.5 h | 7f00152c 5 -> 4 h; 01d9bf53 rounds the same (4 h) |
| Q | 3 (3 + 0) | no change | no change | 68 -> 65 | -1.5 h | none linked |
| **Total** | **35** | | **8 on Plan** | **-35** | **-17.5 estimated h** | **-2 h over 2 courses** |

- **Hours:** all removed hours are estimated (30 minutes per lesson with no recorded time). No
  recorded time is touched, because none of the 40 has any, and the families' own recorded time on
  other lessons is outside the write set.
- **Transcripts:** no linked transcript course has been written since before the first run (the
  latest is Sep 10), so no stored number absorbed these completions.

## Before approval: script change and staging rehearsal

`apply-template.sql` (98eda88) refuses every non-UNDO class ("HOLD and REVIEW rows are never
written here"), so these cannot run as it stands. The change needed:
- Allow `REVIEW_slot_ambiguous` **only** when `v_completion_only = true` and `v_lesson_ids` is set.
- Keep every other guard: post-lock revalidation (live class must still be REVIEW; start, pointer
  and archived unchanged), whole-row checks on other lessons and on every untargeted inventory row,
  targets must end unslotted, pointer, below-start and duplicate-slot guards.
- Recommended addition: an optional `v_require_builder_safe` guard that aborts if any target's
  lesson_number is above its curriculum's highest completed lesson (group C's exposure), so a
  Builder-exposed lesson cannot slip into a batch.

Staging rehearsal to run against that exact commit:
1. A drifted curriculum with several empty slots and several affected lessons (REVIEW), one below
   start and one at start with a past pin; a heavy-drift curriculum; one lesson un-ticked by the
   family before the run; later parent work (a timed completion, a note).
2. Refusals: REVIEW without completion-only, completion-only without a list, a HOLD or unlisted id
   in the list, and (if added) a Builder-exposed lesson under the builder-safe guard.
3. Stale: starting lesson change, re-logged extra, a later completion moving the pointer, and a
   drag that turns REVIEW into SIGNOFF. Each must abort with the fixture byte-identical.
4. Clean run: targets un-completed with the slot still NULL, below-start hidden, at-start pins and
   dates kept, pointers unchanged, other lessons and all untargeted inventory rows whole-row
   identical. Repeat run aborts.

## Uncertainties

- **Pre-damage slots are unknown** for all 40. Completion-only avoids guessing.
- **Plan:** group B's 8 would reappear on Plan as missed. They were pinned make-ups at or after the
  start, as the families had them before 09-25.
- **Builder:** groups A and B are Builder-safe as of today. A family completing more lessons only
  raises the floor, while un-ticking lessons could lower it. The apply should re-check (the
  proposed builder-safe guard).
- **Activity:** Families P and Q are active in these curricula (other rows written since the run).
  Re-freeze right before applying.

Untouched by this review: Family E's four and the six held lessons. The integrity routine is still
paused.
