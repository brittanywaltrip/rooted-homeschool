-- LOCAL REVIEW PROPOSAL ONLY: do not install without the separate fixture/release authorization.
-- Derived verbatim from remaining-candidate-install.sql SHA256
-- 10f0f2c6d05876e00514bc88170ae7c50df00128794af99cb65ede2feebc6c61,
-- except the five lock-acquisition blocks below. The four-argument Builder
-- delegates unchanged. Existing signatures, owners, ACLs and business logic remain.
-- All goal lessons are locked, including completed/unslotted rows: completion
-- and orphan-cleanup triggers can touch rows outside a requested move range.
-- This addresses the six reproduced row-lock cycles, not arbitrary concurrent
-- inserts, receipt unique-index waits, or locks a caller acquired before the RPC.
-- Runtime validation (including refusing transaction left open) is still required.
BEGIN;
CREATE OR REPLACE FUNCTION public.reopen_lesson(p_lesson_id uuid, p_local_day date)
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
  -- Completion locks a lesson before its goal; never wait while holding either.
  -- The exception savepoint releases every acquired row lock on contention.
  begin
    if v_goal_id is not null then
      perform 1 from public.curriculum_goals g where g.id = v_goal_id and g.user_id = v_uid for update nowait;
      if not found then
        raise lock_not_available using message = 'rooted_schedule_busy';
      end if;
    end if;
    perform 1 from public.lessons l
     where l.curriculum_goal_id = v_goal_id or l.id = p_lesson_id
     order by l.id for update nowait;
    select * into v_row from public.lessons l where l.id = p_lesson_id and l.user_id = v_uid;
    if not found or v_row.curriculum_goal_id is distinct from v_goal_id then
      raise lock_not_available using message = 'rooted_schedule_busy';
    end if;
  exception when lock_not_available then
    return jsonb_build_object('status', 'stale', 'reason', 'busy');
  end;
  if not v_row.completed then
    return jsonb_build_object('status', 'not_completed');
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
$function$;
ALTER FUNCTION public.reopen_lesson(uuid,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reopen_lesson(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reopen_lesson(uuid,date) TO authenticated,service_role;
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
  begin
    perform 1 from public.curriculum_goals g where g.id = p_goal_id and g.user_id = v_uid for update nowait;
    if not found then
      return jsonb_build_object('status', 'invalid', 'reason', 'not_owner');
    end if;
    perform 1 from public.lessons l where l.curriculum_goal_id = p_goal_id order by l.id for update nowait;
  exception when lock_not_available then
    return jsonb_build_object('status', 'stale', 'reason', 'busy');
  end;

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
ALTER FUNCTION public.restore_queue_book_order(uuid,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.restore_queue_book_order(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.restore_queue_book_order(uuid,date) TO authenticated,service_role;
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
  -- Completion locks a lesson before its goal; never wait while holding either.
  -- The exception savepoint releases every acquired row lock on contention.
  begin
    if v_goal_id is not null then
      perform 1 from public.curriculum_goals g where g.id = v_goal_id and g.user_id = v_uid for update nowait;
      if not found then
        raise lock_not_available using message = 'rooted_schedule_busy';
      end if;
    end if;
    perform 1 from public.lessons l
     where l.curriculum_goal_id = v_goal_id or l.id = p_lesson_id
     order by l.id for update nowait;
    select * into v_row from public.lessons l where l.id = p_lesson_id and l.user_id = v_uid;
    if not found or v_row.curriculum_goal_id is distinct from v_goal_id then
      raise lock_not_available using message = 'rooted_schedule_busy';
    end if;
  exception when lock_not_available then
    return jsonb_build_object('status', 'stale', 'reason', 'busy');
  end;

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
ALTER FUNCTION public.move_lesson_keep_slot(uuid,date,date,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.move_lesson_keep_slot(uuid,date,date,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.move_lesson_keep_slot(uuid,date,date,boolean) TO authenticated,service_role;
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

  -- Keep the historical void signature: contention is an explicit 55P03 error,
  -- never a successful no-op. Acquire the complete trigger/neighbor write set.
  BEGIN
    IF v_goal_id IS NOT NULL THEN
      PERFORM 1 FROM public.curriculum_goals g
       WHERE g.id = v_goal_id AND g.user_id = auth.uid() FOR UPDATE NOWAIT;
      IF NOT FOUND THEN
        RAISE lock_not_available USING MESSAGE = 'rooted_schedule_busy';
      END IF;
    END IF;
    PERFORM 1 FROM public.lessons l
     WHERE l.curriculum_goal_id = v_goal_id OR l.id = p_lesson_id
     ORDER BY l.id FOR UPDATE NOWAIT;
    SELECT l.queue_position, l.scheduled_date INTO v_old_qp, v_old_date
      FROM public.lessons l WHERE l.id = p_lesson_id AND l.user_id = auth.uid()
       AND l.curriculum_goal_id IS NOT DISTINCT FROM v_goal_id;
    IF NOT FOUND THEN
      RAISE lock_not_available USING MESSAGE = 'rooted_schedule_busy';
    END IF;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'rooted_schedule_busy' USING ERRCODE = '55P03';
  END;

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
ALTER FUNCTION public.move_lesson_to_date(uuid,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.move_lesson_to_date(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.move_lesson_to_date(uuid,date) TO authenticated,service_role;
create or replace function public.apply_builder_rebuild(
  p_goal_id   uuid,
  p_local_day date,
  p_expected  jsonb,
  p_plan      jsonb,
  p_settings  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_goal      public.curriculum_goals%rowtype;
  v_have      jsonb;
  v_unslotted jsonb;
  v_ok        integer;
  v_unpin     uuid[];
  v_delete    uuid[];
  v_placed    uuid[];
  v_makeup    uuid[];
  v_keep_work uuid[];
  v_inserted  uuid[] := '{}';
  v_new_id    uuid;
  v_r         jsonb;
  v_retire    integer;
  v_start     timestamptz;
  v_end       timestamptz;
  v_bad       text;
  v_counts    jsonb;
  v_settings  jsonb;
  v_request   uuid;
  v_prior     rooted_private.builder_commit_log%rowtype;
  v_max_done  integer;
  v_pointer   integer;
  v_after     jsonb;
  v_key       text;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'no_user');
  end if;
  if p_local_day is null or abs(p_local_day - (now() at time zone 'UTC')::date) > 1 then
    return jsonb_build_object('status', 'invalid', 'reason', 'local_day');
  end if;
  if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_plan) is distinct from 'object'
     or jsonb_typeof(p_expected -> 'rows') is distinct from 'array'
     or jsonb_typeof(p_plan -> 'inserts') is distinct from 'array'
     or jsonb_typeof(p_plan -> 'redates') is distinct from 'array' then
    return jsonb_build_object('status', 'invalid', 'reason', 'shape');
  end if;

  -- 1. Ownership, then hold the curriculum and its lessons without waiting.
  begin
    select * into v_goal from public.curriculum_goals g
     where g.id = p_goal_id and g.user_id = v_uid for update nowait;
    if not found then
      return jsonb_build_object('status', 'invalid', 'reason', 'not_owner');
    end if;
    perform 1 from public.lessons l where l.curriculum_goal_id = p_goal_id order by l.id for update nowait;
  exception when lock_not_available then
    return jsonb_build_object('status', 'stale', 'reason', 'busy');
  end;

  -- Preserve every existing unfinished unslotted row, including automatic
  -- trigger effects. This is not permission to infer or restore a queue slot.
  select coalesce(jsonb_object_agg(l.id::text, to_jsonb(l)), '{}'::jsonb)
    into v_unslotted from public.lessons l
   where l.curriculum_goal_id = p_goal_id and not l.completed and l.queue_position is null;

  -- A re-sent call whose first attempt committed gets that outcome back.
  if jsonb_typeof(p_plan -> 'request_id') = 'string' then
    begin
      v_request := (p_plan ->> 'request_id')::uuid;
    exception when others then
      return jsonb_build_object('status', 'invalid', 'reason', 'request_id');
    end;
    select * into v_prior from rooted_private.builder_commit_log where request_id = v_request;
    if found then
      if v_prior.user_id <> v_uid or v_prior.goal_id <> p_goal_id then
        return jsonb_build_object('status', 'invalid', 'reason', 'request_id');
      end if;
      return v_prior.result || jsonb_build_object('replayed', true);
    end if;
  elsif p_plan ? 'request_id' and jsonb_typeof(p_plan -> 'request_id') <> 'null' then
    return jsonb_build_object('status', 'invalid', 'reason', 'request_id');
  end if;

  -- New calls must carry the complete plan dependencies. A committed replay
  -- above remains a replay even after archival or a client rollout.
  if p_expected -> 'builder_guard_version' is distinct from '1'::jsonb
     or jsonb_typeof(p_expected -> 'goal') is distinct from 'object'
     or not ((p_expected -> 'goal') ?& array['archived', 'completed_at', 'child_id',
       'curriculum_name', 'subject_label', 'default_minutes', 'scheduled_start_time']) then
    return jsonb_build_object('status', 'invalid', 'reason', 'client_upgrade_required');
  end if;
  -- These checks use the goal obtained FOR UPDATE, never a later unlocked read.
  if coalesce(v_goal.archived, false) or v_goal.completed_at is not null then
    return jsonb_build_object('status', 'stale', 'reason', 'goal_lifecycle');
  end if;

  -- The scheduling settings this save changes, written below with the lessons.
  v_settings := p_settings;
  if v_settings is not null and jsonb_typeof(v_settings) = 'null' then v_settings := null; end if;
  if v_settings is not null then
    if jsonb_typeof(v_settings) <> 'object' then
      return jsonb_build_object('status', 'invalid', 'reason', 'goal_settings');
    end if;
    for v_key in select jsonb_object_keys(v_settings) loop
      if v_key not in ('total_lessons', 'lessons_per_day', 'lessons_per_day_overrides', 'school_days', 'start_date', 'start_at_lesson') then
        return jsonb_build_object('status', 'invalid', 'reason', 'goal_settings');
      end if;
    end loop;
    if (v_settings ? 'total_lessons' and (jsonb_typeof(v_settings -> 'total_lessons') <> 'number' or (v_settings ->> 'total_lessons')::numeric not between 1 and 100000 or (v_settings ->> 'total_lessons')::numeric % 1 <> 0))
       or (v_settings ? 'lessons_per_day' and (jsonb_typeof(v_settings -> 'lessons_per_day') <> 'number' or (v_settings ->> 'lessons_per_day')::numeric not between 1 and 50 or (v_settings ->> 'lessons_per_day')::numeric % 1 <> 0))
       or (v_settings ? 'start_at_lesson' and (jsonb_typeof(v_settings -> 'start_at_lesson') <> 'number' or (v_settings ->> 'start_at_lesson')::numeric not between 1 and 100001 or (v_settings ->> 'start_at_lesson')::numeric % 1 <> 0))
       or (v_settings ? 'lessons_per_day_overrides' and jsonb_typeof(v_settings -> 'lessons_per_day_overrides') not in ('object', 'null'))
       or (v_settings ? 'lessons_per_day_overrides' and jsonb_typeof(v_settings -> 'lessons_per_day_overrides') = 'object' and exists (
             select 1 from jsonb_each(v_settings -> 'lessons_per_day_overrides') o
              where o.key not in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun') or jsonb_typeof(o.value) <> 'number'
                 or o.value::text::numeric not between 0 and 50 or o.value::text::numeric % 1 <> 0))
       or (v_settings ? 'school_days' and (jsonb_typeof(v_settings -> 'school_days') <> 'array'
             or jsonb_array_length(v_settings -> 'school_days') = 0
             or exists (select 1 from jsonb_array_elements(v_settings -> 'school_days') d
                         where jsonb_typeof(d) <> 'string' or d #>> '{}' not in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun'))))
       or (v_settings ? 'start_date' and jsonb_typeof(v_settings -> 'start_date') not in ('string', 'null'))
       or (v_settings ? 'start_date' and jsonb_typeof(v_settings -> 'start_date') = 'string' and (v_settings ->> 'start_date') !~ '^\d{4}-\d{2}-\d{2}$') then
      return jsonb_build_object('status', 'invalid', 'reason', 'goal_settings');
    end if;
  end if;

  -- 2. Is the plan still current?
  if jsonb_build_object(
       'total_lessons', v_goal.total_lessons,
       'current_lesson', v_goal.current_lesson,
       'start_at_lesson', v_goal.start_at_lesson,
       'lessons_per_day', v_goal.lessons_per_day,
       'lessons_per_day_overrides', v_goal.lessons_per_day_overrides,
       'school_days', to_jsonb(v_goal.school_days),
       'start_date', v_goal.start_date::text,
       'archived', v_goal.archived,
       'completed_at', v_goal.completed_at,
       'child_id', v_goal.child_id,
       'curriculum_name', v_goal.curriculum_name,
       'subject_label', v_goal.subject_label,
       'default_minutes', v_goal.default_minutes,
       'scheduled_start_time', v_goal.scheduled_start_time::text
     ) is distinct from p_expected -> 'goal' then
    return jsonb_build_object('status', 'stale', 'reason', 'goal');
  end if;

  select coalesce(jsonb_agg(jsonb_build_array(
           l.id::text, l.lesson_number, l.queue_position, l.completed,
           coalesce(l.queue_pinned, false), coalesce(l.skipped, false), l.scheduled_date::text)
         order by l.id), '[]'::jsonb)
    into v_have
    from public.lessons l where l.curriculum_goal_id = p_goal_id;
  if v_have is distinct from p_expected -> 'rows' then
    return jsonb_build_object('status', 'stale', 'reason', 'rows');
  end if;

  v_start := (p_expected ->> 'day_start')::timestamptz;
  v_end   := (p_expected ->> 'day_end')::timestamptz;
  if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '26 hours' then
    return jsonb_build_object('status', 'invalid', 'reason', 'day_window');
  end if;

  -- The pointer these settings imply, by the same rule as
  -- recompute_curriculum_current_lesson. The caller planned against it.
  v_pointer := v_goal.current_lesson;
  if v_settings is not null then
    select coalesce(max(l.queue_position), 0) into v_max_done from public.lessons l
     where l.curriculum_goal_id = p_goal_id and l.completed and l.queue_position is not null;
    v_pointer := greatest(coalesce(case when v_settings ? 'start_at_lesson' then (v_settings ->> 'start_at_lesson')::integer else v_goal.start_at_lesson end, 1) - 1, v_max_done);
    v_pointer := least(v_pointer, coalesce(case when v_settings ? 'total_lessons' then (v_settings ->> 'total_lessons')::integer else v_goal.total_lessons end, v_pointer));
    if (p_expected ->> 'current_lesson_after') is distinct from v_pointer::text
       or jsonb_typeof(p_expected -> 'rows_after_settings') is distinct from 'array' then
      return jsonb_build_object('status', 'stale', 'reason', 'pointer');
    end if;
  end if;

  select coalesce(array_agg(x::uuid), '{}') into v_unpin    from jsonb_array_elements_text(coalesce(p_plan -> 'unpin_ids', '[]')) x;
  select coalesce(array_agg(x::uuid), '{}') into v_delete   from jsonb_array_elements_text(coalesce(p_plan -> 'delete_ids', '[]')) x;
  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_placed from jsonb_array_elements(p_plan -> 'redates') x;
  select coalesce(array_agg(x::uuid), '{}') into v_makeup   from jsonb_array_elements_text(coalesce(p_plan -> 'makeup_ids', '[]')) x;
  select coalesce(array_agg(x::uuid), '{}') into v_keep_work from jsonb_array_elements_text(coalesce(p_plan -> 'retire_keep_ids', '[]')) x;
  v_retire := (p_plan ->> 'retire_above')::integer;

  -- 3. Every destructive step is allowed on the rows as they are now.
  select count(*) into v_ok from public.lessons l
   where l.id = any(v_unpin) and l.curriculum_goal_id = p_goal_id and not l.completed and l.queue_pinned and l.queue_position is not null;
  if v_ok <> coalesce(array_length(v_unpin, 1), 0) then
    return jsonb_build_object('status', 'stale', 'reason', 'unpin_rows');
  end if;
  select count(*) into v_ok from public.lessons l
   where l.id = any(v_delete) and l.curriculum_goal_id = p_goal_id
     and not l.completed and not coalesce(l.skipped, false)
     and l.queue_position is not null
     and not rooted_private.lesson_carries_work(l.notes, l.minutes_spent)
     and (not l.queue_pinned or l.id = any(v_unpin));
  if v_ok <> coalesce(array_length(v_delete, 1), 0) then
    return jsonb_build_object('status', 'stale', 'reason', 'delete_rows');
  end if;
  -- Retirement past a shortened total affects only slotted unfinished rows above it
  -- EXCEPT the ones the plan names as carrying the parent's work. That list
  -- was made from rows read before the lock; if any row it would delete now
  -- carries notes or minutes (written in another tab since), the plan is stale.
  if v_retire is not null and exists (
       select 1 from public.lessons l
        where l.curriculum_goal_id = p_goal_id and not l.completed
          and l.lesson_number > v_retire and l.queue_position is not null and not (l.id = any(v_keep_work))
          and rooted_private.lesson_carries_work(l.notes, l.minutes_spent)) then
    return jsonb_build_object('status', 'stale', 'reason', 'retire_rows');
  end if;
  select count(*) into v_ok
    from jsonb_array_elements(p_plan -> 'redates') w
    join public.lessons l on l.id = (w ->> 'id')::uuid
   where l.curriculum_goal_id = p_goal_id
     and not l.completed and not coalesce(l.skipped, false)
     and l.queue_position is not null
     and (not l.queue_pinned or l.id = any(v_unpin))
     and not (l.id = any(v_delete))
     and (w ->> 'to')::date >= p_local_day;
  if v_ok <> jsonb_array_length(p_plan -> 'redates') then
    return jsonb_build_object('status', 'stale', 'reason', 'redate_rows');
  end if;
  select count(*) into v_ok from public.lessons l
   where l.id = any(v_makeup) and l.curriculum_goal_id = p_goal_id
     and not l.completed and not l.queue_pinned and not coalesce(l.skipped, false)
     and l.queue_position is not null and l.queue_position <= v_pointer
     and l.scheduled_date >= p_local_day;
  if v_ok <> coalesce(array_length(v_makeup, 1), 0) then
    return jsonb_build_object('status', 'stale', 'reason', 'makeup_rows');
  end if;
  select count(*) into v_ok from jsonb_array_elements(p_plan -> 'inserts') r
   where (r ->> 'lesson_number') is not null
     and coalesce(r ->> 'scheduled_source', '') = 'wizard_create'
     and (not coalesce((r ->> 'completed')::boolean, false) or coalesce((r ->> 'is_backfill')::boolean, false))
     and (coalesce((r ->> 'completed')::boolean, false) or (r ->> 'scheduled_date')::date >= p_local_day);
  if v_ok <> jsonb_array_length(p_plan -> 'inserts') then
    return jsonb_build_object('status', 'invalid', 'reason', 'insert_rows');
  end if;

  begin
    -- 4. Write. Settings first, so everything below sees the new schedule and
    -- any refusal below rolls them back with the lessons.
    if v_settings is not null then
      update public.curriculum_goals g set
        total_lessons = case when v_settings ? 'total_lessons' then (v_settings ->> 'total_lessons')::integer else g.total_lessons end,
        lessons_per_day = case when v_settings ? 'lessons_per_day' then (v_settings ->> 'lessons_per_day')::integer else g.lessons_per_day end,
        lessons_per_day_overrides = case when v_settings ? 'lessons_per_day_overrides'
          then case when jsonb_typeof(v_settings -> 'lessons_per_day_overrides') = 'null' then null else v_settings -> 'lessons_per_day_overrides' end
          else g.lessons_per_day_overrides end,
        school_days = case when v_settings ? 'school_days' then array(select jsonb_array_elements_text(v_settings -> 'school_days')) else g.school_days end,
        start_date = case when v_settings ? 'start_date' then (v_settings ->> 'start_date')::date else g.start_date end,
        start_at_lesson = case when v_settings ? 'start_at_lesson' then (v_settings ->> 'start_at_lesson')::integer else g.start_at_lesson end,
        current_lesson = v_pointer
       where g.id = p_goal_id;
      -- A raised pointer runs the orphan cleanup trigger. The caller planned
      -- against exactly the rows that leaves; anything else is a stale plan.
      select coalesce(jsonb_agg(jsonb_build_array(
               l.id::text, l.lesson_number, l.queue_position, l.completed,
               coalesce(l.queue_pinned, false), coalesce(l.skipped, false), l.scheduled_date::text)
             order by l.id), '[]'::jsonb)
        into v_after
        from public.lessons l where l.curriculum_goal_id = p_goal_id;
      if v_after is distinct from p_expected -> 'rows_after_settings' then
        raise exception 'rooted_rebuild_stale_settings' using errcode = 'P0001';
      end if;
      select * into v_goal from public.curriculum_goals g where g.id = p_goal_id;
      -- v_unslotted is NOT re-read here. It was taken before the settings
      -- write, so an unslotted row changed by that write (or by any trigger it
      -- fires) fails the check below and rolls the whole save back.
    end if;

    update public.lessons set queue_pinned = false where id = any(v_unpin);

    delete from public.lessons where id = any(v_delete);

    for v_r in select * from jsonb_array_elements(p_plan -> 'inserts') loop
      insert into public.lessons (
        user_id, child_id, curriculum_goal_id, lesson_number, queue_position, title,
        scheduled_date, date, scheduled_source, completed, completed_at, is_backfill,
        minutes_spent, hours
      ) values (
        v_uid, (v_r ->> 'child_id')::uuid, p_goal_id, (v_r ->> 'lesson_number')::integer,
        (v_r ->> 'queue_position')::integer, v_r ->> 'title',
        (v_r ->> 'scheduled_date')::date, (v_r ->> 'scheduled_date')::date, 'wizard_create',
        coalesce((v_r ->> 'completed')::boolean, false), (v_r ->> 'completed_at')::timestamptz,
        coalesce((v_r ->> 'is_backfill')::boolean, false),
        (v_r ->> 'minutes_spent')::integer, coalesce((v_r ->> 'hours')::numeric, 0)
      ) returning id into v_new_id;
      v_inserted := v_inserted || v_new_id;
    end loop;

    if v_retire is not null then
      update public.lessons
         set scheduled_date = null, queue_position = null, queue_pinned = false
       where curriculum_goal_id = p_goal_id and id = any(v_keep_work)
         and not completed and lesson_number > v_retire and queue_position is not null;
      delete from public.lessons
       where curriculum_goal_id = p_goal_id and not completed
         and lesson_number > v_retire and queue_position is not null and not (id = any(v_keep_work))
         and not rooted_private.lesson_carries_work(notes, minutes_spent);
    end if;

    for v_r in select * from jsonb_array_elements(p_plan -> 'redates') loop
      update public.lessons
         set scheduled_date = (v_r ->> 'to')::date, date = (v_r ->> 'to')::date,
             scheduled_source = 'wizard_create'
       where id = (v_r ->> 'id')::uuid
         and (scheduled_date is distinct from (v_r ->> 'to')::date or date is distinct from (v_r ->> 'to')::date);
    end loop;

    update public.lessons set queue_pinned = true, scheduled_source = 'reopened' where id = any(v_makeup);

    if exists (
      select 1 from jsonb_each(v_unslotted) b
      left join public.lessons l on l.id = b.key::uuid
      where to_jsonb(l) is distinct from b.value
    ) then
      raise exception 'rooted_rebuild_unslotted_changed' using errcode = 'P0001';
    end if;

    -- 5. Capacity, on the result.
    with days as (
      select l.scheduled_date d,
             count(*) filter (where (l.id = any(v_inserted) or l.id = any(v_placed)) and not l.queue_pinned) placed,
             count(*) filter (where not (l.id = any(v_inserted) or l.id = any(v_placed)) or l.queue_pinned) other
        from public.lessons l
       where l.curriculum_goal_id = p_goal_id and not l.completed and not coalesce(l.skipped, false)
         and l.scheduled_date >= p_local_day
       group by l.scheduled_date
    ), allowed as (
      select d.d, d.placed, d.other,
             case when jsonb_typeof(v_goal.lessons_per_day_overrides -> (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[extract(isodow from d.d)::int]) = 'number'
                  then (v_goal.lessons_per_day_overrides ->> (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[extract(isodow from d.d)::int])::numeric
                  else v_goal.lessons_per_day end as cap,
             case when d.d = p_local_day then
               (select count(*) from public.lessons c
                 where c.curriculum_goal_id = p_goal_id and c.completed
                   and c.completed_at >= v_start and c.completed_at < v_end)
             else 0 end as done
        from days d
    )
    select string_agg(format('%s (%s placed, %s room)', a.d, a.placed, greatest(0, a.cap - a.done - a.other)), ', ' order by a.d)
      into v_bad
      from allowed a
     where a.placed > greatest(0, a.cap - a.done - a.other);
    if v_bad is not null then
      raise exception 'rooted_rebuild_overcapacity: %', v_bad using errcode = 'P0001';
    end if;

    select jsonb_build_object('inserted', coalesce(array_length(v_inserted, 1), 0),
                              'deleted', coalesce(array_length(v_delete, 1), 0),
                              'redated', jsonb_array_length(p_plan -> 'redates'),
                              'unpinned', coalesce(array_length(v_unpin, 1), 0),
                              'made_up', coalesce(array_length(v_makeup, 1), 0),
                              'settings_applied', v_settings is not null)
      into v_counts;
    if v_request is not null then
      insert into rooted_private.builder_commit_log (request_id, user_id, goal_id, result)
      values (v_request, v_uid, p_goal_id, jsonb_build_object('status', 'applied') || v_counts);
      delete from rooted_private.builder_commit_log
       where user_id = v_uid and created_at < now() - interval '3 days';
    end if;
  exception when others then
    -- Everything in this block is rolled back to the savepoint the block opened.
    return jsonb_build_object('status', case when sqlerrm like 'rooted_rebuild_overcapacity:%' then 'refused'
                                             when sqlerrm = 'rooted_rebuild_stale_settings' then 'stale'
                                             else 'failed' end,
                              'reason', sqlerrm, 'sqlstate', sqlstate);
  end;

  return jsonb_build_object('status', 'applied') || v_counts;
end;
$fn$;
ALTER FUNCTION public.apply_builder_rebuild(uuid,date,jsonb,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_builder_rebuild(uuid,date,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_builder_rebuild(uuid,date,jsonb,jsonb,jsonb) TO authenticated,service_role;
create or replace function public.apply_builder_rebuild(
  p_goal_id   uuid,
  p_local_day date,
  p_expected  jsonb,
  p_plan      jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  return public.apply_builder_rebuild(p_goal_id, p_local_day, p_expected, p_plan, null::jsonb);
end;
$fn$;
ALTER FUNCTION public.apply_builder_rebuild(uuid,date,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_builder_rebuild(uuid,date,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_builder_rebuild(uuid,date,jsonb,jsonb) TO authenticated,service_role;

COMMIT;
