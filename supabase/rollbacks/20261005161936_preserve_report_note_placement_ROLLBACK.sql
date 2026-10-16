-- Roll back the client first. Restore the old boolean RPC, then remove v2.
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


revoke all on function public.update_report_lesson_record(uuid,date,integer,text) from public, anon;
grant execute on function public.update_report_lesson_record(uuid,date,integer,text) to authenticated;
drop function public.update_report_lesson_record_v2(uuid,date,integer,text,date);
