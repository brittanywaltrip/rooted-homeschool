-- GUARDED RECOVERY TEMPLATE for the 2026-09-25 false completions.
--
-- DO NOT RUN ON PRODUCTION until ALL of these are true:
--   1. Brittany has approved, in writing, which ACTION classes to run
--      (docs/RECOVERY-PLAN-false-completions-2026-09-25.md). There is no
--      "run everything" mode: the class list below starts empty.
--   2. inventory.sql has been re-run the same day and its counts match the plan.
--   3. rehearsal.sql has passed on rooted-staging against this exact file.
--   4. A human is watching, and Sentry is open for the affected families.
--
-- What it does, per approved row, in ONE transaction:
--   completed    true  -> false
--   completed_at the statement's fingerprint -> NULL
--   queue_position NULL -> unchanged, whatever the class (v_completion_only)
--   queue_position NULL -> lesson_number (UNDO_restore_slot)
--                       -> the one empty slot (UNDO_restore_only_hole_SIGNOFF)
--                       -> stays NULL (UNDO_archived)
-- For a row BELOW the family's starting lesson (lesson_number <
-- start_at_lesson), and only when v_hide_below_start is true (the default,
-- per Brittany 2026-09-28): also queue_pinned -> false and scheduled_date ->
-- NULL, so a lesson the family chose to start past can never show as missed
-- work. The previous pin and date are kept in the backup table (step 0).
-- Otherwise nothing else on the row changes: not the dates, not the pin, not
-- the source. No other row is written.
--
-- Guards, any failure raises and rolls back everything:
--   * each target row must still be exactly as its run left it:
--     completed, completed_at = that run's fingerprint, updated_at = that run's time,
--     queue_position NULL. A row the family has touched since is skipped by
--     construction and the count check then fails loudly.
--   * after the locks are taken, every approved row is classified again from
--     live data with the inventory's rules, and each curriculum's
--     start_at_lesson, archived flag and current_lesson must equal the
--     inventory's. Any difference (a settings change since the inventory)
--     aborts before anything is written.
--   * the number of rows written must equal the number approved.
--   * every affected curriculum's current_lesson must be unchanged. The
--     pointer is GREATEST(start_at_lesson - 1, MAX(completed slot)); the rows
--     being reverted hold no slot while completed, so it cannot move. If it
--     does, something is wrong and nothing is kept.
--   * every OTHER lesson in those curricula (the family's own work, including
--     everything they did after 2026-09-25) must be byte-identical before and
--     after, compared as whole rows (to_jsonb, every column, updated_at
--     included). Each approved row must also be identical apart from the
--     columns this run writes.
--   * no curriculum may end up with two lessons in one slot.
--   * REVIEW_slot_ambiguous may be approved only together with
--     v_completion_only and v_lesson_ids; HOLD rows are never written.
--   * with v_completion_only, after the locks: every target must be safe from
--     Schedule Builder deletion as the curriculum will stand after the run
--     (lesson_number <= the highest completed lesson_number that remains,
--     skipped, or carrying notes or minutes); otherwise the run aborts.
--   * with v_completion_only: no slot is written (queue_position keeps its
--     current NULL) and every target must still have none afterwards. The
--     revalidation still requires each lesson's live classification, slot
--     evidence and curriculum settings to match the frozen inventory.
--   * with v_lesson_ids set: only those lessons are written; a listed id that
--     is missing, duplicated or outside the approved classes aborts before any
--     lock; and every inventory lesson NOT targeted, in any curriculum, must be
--     whole-row identical before and after.
--
-- Un-completing is not blocked by lessons_block_server_side_completion, so no
-- completion attestation is needed or set.
--
-- Usage: first freeze today's inventory (step 0), then edit v_classes (and
-- v_lesson_ids when approving individual lessons), then run the DO block. For a rehearsal, rehearsal.sql substitutes the staging
-- fingerprint and run time.

-- ── Step 0: freeze the inventory the approval was given against ────────────
-- create table rooted_private.recovery_20260925_inventory as
--   <the SELECT from inventory.sql>;
-- create table rooted_private.recovery_20260925_backup as
--   select l.* from public.lessons l
--    where l.id in (select lesson_id from rooted_private.recovery_20260925_inventory);

