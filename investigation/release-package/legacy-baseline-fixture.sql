-- Synthetic-cluster-only reference definitions; no rows or credentials.
CREATE OR REPLACE FUNCTION rooted_private.lesson_carries_work(p_notes text, p_minutes integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select p_minutes is not null
      or coalesce(p_notes, '') ~ ('[^[:space:]' || chr(160) || chr(5760) || chr(8192) || '-' || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279) || ']')
$function$;
create or replace function public.reopen_lesson(
  p_lesson_id uuid,
  p_local_day date
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
  v_date    date;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'no_user');
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
  if not v_row.completed then
    return jsonb_build_object('status', 'not_completed');
  end if;

  -- A curriculum lesson with no queue slot was completed in place
  -- (completesInPlace in app/lib/completeLessonOnDate.ts). Reopening restores
  -- exactly that row: only the completion comes off. Its dates, pin, source
  -- and backfill flag stay, and it is never given a queue slot. The status
  -- stays 'requeued' so clients from before this change read it as success.
  if v_goal_id is not null and v_row.queue_position is null then
    begin
      update public.lessons set completed = false, completed_at = null where id = p_lesson_id;
      select g.current_lesson into v_current from public.curriculum_goals g where g.id = v_goal_id;
      return jsonb_build_object('status', 'requeued', 'in_place', true, 'current_lesson', v_current);
    exception when others then
      return jsonb_build_object('status', 'failed', 'reason', sqlerrm, 'sqlstate', sqlstate);
    end;
  end if;

  begin
    update public.lessons
       set completed = false, completed_at = null, is_backfill = false,
           queue_pinned = false, scheduled_source = 'manual_uncomplete'
     where id = p_lesson_id;

    if v_goal_id is null then
      return jsonb_build_object('status', 'requeued');
    end if;

    select g.current_lesson into v_current from public.curriculum_goals g where g.id = v_goal_id;

    if v_row.queue_position is not null and not coalesce(v_row.skipped, false)
       and v_row.queue_position <= coalesce(v_current, 0) then
      v_date := greatest(coalesce(v_row.scheduled_date, p_local_day), p_local_day);
      update public.lessons
         set queue_pinned = true, scheduled_source = 'reopened',
             scheduled_date = v_date, date = v_date
       where id = p_lesson_id;
      return jsonb_build_object('status', 'made_up', 'date', v_date::text, 'current_lesson', v_current);
    end if;
    return jsonb_build_object('status', 'requeued', 'current_lesson', v_current);
  exception when others then
    return jsonb_build_object('status', 'failed', 'reason', sqlerrm, 'sqlstate', sqlstate);
  end;
end;
$fn$;
CREATE OR REPLACE FUNCTION public.restore_queue_book_order(p_goal_id uuid, p_local_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.move_lesson_keep_slot(p_lesson_id uuid, p_target_date date, p_local_day date, p_hold_between boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.move_lesson_to_date(p_lesson_id uuid, p_target_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_goal_id uuid;
  v_old_qp integer;
  v_old_date date;
  v_max_qp_on_d integer;
  v_max_qp_before_d integer;
  v_new_qp integer;
  v_owner_id uuid;
BEGIN
  SELECT user_id INTO v_owner_id
    FROM lessons
    WHERE id = p_lesson_id;

  IF v_owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'permission denied: lesson does not belong to current user';
  END IF;

  SELECT curriculum_goal_id, queue_position, scheduled_date
    INTO v_goal_id, v_old_qp, v_old_date
    FROM lessons
    WHERE id = p_lesson_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lesson % not found', p_lesson_id;
  END IF;

  IF v_goal_id IS NULL OR v_old_qp IS NULL THEN
    UPDATE lessons
      SET scheduled_date = p_target_date,
          date           = p_target_date,
          scheduled_source = 'plan_move',
          queue_pinned   = true
      WHERE id = p_lesson_id;
    RETURN;
  END IF;

  SELECT MAX(queue_position)
    INTO v_max_qp_on_d
    FROM lessons
    WHERE curriculum_goal_id = v_goal_id
      AND scheduled_date = p_target_date
      AND id <> p_lesson_id
      AND queue_position IS NOT NULL;

  IF v_max_qp_on_d IS NULL THEN
    SELECT MAX(queue_position)
      INTO v_max_qp_before_d
      FROM lessons
      WHERE curriculum_goal_id = v_goal_id
        AND scheduled_date < p_target_date
        AND id <> p_lesson_id
        AND queue_position IS NOT NULL;
    v_max_qp_on_d := COALESCE(v_max_qp_before_d, 0);
  END IF;

  IF v_old_qp > v_max_qp_on_d THEN
    v_new_qp := v_max_qp_on_d + 1;
  ELSE
    v_new_qp := v_max_qp_on_d;
  END IF;

  IF v_new_qp = v_old_qp AND v_old_date IS NOT DISTINCT FROM p_target_date THEN
    UPDATE lessons
      SET scheduled_source = 'plan_move',
          queue_pinned = true
      WHERE id = p_lesson_id;
    RETURN;
  END IF;

  UPDATE lessons SET queue_position = NULL WHERE id = p_lesson_id;

  IF v_old_qp < v_new_qp THEN
    UPDATE lessons
      SET queue_position = -(queue_position - 1)
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position > v_old_qp
        AND queue_position <= v_new_qp;
    UPDATE lessons
      SET queue_position = -queue_position
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position < 0;
  ELSIF v_old_qp > v_new_qp THEN
    UPDATE lessons
      SET queue_position = -(queue_position + 1)
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position >= v_new_qp
        AND queue_position < v_old_qp;
    UPDATE lessons
      SET queue_position = -queue_position
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position < 0;
  END IF;

  UPDATE lessons
    SET queue_position = v_new_qp,
        scheduled_date = p_target_date,
        date           = p_target_date,
        scheduled_source = 'plan_move',
        queue_pinned   = true
    WHERE id = p_lesson_id;
END;
$function$;