-- Reopening a lesson with no queue slot restores it exactly.
--
-- A curriculum lesson with no queue slot is completed in place
-- (completeLessonOnDate: only completed and completed_at are written, its
-- date, pin and source are the family's). reopen_lesson un-completed it the
-- way it un-completes a queue lesson: is_backfill off, queue_pinned off,
-- scheduled_source 'manual_uncomplete'. That dropped the family's pin and
-- record of how the lesson got there. For such a row it now clears only the
-- completion. Queue lessons and one-off lessons are unchanged.
--
-- Migration first, client second: an older client gets 'requeued' as before.
-- Rollback: supabase/rollbacks/reopen_lesson_in_place.sql.

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
revoke all on function public.reopen_lesson(uuid, date) from public, anon;
grant execute on function public.reopen_lesson(uuid, date) to authenticated;