-- ── Step 1: the revert ─────────────────────────────────────────────────────
do $recover$
declare
  -- Each row carries its own run's fingerprint (run_fp = completed_at the
  -- statement wrote) and run time (run_t = updated_at it stamped) in the
  -- frozen inventory: the routine ran three times (09-25, 09-26, 09-27).
  -- APPROVED CLASSES. Starts empty on purpose. Allowed values:
  --   'UNDO_restore_slot', 'UNDO_restore_only_hole_SIGNOFF', 'UNDO_archived',
  --   and 'REVIEW_slot_ambiguous' ONLY with v_completion_only and v_lesson_ids.
  v_classes  text[] := array[]::text[];
  -- APPROVED LESSONS. NULL means every row of the approved classes. A list
  -- narrows the run to exactly these lesson ids, each of which must be in the
  -- frozen inventory under an approved class; the inventory's classification
  -- is never edited. Required whenever UNDO_restore_only_hole_SIGNOFF is
  -- approved, because that class is signed off lesson by lesson.
  v_lesson_ids uuid[] := null;
  -- COMPLETION-ONLY. When true, approved lessons are un-completed but keep
  -- the queue_position they have now (NULL for every row the statement
  -- touched): no slot is written. It is a mode of this run, not a new class,
  -- so the inventory's classification is unchanged. It requires v_lesson_ids,
  -- and every target must still have no slot afterwards.
  v_completion_only boolean := false;
  -- Keep lessons below the family's starting lesson hidden (Brittany, 2026-09-28).
  v_hide_below_start boolean := true;
  v_leaked   int;
  v_targets  uuid[];
  v_goals    uuid[];
  v_expected int;
  v_written  int;
  v_ptr_before jsonb;
  v_ptr_after  jsonb;
  v_rest_before jsonb;
  v_rest_after  jsonb;
  v_tgt_before  jsonb;
  v_tgt_after   jsonb;
  -- The only columns an approved row may change (updated_at is stamped by
  -- lessons_set_updated_at).
  v_writable text[] := array['completed', 'completed_at', 'queue_position',
                             'queue_pinned', 'scheduled_date', 'updated_at'];
  v_live_rows int;
  v_drift    jsonb;
  v_dupes    int;
  v_bad_ids  jsonb;
  v_inv_rest_before jsonb;
  v_inv_rest_after  jsonb;
  v_slotted  int;
  v_builder_risk jsonb;
