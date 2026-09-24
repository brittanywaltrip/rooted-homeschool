-- Moving one lesson keeps its queue slot; "I'm actually on lesson X" can put
-- the queue back in book order.
--
-- WHY. Plan's "Move just this lesson" promises "Only this lesson moves.
-- Lessons after it stay on their dates." It called move_lesson_to_date, which
-- gives the moved lesson a new queue_position (the end of the target day) and
-- slides every lesson in between down one slot. Plan reads each row's stored
-- date, so it kept its promise. Today projects queue slots from today, so the
-- next lesson in the book took the slot the moved one left and appeared on
-- the day it was moved off: move lesson 4 off today and Today showed lesson 5
-- while Plan said Friday. Reproduced on rooted-staging 2026-09-24.
--
-- The same renumbering broke "Shift all remaining lessons forward" (the
-- re-spread packed the renumbered slots from today, so the later lessons moved
-- EARLIER and the finish date did not move), and it is what left a family's
-- lesson 6 behind the pointer where no screen shows it and "I'm actually on
-- lesson 6" cannot reach it: lesson 5 had been moved past it, completed in
-- slot 6, and current_lesson = MAX(queue_position) over completed rows = 6.
--
-- 1. public.move_lesson_keep_slot(lesson, target, local_day, hold_between)
--    Moves one unfinished curriculum lesson to a LATER day and pins it there
--    (scheduled_source 'plan_move'). Its queue_position is never changed, so
--    lesson numbers and slots stay the same thing. With hold_between it also
--    holds the lessons the pin would otherwise push past it: every unfinished,
--    unskipped, unpinned lesson later in the queue dated from the family's
--    today through the target day is pinned where it is (scheduled_source
--    'plan_hold', dates untouched). The projector then emits each of them on
--    the date Plan shows. Without hold_between (Shift all) the caller
--    re-spreads the rest after the pinned lesson.
--    Returns every row it changed with its prior state, so Undo restores the
--    rows exactly and needs no slot arithmetic.
--
-- 2. public.restore_queue_book_order(goal, local_day)
--    Gives the goal's slotted lessons back their book order: the slots they
--    already hold, reassigned in lesson_number order. Called by "I'm actually
--    on lesson X" only when the order has drifted, because the family has just
--    told us where they are in the BOOK. Never automatic (CLAUDE.md: a drift a
--    family made is never realigned by a repair).
--
-- Both lock the curriculum row first, the order apply_builder_rebuild and
-- reopen_lesson take. Nothing existing is changed; move_lesson_to_date stays
-- for moves to an earlier day, one-off lessons and old app bundles.

