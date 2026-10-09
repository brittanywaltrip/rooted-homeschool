-- LOCAL REVIEW DRAFT. Requires cascade_shift_atomic.sql and existing daily reconcile schema.
create or replace function public.apply_daily_reconcile(
  p_goal_id   uuid,
  p_local_day date,
  p_expected  jsonb,
  p_writes    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_goal    public.curriculum_goals%rowtype;
  v_have    jsonb;
  v_w       jsonb;
  v_n       integer := 0;
  v_ok      integer;
  v_start   timestamptz;
  v_end     timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'no_user');
  end if;

  -- 1. The switch, read now.
  if not coalesce((select s.enabled from rooted_private.app_switches s where s.name = 'daily_reconcile'), false) then
    return jsonb_build_object('status', 'disabled');
  end if;

  -- The caller's local day can only be within a day of the server's UTC date.
  if p_local_day is null or abs(p_local_day - (now() at time zone 'UTC')::date) > 1 then
    return jsonb_build_object('status', 'invalid', 'reason', 'local_day');
  end if;
  if jsonb_typeof(p_writes) is distinct from 'array' or jsonb_typeof(p_expected) is distinct from 'object' then
    return jsonb_build_object('status', 'invalid', 'reason', 'shape');
  end if;

  -- 2. Ownership, and serialize every call for this curriculum.
  select * into v_goal from public.curriculum_goals g
   where g.id = p_goal_id and g.user_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('status', 'invalid', 'reason', 'not_owner');
  end if;

  -- 3. Once per curriculum per local day.
  if exists (select 1 from rooted_private.daily_reconcile_log l
              where l.curriculum_goal_id = p_goal_id and l.local_day = p_local_day) then
    return jsonb_build_object('status', 'already');
  end if;

  -- Hold the curriculum's lessons still while comparing and writing. A parent
  -- write in flight commits first, and is then seen by the comparison below.
  perform 1 from public.lessons l where l.curriculum_goal_id = p_goal_id for update;

  -- Match cascade preview/commit's authoritative account-local completion
  -- window. A caller must not extend this window to absorb older completions.
  perform 1 from public.profiles where id=v_uid for share;
  if not found or not rooted_private.cascade_window_valid(v_uid,p_local_day,p_expected->>'day_start',p_expected->>'day_end')
     or p_local_day is distinct from (now() at time zone (rooted_private.cascade_local_window(v_uid,p_local_day)->>'timeZone'))::date then
    return jsonb_build_object('status','invalid','reason','day_window');
  end if;

  -- 4. Is the calculation still current?
  if jsonb_build_object(
       'total_lessons', v_goal.total_lessons,
       'current_lesson', v_goal.current_lesson,
       'lessons_per_day', v_goal.lessons_per_day,
       'lessons_per_day_overrides', v_goal.lessons_per_day_overrides,
       'school_days', to_jsonb(v_goal.school_days),
       'start_date', v_goal.start_date::text
     ) is distinct from p_expected -> 'goal' then
    return jsonb_build_object('status', 'stale', 'reason', 'goal');
  end if;

  select coalesce(jsonb_agg(jsonb_build_array(v.start_date::text, v.end_date::text) order by v.start_date, v.end_date), '[]'::jsonb)
    into v_have
    from public.vacation_blocks v where v.user_id = v_uid;
  if v_have is distinct from coalesce(p_expected -> 'vacations', '[]'::jsonb) then
    return jsonb_build_object('status', 'stale', 'reason', 'breaks');
  end if;

  select coalesce(jsonb_agg(jsonb_build_array(l.queue_position, l.scheduled_date::text) order by l.queue_position), '[]'::jsonb)
    into v_have
    from public.lessons l
   where l.curriculum_goal_id = p_goal_id and not l.completed and l.queue_pinned and not l.skipped
     and l.queue_position is not null and l.scheduled_date is not null;
  if v_have is distinct from coalesce(p_expected -> 'pins', '[]'::jsonb) then
    return jsonb_build_object('status', 'stale', 'reason', 'pins');
  end if;

  select coalesce(jsonb_agg(l.queue_position order by l.queue_position), '[]'::jsonb)
    into v_have
    from public.lessons l
   where l.curriculum_goal_id = p_goal_id and not l.completed and l.skipped and l.queue_position is not null;
  if v_have is distinct from coalesce(p_expected -> 'skipped', '[]'::jsonb) then
    return jsonb_build_object('status', 'stale', 'reason', 'skips');
  end if;

  select coalesce(jsonb_agg(jsonb_build_array(l.queue_position,l.scheduled_date::text) order by l.queue_position),'[]'::jsonb) into v_have from public.lessons l where l.curriculum_goal_id=p_goal_id and not l.completed and not l.skipped and l.queue_preserved and l.queue_position is not null and l.scheduled_date is not null;
  if v_have is distinct from coalesce(p_expected->'preserved','[]'::jsonb) then return jsonb_build_object('status','stale','reason','preserved');end if;
  v_start := (p_expected ->> 'day_start')::timestamptz;
  v_end   := (p_expected ->> 'day_end')::timestamptz;
  if v_start is null or v_end is null or v_end <= v_start then
    return jsonb_build_object('status', 'invalid', 'reason', 'day_window');
  end if;
  select count(*) into v_ok from public.lessons l
   where l.curriculum_goal_id = p_goal_id and l.completed
     and l.completed_at >= v_start and l.completed_at < v_end;
  if v_ok is distinct from (p_expected ->> 'done_today')::integer then
    return jsonb_build_object('status', 'stale', 'reason', 'done_today');
  end if;

  -- 5. Every row to move is still movable and still where the caller saw it.
  select count(*) into v_ok
    from jsonb_array_elements(p_writes) w
    join public.lessons l on l.id = (w ->> 'id')::uuid
   where l.curriculum_goal_id = p_goal_id
     and not l.completed and not l.queue_preserved and not l.queue_pinned and not l.skipped and not coalesce(l.is_backfill, false)
     and l.scheduled_date is not distinct from (w ->> 'from')::date
     and (w ->> 'to')::date >= p_local_day;
  if v_ok <> jsonb_array_length(p_writes) then
    return jsonb_build_object('status', 'stale', 'reason', 'rows');
  end if;

  -- 6. Write, then log the day. One transaction: all of it or none of it.
  for v_w in select * from jsonb_array_elements(p_writes) loop
    update public.lessons
       set scheduled_date = (v_w ->> 'to')::date,
           date = (v_w ->> 'to')::date,
           scheduled_source = 'daily_reconcile'
     where id = (v_w ->> 'id')::uuid;
    v_n := v_n + 1;
  end loop;

  -- New preserved-work clients cannot submit an arbitrary rolling tail.
  set constraints all immediate;
  if exists(select 1 from public.lessons where curriculum_goal_id=p_goal_id and queue_preserved and not completed and not skipped) and not rooted_private.cascade_projection_matches(rooted_private.cascade_snapshot(p_goal_id,p_local_day,p_expected->>'day_start',p_expected->>'day_end')) then
    raise exception 'Preserved-work reconciliation disagrees with projection';
  end if;
  insert into rooted_private.daily_reconcile_log (curriculum_goal_id, local_day, user_id, rows_written)
  values (p_goal_id, p_local_day, v_uid, v_n);

  return jsonb_build_object('status', 'applied', 'written', v_n);
end;
$fn$;
revoke all on function public.apply_daily_reconcile(uuid, date, jsonb, jsonb) from public, anon;
grant execute on function public.apply_daily_reconcile(uuid, date, jsonb, jsonb) to authenticated;