begin
  if coalesce(array_length(v_classes, 1), 0) = 0 then
    raise exception 'recovery: no classes approved; edit v_classes first';
  end if;
  if exists (select 1 from unnest(v_classes) c
              where c not in ('UNDO_restore_slot', 'UNDO_restore_only_hole_SIGNOFF', 'UNDO_archived',
                              'REVIEW_slot_ambiguous')) then
    raise exception 'recovery: only UNDO_* classes (and REVIEW_slot_ambiguous, completion-only) may be run; HOLD rows are never written here';
  end if;
  -- An ambiguous slot is never guessed: those lessons may only be
  -- un-completed, with no slot written, and only when listed one by one.
  if 'REVIEW_slot_ambiguous' = any(v_classes) and not (v_completion_only and v_lesson_ids is not null) then
    raise exception 'recovery: REVIEW_slot_ambiguous needs v_completion_only = true and an explicit v_lesson_ids list';
  end if;

  if 'UNDO_restore_only_hole_SIGNOFF' = any(v_classes) and v_lesson_ids is null then
    raise exception 'recovery: UNDO_restore_only_hole_SIGNOFF needs an explicit v_lesson_ids list';
  end if;
  if v_completion_only and v_lesson_ids is null then
    raise exception 'recovery: completion-only needs an explicit v_lesson_ids list';
  end if;
  if v_lesson_ids is not null then
    if coalesce(array_length(v_lesson_ids, 1), 0) = 0 then
      raise exception 'recovery: v_lesson_ids is empty';
    end if;
    if (select count(distinct x) from unnest(v_lesson_ids) x) <> array_length(v_lesson_ids, 1) then
      raise exception 'recovery: v_lesson_ids lists a lesson twice';
    end if;
    select jsonb_agg(jsonb_build_object('lesson', x, 'inventory_action', i.action))
      into v_bad_ids
      from unnest(v_lesson_ids) x
      left join rooted_private.recovery_20260925_inventory i on i.lesson_id = x
     where i.lesson_id is null or not (i.action = any(v_classes));
    if v_bad_ids is not null then
      raise exception 'recovery: listed lessons are not in the inventory under an approved class: %', v_bad_ids;
    end if;
  end if;

  select array_agg(lesson_id), array_agg(distinct curriculum_goal_id), count(*)
    into v_targets, v_goals, v_expected
    from rooted_private.recovery_20260925_inventory
   where action = any(v_classes)
     and (v_lesson_ids is null or lesson_id = any(v_lesson_ids));
  if v_expected = 0 then
    raise exception 'recovery: the approved classes select no rows';
  end if;

  -- Lock the curricula first, then their lessons: the order every scheduler
  -- RPC takes, so a family action in flight waits instead of interleaving.
  -- The FOR UPDATE on each curriculum also blocks a new lesson being inserted
  -- into it (the insert's foreign key check needs a KEY SHARE lock on the
  -- curriculum row), so the set of lessons cannot grow under us either.
  perform 1 from public.curriculum_goals where id = any(v_goals) order by id for update;
  perform 1 from public.lessons where curriculum_goal_id = any(v_goals) order by id for update;

  -- Revalidate the approval against live data, now that nothing can move.
  -- Every approved row is classified again with the inventory's own rules,
  -- and each curriculum's starting lesson, archived flag and pointer must be
  -- what the inventory recorded. A settings change between the inventory and
  -- this run (a new starting lesson, an archive or unarchive, a drag that
  -- fills or opens a slot, a lesson re-logged as an extra) aborts the whole
  -- run: re-run inventory.sql and get the new counts approved instead.
  with fps as (
    select distinct run_fp from rooted_private.recovery_20260925_inventory
  ),
  g as (
    select cg.id, cg.start_at_lesson, cg.archived, cg.current_lesson,
      exists (select 1 from public.lessons x
               where x.curriculum_goal_id = cg.id and x.queue_position is not null
                 and x.queue_position <> x.lesson_number) as drifted,
      (select array_agg(s order by s) from generate_series(1,
          (select coalesce(max(x.queue_position), 0) from public.lessons x where x.curriculum_goal_id = cg.id)) s
        where not exists (select 1 from public.lessons x
                           where x.curriculum_goal_id = cg.id and x.queue_position = s)) as holes,
      (select count(*) from public.lessons x
        where x.curriculum_goal_id = cg.id and x.completed and x.queue_position is null
          and x.completed_at in (select run_fp from fps)) as unslotted_affected
      from public.curriculum_goals cg
     where cg.id = any(v_goals)
  ),
  live as (
    select i.lesson_id, i.action, i.start_at_lesson, i.goal_archived, i.current_lesson, i.eliminated_slot,
      g.start_at_lesson as live_start, g.archived as live_archived, g.current_lesson as live_pointer,
      case
        when not (l.completed and l.completed_at = i.run_fp and l.updated_at = i.run_t
                  and l.queue_position is null)                         then 'HOLD_family_acted_on_row'
        when coalesce(l.hours, 0) > 0 or coalesce(l.minutes_spent, 0) > 0 then 'HOLD_carries_time'
        when exists (select 1 from public.lessons x
                      where x.curriculum_goal_id = l.curriculum_goal_id and x.lesson_number is null
                        and x.completed and x.title ~* ('Lesson ' || l.lesson_number || '\M')
                        and x.created_at > i.run_t)                      then 'HOLD_relogged_as_extra'
        when g.archived                                                  then 'UNDO_archived'
        when not g.drifted and not exists (select 1 from public.lessons x
                      where x.curriculum_goal_id = l.curriculum_goal_id
                        and x.queue_position = l.lesson_number)          then 'UNDO_restore_slot'
        when g.drifted and g.unslotted_affected = 1
             and coalesce(array_length(g.holes, 1), 0) = 1               then 'UNDO_restore_only_hole_SIGNOFF'
        else                                                                  'REVIEW_slot_ambiguous'
      end as live_action,
      case when g.drifted and g.unslotted_affected = 1
                and coalesce(array_length(g.holes, 1), 0) = 1 then g.holes[1] end as live_slot
      from rooted_private.recovery_20260925_inventory i
      join public.lessons l on l.id = i.lesson_id
      join g on g.id = i.curriculum_goal_id
     where i.lesson_id = any(v_targets)
  )
  select count(*),
         jsonb_agg(jsonb_build_object(
           'lesson', lesson_id,
           'approved', action, 'now', live_action,
           'start', jsonb_build_array(start_at_lesson, live_start),
           'archived', jsonb_build_array(goal_archived, live_archived),
           'pointer', jsonb_build_array(current_lesson, live_pointer),
           'slot', jsonb_build_array(eliminated_slot, live_slot)))
           filter (where live_action <> action
                      or live_start is distinct from start_at_lesson
                      or live_archived is distinct from goal_archived
                      or live_pointer is distinct from current_lesson
                      or (action = 'UNDO_restore_only_hole_SIGNOFF'
                          and live_slot is distinct from eliminated_slot))
    into v_live_rows, v_drift
    from live;
  if v_live_rows <> v_expected then
    raise exception 'recovery: % of % approved lessons still exist in their curriculum. Nothing kept.', v_live_rows, v_expected;
  end if;
  if v_drift is not null then
    raise exception 'recovery: % approved lessons no longer match the inventory (approved vs now): %. Re-run inventory.sql. Nothing kept.',
      jsonb_array_length(v_drift), v_drift;
  end if;

  -- Schedule Builder guard (completion-only). planPhase2Rows (scheduler.ts)
  -- deletes an open, unskipped lesson with a lesson_number above the
  -- curriculum's completedFloor (the highest lesson_number among completed
  -- rows) unless it carries work (non-blank notes, or minutes_spent set).
  -- A slotless lesson gets no "behind the pointer" protection, and a pin
  -- only protects it on saves that leave the schedule fields alone, so the
  -- pin is not counted. On an existing curriculum the deleted lesson would
  -- be gone (record history only backfills brand-new curricula). Recheck
  -- from live data, under the locks, as the curriculum will stand after
  -- this run (targets no longer completed), and refuse any exposed target.
  if v_completion_only then
    select jsonb_agg(jsonb_build_object('lesson', l.id, 'lesson_number', l.lesson_number,
                                        'completed_floor_after', f.floor))
      into v_builder_risk
      from public.lessons l
      cross join lateral (
        select max(x.lesson_number) as floor
          from public.lessons x
         where x.curriculum_goal_id = l.curriculum_goal_id
           and x.completed
           and x.lesson_number is not null
           and not (x.id = any(v_targets))) f
     where l.id = any(v_targets)
       and not l.skipped
       and l.lesson_number is not null
       and l.lesson_number > coalesce(f.floor, 0)
       and coalesce(btrim(l.notes), '') = ''
       and l.minutes_spent is null;
    if v_builder_risk is not null then
      raise exception 'recovery: % lessons would be exposed to Schedule Builder deletion once un-completed: %. Nothing kept.',
        jsonb_array_length(v_builder_risk), v_builder_risk;
    end if;
  end if;

  select jsonb_object_agg(id, current_lesson) into v_ptr_before
    from public.curriculum_goals where id = any(v_goals);
  -- Whole rows, every column, including updated_at: a trigger that touched
  -- any other lesson in these curricula, even without changing a value a
  -- screen reads, fails the run.
  select jsonb_object_agg(l.id, to_jsonb(l)) into v_rest_before
    from public.lessons l where l.curriculum_goal_id = any(v_goals) and not (l.id = any(v_targets));
  -- The approved rows too, minus exactly the columns this run may write.
  select jsonb_object_agg(l.id, to_jsonb(l) - v_writable) into v_tgt_before
    from public.lessons l where l.id = any(v_targets);
  -- Every inventory lesson this run does NOT target (other classes, and any
  -- approved-class lesson left off v_lesson_ids), wherever it lives: whole
  -- rows, unchanged.
  select jsonb_object_agg(l.id, to_jsonb(l)) into v_inv_rest_before
    from public.lessons l
   where l.id in (select lesson_id from rooted_private.recovery_20260925_inventory)
     and not (l.id = any(v_targets));

  update public.lessons l
     set completed = false,
         completed_at = null,
         queue_position = case when v_completion_only then l.queue_position
                          else case i.action
                            when 'UNDO_restore_slot' then i.lesson_number
                            when 'UNDO_restore_only_hole_SIGNOFF' then i.eliminated_slot
                            else null
                          end end,
         queue_pinned = case when v_hide_below_start and i.lesson_number < coalesce(i.start_at_lesson, 1)
                             then false else l.queue_pinned end,
         scheduled_date = case when v_hide_below_start and i.lesson_number < coalesce(i.start_at_lesson, 1)
                               then null else l.scheduled_date end
    from rooted_private.recovery_20260925_inventory i
   where i.lesson_id = l.id
     and i.lesson_id = any(v_targets)
     and i.action = any(v_classes)
     and l.completed
     and l.completed_at = i.run_fp
     and l.updated_at = i.run_t
     and l.queue_position is null;
  get diagnostics v_written = row_count;
  if v_written <> v_expected then
    raise exception 'recovery: wrote % of % approved rows; a row changed since the inventory. Nothing kept.', v_written, v_expected;
  end if;

  select jsonb_object_agg(id, current_lesson) into v_ptr_after
    from public.curriculum_goals where id = any(v_goals);
  if v_ptr_after is distinct from v_ptr_before then
    raise exception 'recovery: a curriculum pointer moved. before % after %. Nothing kept.', v_ptr_before, v_ptr_after;
  end if;

  select jsonb_object_agg(l.id, to_jsonb(l)) into v_rest_after
    from public.lessons l where l.curriculum_goal_id = any(v_goals) and not (l.id = any(v_targets));
  if v_rest_after is distinct from v_rest_before then
    raise exception 'recovery: a lesson outside the approved set changed (whole-row compare). Nothing kept.';
  end if;

  select jsonb_object_agg(l.id, to_jsonb(l) - v_writable) into v_tgt_after
    from public.lessons l where l.id = any(v_targets);
  if v_tgt_after is distinct from v_tgt_before then
    raise exception 'recovery: an approved lesson changed outside the columns this run writes. Nothing kept.';
  end if;

  select jsonb_object_agg(l.id, to_jsonb(l)) into v_inv_rest_after
    from public.lessons l
   where l.id in (select lesson_id from rooted_private.recovery_20260925_inventory)
     and not (l.id = any(v_targets));
  if v_inv_rest_after is distinct from v_inv_rest_before then
    raise exception 'recovery: an inventory lesson outside this run changed. Nothing kept.';
  end if;

  if v_completion_only then
    select count(*) into v_slotted
      from public.lessons l where l.id = any(v_targets) and l.queue_position is not null;
    if v_slotted > 0 then
      raise exception 'recovery: completion-only left % approved lessons with a slot. Nothing kept.', v_slotted;
    end if;
  end if;

  if v_hide_below_start then
    select count(*) into v_leaked
      from public.lessons l join rooted_private.recovery_20260925_inventory i on i.lesson_id = l.id
     where i.lesson_id = any(v_targets)
       and i.lesson_number < coalesce(i.start_at_lesson, 1)
       and (l.queue_pinned or l.scheduled_date is not null);
    if v_leaked > 0 then
      raise exception 'recovery: % lessons below a starting lesson would still show. Nothing kept.', v_leaked;
    end if;
  end if;

  select count(*) into v_dupes from (
    select curriculum_goal_id, queue_position from public.lessons
     where curriculum_goal_id = any(v_goals) and queue_position is not null
     group by 1, 2 having count(*) > 1) d;
  if v_dupes > 0 then
    raise exception 'recovery: % duplicate slots after the revert. Nothing kept.', v_dupes;
  end if;

  raise notice 'recovery: reverted % rows in % curricula; pointers and all other lessons unchanged',
    v_written, array_length(v_goals, 1);
end
$recover$;

-- ── Step 2 (separate, per family, optional): surface hidden lessons ────────
-- Rows with surface_candidate = true are unpinned, undated and behind the
-- pointer once reverted, which is where they were before 2026-09-25: no
-- screen shows them. If Brittany chooses to show them as missed work:
--   update public.lessons set queue_pinned = true, scheduled_date = date
--    where id in (<surface_candidate ids for that family>) and not completed;
-- (CLAUDE.md phantom-repair step 5, Invariant 23.) Never for a row below the
-- family's start_at_lesson: the family chose to start past it.
