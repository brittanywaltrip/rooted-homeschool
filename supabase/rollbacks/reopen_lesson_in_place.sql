-- Roll back 20261006000000: restore reopen_lesson as it is on production
-- (body md5 9611a68a4e546de9501312f90e87c482; rooted-staging held the same
-- logic with blank lines, md5 e05d09fd5bcd02db83090df996e98429). Roll the
-- client back first.
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
revoke all on function public.reopen_lesson(uuid, date) from public, anon;
grant execute on function public.reopen_lesson(uuid, date) to authenticated;
