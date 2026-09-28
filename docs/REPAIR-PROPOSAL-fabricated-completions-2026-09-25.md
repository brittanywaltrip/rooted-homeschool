# Repair proposal: the 250 completions written on 2026-09-25

Status: PROPOSAL ONLY. Nothing here has been run against production. It needs
Brittany's explicit go-ahead, per family, before any write.

## What happened

At 2026-09-25 15:11:35 UTC (08:11 PDT) the scheduled Claude task
`rooted-curriculum-integrity-check` ran its "drift G auto-heal" against
production through the Supabase MCP (role `postgres`, no signed-in user):

```sql
UPDATE lessons SET completed = true,
       completed_at = NOW() - interval '1 day',
       queue_position = NULL
 WHERE completed = false AND lesson_number <= goal.current_lesson AND no notes
```

It marked **250 lessons done in 123 curricula across 34 families**. None of
those families did those lessons that day. Every row carries the fingerprint
`completed_at = 2026-09-24 15:11:35.834303+00`. This is the only such run since
July: the task's six runs from 09-19 to 09-24 were declined for want of an
approval, and the 09-25 run went through.

Why the rows were "orphans" in the first place:
- `current_lesson` is MAX(`queue_position`) over completed rows, but the sweep
  compared `lesson_number`. After a Plan drag (`move_lesson_to_date`, the
  pre-#102 path, 2026-09-23) swapped two lessons' slots, the family ticked the
  lower-numbered lesson sitting in the higher slot, the pointer jumped over
  the other lesson, and the sweep then "healed" that lesson by completing it.
  Examples: Harrison family, Lewis's Gather Round: Chemistry lesson 6;
  brandylee341's Foundations of Homeschool lesson 21 and Math With Confidence K
  lesson 74.
- 179 of the 250 were **pinned** rows: make-ups (Invariant 23) and hand-placed
  lessons the family had put on a day. They vanished from Today and Plan.
- The rest were rows a family had deliberately left behind the pointer
  ("I'm actually on lesson X" with No history, a Builder starting position).

Nulling `queue_position` left an empty queue slot below the pointer in most of
the 123 curricula. That is the queue-slot gap reported on 2026-09-28.

## Scope, measured 2026-09-28 (read-only)

| Class | Rows | Proposed action |
|---|---|---|
| Untouched since 09-25 (`updated_at = 2026-09-25 15:11:35.834303+00`) | 247 | Revert (below), minus the exclusions |
| Touched by the family since (Ted Bendriem MWC lesson 2, Gilbert Harrison Chemistry lesson 5, Lewis Harrison Handwriting lesson 29) | 3 | **Leave.** The family has acted on them since; ask |
| Family already re-logged the same lesson as an extra (e.g. brandylee341 "Handwriting · Lesson 21") | 2 | **Leave.** Reverting would show the lesson as due again; ask |
| Carries logged minutes or hours | 2 | **Leave.** Check by hand |
| In an archived (closed-year) curriculum | 29 | Revert completion only, no slot work |

Dry-run classification (query below, run read-only 2026-09-28):
REVERT_restore_slot 165 rows (88 curricula, 25 families), REVERT_makeup_no_slot
50 (26, 12), REVERT_no_slot 29 (4, 3), LEAVE_touched_since 3, LEAVE_relogged 2,
LEAVE_carries_time 1. Total 250. (One of the two rows with time on it was also
touched since, so the dry run files it under touched_since.)

## The revert, per row

In ONE transaction, after writing every affected row to a backup table:

1. `completed = false, completed_at = NULL`. Un-completing is not blocked by
   the new guard, so no attestation is needed. The pointer recompute excludes
   rows with a NULL slot, so `current_lesson` does not move.
2. Give the slot back only where it is unambiguous: the goal's other slotted
   rows all satisfy `queue_position = lesson_number` and slot `lesson_number`
   is free. Otherwise leave it NULL. Never realign a goal with pinned,
   misaligned rows (CLAUDE.md, "carrying a family's own drag").
3. The row now sits behind the pointer. Surface it as a make-up so it shows as
   missed instead of vanishing: `queue_pinned = true`,
   `scheduled_date = date` (CLAUDE.md phantom-repair step 5, Invariant 23).
4. Assert inside the transaction that the counts match the dry run exactly,
   and that no row's `updated_at` changed since it was read. Otherwise raise
   and roll back.

Rehearse it on rooted-staging first against a clone of the affected goals'
shape (see `supabase/tests/completion-needs-a-person.sql` for the incident
replay). Check Today and Plan for each family afterwards.

Order matters (CLAUDE.md): any other update to these rows bumps `updated_at`
and destroys the fingerprint, so run nothing else against them first.

## Dry run (read-only)

```sql
with f as (
  select l.id, l.user_id, l.curriculum_goal_id, l.lesson_number, l.queue_position,
         l.queue_pinned, l.scheduled_date, l.date, l.hours, l.minutes_spent,
         l.updated_at, g.archived as goal_archived, g.current_lesson
    from lessons l join curriculum_goals g on g.id = l.curriculum_goal_id
   where l.completed and l.completed_at = '2026-09-24 15:11:35.834303+00')
select f.*,
  case
    when updated_at <> '2026-09-25 15:11:35.834303+00' then 'LEAVE_touched_since'
    when coalesce(hours,0) > 0 or coalesce(minutes_spent,0) > 0 then 'LEAVE_carries_time'
    when exists (select 1 from lessons x where x.curriculum_goal_id = f.curriculum_goal_id
                  and x.lesson_number is null and x.completed
                  and x.title ~* ('Lesson ' || f.lesson_number || '\M')
                  and x.created_at > '2026-09-25 15:11:35') then 'LEAVE_relogged'
    when goal_archived then 'REVERT_no_slot'
    when not exists (select 1 from lessons x where x.curriculum_goal_id = f.curriculum_goal_id
                      and x.queue_position is not null and x.queue_position <> x.lesson_number)
     and not exists (select 1 from lessons x where x.curriculum_goal_id = f.curriculum_goal_id
                      and x.queue_position = f.lesson_number) then 'REVERT_restore_slot'
    else 'REVERT_makeup_no_slot'
  end as action
from f order by user_id, curriculum_goal_id, lesson_number;
```

## Also found, not part of this repair

- The same task's "drift Z" section still says zombie lessons are "always safe
  to delete in batch", which contradicts its own no-DELETE rule. Worth
  removing.
- `move_lesson_to_date` still renumbers slots for moves to an EARLIER day, so
  new slot swaps can still happen. A lesson left behind the pointer that way
  is invisible on Today and unscheduled on Plan until a family says
  "I'm actually on lesson X".
