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
--   queue_position NULL -> lesson_number (UNDO_restore_slot)
--                       -> the one empty slot (UNDO_restore_only_hole_SIGNOFF)
--                       -> stays NULL (UNDO_archived)
-- Nothing else on the row changes: not the dates, not the pin, not the
-- source. Those were never touched by the 2026-09-25 statement, so they are
-- already what the family had. No other row is written.
--
-- Guards, any failure raises and rolls back everything:
--   * each target row must still be exactly as the statement left it:
--     completed, completed_at = fingerprint, updated_at = statement time,
--     queue_position NULL. A row the family has touched since is skipped by
--     construction and the count check then fails loudly.
--   * the number of rows written must equal the number approved.
--   * every affected curriculum's current_lesson must be unchanged. The
--     pointer is GREATEST(start_at_lesson - 1, MAX(completed slot)); the rows
--     being reverted hold no slot while completed, so it cannot move. If it
--     does, something is wrong and nothing is kept.
--   * every OTHER lesson in those curricula (the family's own work, including
--     everything they did after 2026-09-25) must be byte-identical before and
--     after, compared by an md5 over its state.
--   * no curriculum may end up with two lessons in one slot.
--
-- Un-completing is not blocked by lessons_block_server_side_completion, so no
-- completion attestation is needed or set.
--
-- Usage: first freeze today's inventory (step 0), then edit v_classes, then
-- run the DO block. For a rehearsal, rehearsal.sql substitutes the staging
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
  -- The statement's fingerprint and run time (production values).
  v_fp       timestamptz := '2026-09-24 15:11:35.834303+00';
  v_run      timestamptz := '2026-09-25 15:11:35.834303+00';
  -- APPROVED CLASSES. Starts empty on purpose. Allowed values:
  --   'UNDO_restore_slot', 'UNDO_restore_only_hole_SIGNOFF', 'UNDO_archived'
  v_classes  text[] := array[]::text[];
  v_targets  uuid[];
  v_goals    uuid[];
  v_expected int;
  v_written  int;
  v_ptr_before jsonb;
  v_ptr_after  jsonb;
  v_rest_before jsonb;
  v_rest_after  jsonb;
  v_dupes    int;
begin
  if coalesce(array_length(v_classes, 1), 0) = 0 then
    raise exception 'recovery: no classes approved; edit v_classes first';
  end if;
  if exists (select 1 from unnest(v_classes) c
              where c not in ('UNDO_restore_slot', 'UNDO_restore_only_hole_SIGNOFF', 'UNDO_archived')) then
    raise exception 'recovery: only UNDO_* classes may be run; HOLD and REVIEW rows are never written here';
  end if;

  select array_agg(lesson_id), array_agg(distinct curriculum_goal_id), count(*)
    into v_targets, v_goals, v_expected
    from rooted_private.recovery_20260925_inventory
   where action = any(v_classes);
  if v_expected = 0 then
    raise exception 'recovery: the approved classes select no rows';
  end if;

  -- Lock the curricula first, then their lessons: the order every scheduler
  -- RPC takes, so a family action in flight waits instead of interleaving.
  perform 1 from public.curriculum_goals where id = any(v_goals) order by id for update;
  perform 1 from public.lessons where curriculum_goal_id = any(v_goals) order by id for update;

  select jsonb_object_agg(id, current_lesson) into v_ptr_before
    from public.curriculum_goals where id = any(v_goals);
  select jsonb_object_agg(id, md5(row(completed, completed_at, queue_position, queue_pinned,
                                      scheduled_date, date, scheduled_source, lesson_number,
                                      skipped, hours, minutes_spent, notes)::text))
    into v_rest_before
    from public.lessons where curriculum_goal_id = any(v_goals) and not (id = any(v_targets));

  update public.lessons l
     set completed = false,
         completed_at = null,
         queue_position = case i.action
                            when 'UNDO_restore_slot' then i.lesson_number
                            when 'UNDO_restore_only_hole_SIGNOFF' then i.eliminated_slot
                            else null
                          end
    from rooted_private.recovery_20260925_inventory i
   where i.lesson_id = l.id
     and i.action = any(v_classes)
     and l.completed
     and l.completed_at = v_fp
     and l.updated_at = v_run
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

  select jsonb_object_agg(id, md5(row(completed, completed_at, queue_position, queue_pinned,
                                      scheduled_date, date, scheduled_source, lesson_number,
                                      skipped, hours, minutes_spent, notes)::text))
    into v_rest_after
    from public.lessons where curriculum_goal_id = any(v_goals) and not (id = any(v_targets));
  if v_rest_after is distinct from v_rest_before then
    raise exception 'recovery: a lesson outside the approved set changed. Nothing kept.';
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
