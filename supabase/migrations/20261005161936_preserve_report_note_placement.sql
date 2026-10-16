-- Notes/time corrections must not turn into scheduling actions.
create or replace function public.update_report_lesson_record_v2(
  p_lesson_id uuid, p_date date, p_minutes_spent integer, p_notes text,
  p_expected_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.lessons%rowtype;
  v_changed boolean;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_date is null then raise exception 'A date is required'; end if;
  if p_minutes_spent is not null and (p_minutes_spent < 0 or p_minutes_spent > 1440) then
    raise exception 'Minutes must be between 0 and 1440';
  end if;

  select * into v_row from public.lessons
    where id = p_lesson_id and user_id = v_user and completed = true
    for update;
  if not found then return jsonb_build_object('saved', false); end if;
  -- This is the date the Reports editor displays. A stale tab cannot silently
  -- put another tab's date correction back while saving a note.
  if coalesce(v_row.date, v_row.scheduled_date) is distinct from p_expected_date then
    raise exception 'Record date changed. Reload Reports before saving.';
  end if;
  v_changed := coalesce(v_row.date, v_row.scheduled_date) is distinct from p_date;

  if v_changed then
    update public.lessons set date = p_date, scheduled_date = p_date,
      completed_at = (p_date::timestamp + interval '12 hours') at time zone 'UTC',
      queue_pinned = true, scheduled_source = 'report_correction',
      minutes_spent = p_minutes_spent,
      notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
      where id = v_row.id and user_id = v_user;
  else
    update public.lessons set minutes_spent = p_minutes_spent,
      notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
      where id = v_row.id and user_id = v_user;
  end if;
  return jsonb_build_object('saved', true, 'scheduling_changed', v_changed,
    'curriculum_goal_id', v_row.curriculum_goal_id);
end;
$$;

revoke all on function public.update_report_lesson_record_v2(uuid,date,integer,text,date) from public, anon;
grant execute on function public.update_report_lesson_record_v2(uuid,date,integer,text,date) to authenticated;

-- Preserve the old boolean contract for installed clients. Their redundant
-- resync remains until the new client is released, but the row's completion
-- timestamp/pin/source are no longer rewritten on a same-date edit.
create or replace function public.update_report_lesson_record(
  p_lesson_id uuid, p_date date, p_minutes_spent integer, p_notes text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select coalesce(date, scheduled_date) into v_date from public.lessons
    where id = p_lesson_id and user_id = auth.uid() and completed = true
    for update;
  if not found then return false; end if;
  return (public.update_report_lesson_record_v2(
    p_lesson_id, p_date, p_minutes_spent, p_notes, v_date)->>'saved')::boolean;
end;
$$;
revoke all on function public.update_report_lesson_record(uuid,date,integer,text) from public, anon;
grant execute on function public.update_report_lesson_record(uuid,date,integer,text) to authenticated;
