-- Preserve existing unfinished lessons that have no queue slot.
-- Migration first, client second: stale clients refuse instead of deleting these rows.
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

  -- 1. Ownership, then hold the curriculum and its lessons still.
  select * into v_goal from public.curriculum_goals g
   where g.id = p_goal_id and g.user_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('status', 'invalid', 'reason', 'not_owner');
  end if;
  perform 1 from public.lessons l where l.curriculum_goal_id = p_goal_id for update;

  -- Preserve every existing unfinished unslotted row, including automatic
  -- trigger effects. This is not permission to infer or restore a queue slot.
  select coalesce(jsonb_object_agg(l.id::text, to_jsonb(l)), '{}'::jsonb)
    into v_unslotted from public.lessons l
   where l.curriculum_goal_id = p_goal_id and not l.completed and l.queue_position is null;

  -- 2. Is the plan still current?
  if jsonb_build_object(
       'total_lessons', v_goal.total_lessons,
       'current_lesson', v_goal.current_lesson,
       'start_at_lesson', v_goal.start_at_lesson,
       'lessons_per_day', v_goal.lessons_per_day,
       'lessons_per_day_overrides', v_goal.lessons_per_day_overrides,
       'school_days', to_jsonb(v_goal.school_days),
       'start_date', v_goal.start_date::text
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
     and l.queue_position is not null and l.queue_position <= v_goal.current_lesson
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
    -- 4. Write.
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
                              'made_up', coalesce(array_length(v_makeup, 1), 0))
      into v_counts;
  exception when others then
    -- Everything in this block is rolled back to the savepoint the block opened.
    return jsonb_build_object('status', case when sqlerrm like 'rooted_rebuild_overcapacity:%' then 'refused' else 'failed' end,
                              'reason', sqlerrm, 'sqlstate', sqlstate);
  end;

  return jsonb_build_object('status', 'applied') || v_counts;
end;
$fn$;
revoke all on function public.apply_builder_rebuild(uuid, date, jsonb, jsonb) from public, anon;
grant execute on function public.apply_builder_rebuild(uuid, date, jsonb, jsonb) to authenticated;
