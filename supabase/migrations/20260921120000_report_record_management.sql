-- Parent-facing corrections for completed report records.
--
-- A curriculum lesson is not an isolated log row: lesson_number,
-- queue_position, the visible "Lesson N" title, and current_lesson form one
-- sequence. Deleting a mistaken completion without closing that sequence
-- leaves a permanent blank slot in Today. These RPCs keep that invariant while
-- still allowing a parent to correct her own legal/portfolio record.

create or replace function public.update_report_lesson_record(
  p_lesson_id uuid,
  p_date date,
  p_minutes_spent integer,
  p_notes text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_date is null then raise exception 'A date is required'; end if;
  if p_minutes_spent is not null and (p_minutes_spent < 0 or p_minutes_spent > 1440) then
    raise exception 'Minutes must be between 0 and 1440';
  end if;

  update public.lessons
     set date = p_date,
         scheduled_date = p_date,
         completed_at = case when completed then (p_date::timestamp + interval '12 hours') at time zone 'UTC' else completed_at end,
         minutes_spent = p_minutes_spent,
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         queue_pinned = true,
         scheduled_source = 'report_correction',
         updated_at = now()
   where id = p_lesson_id
     and user_id = v_user
     and completed = true;

  return found;
end;
$$;

create or replace function public.delete_report_lesson_record(p_lesson_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_goal uuid;
  v_lesson_number integer;
  v_queue_position integer;
  r record;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select curriculum_goal_id, lesson_number, queue_position
    into v_goal, v_lesson_number, v_queue_position
    from public.lessons
   where id = p_lesson_id and user_id = v_user and completed = true
   for update;

  if not found then return false; end if;

  -- A photo created from this completion is evidence for this exact record.
  -- Remove the memory row with the record; the existing orphan-photo cleanup
  -- removes its storage object. Otherwise a deleted lesson would still print.
  delete from public.memories where user_id = v_user and lesson_id = p_lesson_id;
  delete from public.lessons where id = p_lesson_id and user_id = v_user;

  if v_goal is not null and v_lesson_number is not null then
    for r in
      select id, lesson_number
        from public.lessons
       where user_id = v_user and curriculum_goal_id = v_goal
         and lesson_number > v_lesson_number
       order by lesson_number
    loop
      update public.lessons
         set lesson_number = r.lesson_number - 1,
             title = regexp_replace(title, ' — Lesson [0-9]+$', ' — Lesson ' || (r.lesson_number - 1)),
             updated_at = now()
       where id = r.id and user_id = v_user;
    end loop;
  end if;

  if v_goal is not null and v_queue_position is not null then
    for r in
      select id, queue_position
        from public.lessons
       where user_id = v_user and curriculum_goal_id = v_goal
         and queue_position > v_queue_position
       order by queue_position
    loop
      update public.lessons
         set queue_position = r.queue_position - 1,
             updated_at = now()
       where id = r.id and user_id = v_user;
    end loop;
  end if;

  if v_goal is not null then
    perform public.recompute_curriculum_current_lesson(v_goal);
  end if;
  return true;
end;
$$;

create or replace function public.update_report_activity_record(
  p_log_id uuid,
  p_date date,
  p_minutes_spent integer,
  p_notes text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_date is null then raise exception 'A date is required'; end if;
  if p_minutes_spent is not null and (p_minutes_spent < 0 or p_minutes_spent > 1440) then
    raise exception 'Minutes must be between 0 and 1440';
  end if;

  update public.activity_logs
     set date = p_date,
         completed_at = case when completed then (p_date::timestamp + interval '12 hours') at time zone 'UTC' else completed_at end,
         minutes_spent = p_minutes_spent,
         notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_log_id and user_id = v_user and completed = true;
  return found;
end;
$$;

create or replace function public.delete_report_activity_record(p_log_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.activity_logs
     where id = p_log_id and user_id = auth.uid() and completed = true
     returning id
  )
  select exists(select 1 from deleted);
$$;

revoke all on function public.update_report_lesson_record(uuid,date,integer,text) from public;
revoke all on function public.delete_report_lesson_record(uuid) from public;
revoke all on function public.update_report_activity_record(uuid,date,integer,text) from public;
revoke all on function public.delete_report_activity_record(uuid) from public;

grant execute on function public.update_report_lesson_record(uuid,date,integer,text) to authenticated;
grant execute on function public.delete_report_lesson_record(uuid) to authenticated;
grant execute on function public.update_report_activity_record(uuid,date,integer,text) to authenticated;
grant execute on function public.delete_report_activity_record(uuid) to authenticated;