create or replace function public.move_lesson_keep_slot(
  p_lesson_id uuid,
  p_target_date date,
  p_local_day date,
  p_hold_between boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_goal_id uuid;
  v_row     public.lessons%rowtype;
  v_current integer;
  v_from    date;
  v_held    jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'no_user');
  end if;
  if p_target_date is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'target');
  end if;
  if p_local_day is null or abs(p_local_day - (now() at time zone 'UTC')::date) > 1 then
    return jsonb_build_object('status', 'invalid', 'reason', 'local_day');
  end if;

  select l.curriculum_goal_id into v_goal_id from public.lessons l
   where l.id = p_lesson_id and l.user_id = v_uid;
  if not found then
    return jsonb_build_object('status', 'invalid', 'reason', 'not_owner');
  end if;
  if v_goal_id is not null then
    perform 1 from public.curriculum_goals g where g.id = v_goal_id and g.user_id = v_uid for update;
  end if;
  select * into v_row from public.lessons l where l.id = p_lesson_id and l.user_id = v_uid for update;

  -- Shapes this function does not own; the caller keeps its old path for them.
  if v_row.completed then
    return jsonb_build_object('status', 'not_movable', 'reason', 'completed');
  end if;
  if coalesce(v_row.skipped, false) then
    return jsonb_build_object('status', 'not_movable', 'reason', 'skipped');
  end if;
  if v_goal_id is null or v_row.queue_position is null then
    return jsonb_build_object('status', 'not_movable', 'reason', 'no_slot');
  end if;
  v_from := coalesce(v_row.scheduled_date, v_row.date);
  if v_from is not null and p_target_date <= v_from then
    return jsonb_build_object('status', 'not_movable', 'reason', 'not_later');
  end if;

  select g.current_lesson into v_current from public.curriculum_goals g where g.id = v_goal_id;

  -- A make-up (slot at or below the pointer, Invariant 23) holds no place in
  -- the queue, so moving it pushes nothing and nothing needs holding.
  if p_hold_between and v_row.queue_position > coalesce(v_current, 0) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', l.id,
             'lesson_number', l.lesson_number,
             'queue_position', l.queue_position,
             'scheduled_date', l.scheduled_date::text,
             'date', l.date::text,
             'queue_pinned', l.queue_pinned,
             'scheduled_source', l.scheduled_source)
           order by l.queue_position), '[]'::jsonb)
      into v_held
      from public.lessons l
     where l.curriculum_goal_id = v_goal_id
       and l.id <> p_lesson_id
       and not l.completed
       and not coalesce(l.skipped, false)
       and not l.queue_pinned
       and l.queue_position is not null
       and l.queue_position > v_row.queue_position
       and l.scheduled_date >= p_local_day
       and l.scheduled_date <= p_target_date;

    update public.lessons
       set queue_pinned = true, scheduled_source = 'plan_hold'
     where id in (select (e->>'id')::uuid from jsonb_array_elements(v_held) e);
  end if;

  update public.lessons
     set scheduled_date = p_target_date, date = p_target_date,
         queue_pinned = true, scheduled_source = 'plan_move'
   where id = p_lesson_id;

  return jsonb_build_object(
    'status', 'moved',
    'moved', jsonb_build_object(
      'id', v_row.id,
      'lesson_number', v_row.lesson_number,
      'queue_position', v_row.queue_position,
      'scheduled_date', v_row.scheduled_date::text,
      'date', v_row.date::text,
      'queue_pinned', v_row.queue_pinned,
      'scheduled_source', v_row.scheduled_source),
    'held', v_held);
end;
$fn$;

revoke all on function public.move_lesson_keep_slot(uuid, date, date, boolean) from public, anon;
grant execute on function public.move_lesson_keep_slot(uuid, date, date, boolean) to authenticated;

create or replace function public.restore_queue_book_order(
  p_goal_id uuid,
  p_local_day date
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_changed integer;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'no_user');
  end if;
  if p_local_day is null or abs(p_local_day - (now() at time zone 'UTC')::date) > 1 then
    return jsonb_build_object('status', 'invalid', 'reason', 'local_day');
  end if;
  perform 1 from public.curriculum_goals g where g.id = p_goal_id and g.user_id = v_uid for update;
  if not found then
    return jsonb_build_object('status', 'invalid', 'reason', 'not_owner');
  end if;

  -- The pointer recompute fires on each completed row's slot change. The
  -- orphan cleanup keys on lesson_number, which this does not change, so it
  -- has nothing to do here; skip it for this transaction rather than let the
  -- intermediate pointer values below trigger it.
  perform set_config('rooted.skip_orphan_cleanup', 'true', true);

  -- The slots the goal already holds, handed back in book order. Same set of
  -- slots, so total_lessons, holes and the unique index are all unaffected
  -- (lessons_goal_lesson_number_unique means one row per number). Two passes
  -- through negative values keep lessons_goal_queue_position_uniq satisfied
  -- at every step, the move_lesson_to_date technique.
  update public.lessons l set queue_position = -m.new_qp
    from (select r.id, s.qp as new_qp
            from (select x.id, row_number() over (order by x.lesson_number) rn
                    from public.lessons x
                   where x.curriculum_goal_id = p_goal_id and x.queue_position is not null and x.lesson_number is not null) r
            join (select x.queue_position qp, row_number() over (order by x.queue_position) rn
                    from public.lessons x
                   where x.curriculum_goal_id = p_goal_id and x.queue_position is not null and x.lesson_number is not null) s
              on s.rn = r.rn) m
   where l.id = m.id and l.queue_position is distinct from m.new_qp;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return jsonb_build_object('status', 'in_order', 'changed', 0);
  end if;
  update public.lessons l set queue_position = -l.queue_position
   where l.curriculum_goal_id = p_goal_id and l.queue_position < 0;

  return jsonb_build_object('status', 'restored', 'changed', v_changed);
end;
$fn$;

revoke all on function public.restore_queue_book_order(uuid, date) from public, anon;
grant execute on function public.restore_queue_book_order(uuid, date) to authenticated;
