-- LOCAL REVIEW DRAFT ONLY. Never applied remotely. Supabase CLI is unavailable
-- here, so this is deliberately outside migrations/ with no invented version.
-- Apply only after independent review, full-schema rehearsal and release approval.
-- No existing family row is changed by installing these definitions.
create schema if not exists rooted_private;
create table rooted_private.cascade_shift_receipts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.curriculum_goals(id) on delete cascade,
  request jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  moves jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  undone_at timestamptz
);
alter table rooted_private.cascade_shift_receipts enable row level security;
revoke all on rooted_private.cascade_shift_receipts from public, anon, authenticated;

-- One exact read shape, including all lesson fields and row membership. Keeping
-- title/notes/etc in expected state prevents Undo from redating later work.
create function rooted_private.cascade_snapshot(p_goal uuid, p_day date, p_start text, p_end text)
returns jsonb language sql stable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'userId', g.user_id, 'goal', to_jsonb(g),
    'rows', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.lessons l where l.curriculum_goal_id=g.id),'[]'::jsonb),
    'rowCount', (select count(*) from public.lessons l where l.curriculum_goal_id=g.id),
    'vacations', coalesce((select jsonb_agg(jsonb_build_object('start_date',v.start_date,'end_date',v.end_date) order by v.start_date,v.end_date) from public.vacation_blocks v where v.user_id=g.user_id),'[]'::jsonb),
    'localDay',p_day::text,'dayStartIso',p_start,'dayEndIso',p_end)
  from public.curriculum_goals g where g.id=p_goal
$$;
revoke all on function rooted_private.cascade_snapshot(uuid,date,text,text) from public, anon, authenticated;

create function public.read_cascade_snapshot(p_goal_id uuid,p_local_day date,p_day_start text,p_day_end text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if auth.uid() is null or not exists(select 1 from public.curriculum_goals where id=p_goal_id and user_id=auth.uid() and not archived) then
    return jsonb_build_object('status','invalid','reason','owner');
  end if;
  return jsonb_build_object('status','ready','snapshot',rooted_private.cascade_snapshot(p_goal_id,p_local_day,p_day_start,p_day_end));
end $$;
revoke all on function public.read_cascade_snapshot(uuid,date,text,text) from public,anon;
grant execute on function public.read_cascade_snapshot(uuid,date,text,text) to authenticated;

-- Validation only, not a second date picker: count the selected teaching-day
-- offset. Target dates are chosen by the shared TS school-day helper/projector.
create function rooted_private.cascade_steps(p_goal uuid,p_from date,p_to date)
returns integer language sql stable set search_path=pg_catalog,pg_temp as $$
  select count(*)::integer from public.curriculum_goals g,
    generate_series(p_from+1,p_to,interval '1 day') d
  where g.id=p_goal
    and (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[extract(dow from d)::int+1]
      = any(case when cardinality(g.school_days)>0 then g.school_days else array['Mon','Tue','Wed','Thu','Fri'] end)
    and not exists(select 1 from public.vacation_blocks v where v.user_id=g.user_id and d::date between v.start_date and v.end_date)
$$;
revoke all on function rooted_private.cascade_steps(uuid,date,date) from public,anon,authenticated;

create function public.commit_cascade_shift(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_choice jsonb,p_moves jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  u uuid:=auth.uid(); g public.curriculum_goals%rowtype; selected public.lessons%rowtype;
  prior rooted_private.cascade_shift_receipts%rowtype; actual jsonb; after_state jsonb;
  request jsonb:=jsonb_build_object('expected',p_expected,'choice',p_choice,'moves',p_moves);
  day date; target date; delta integer; required integer; got integer; bad integer; w jsonb;
begin
  if u is null or p_operation_id is null then return jsonb_build_object('status','invalid','reason','owner'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into prior from rooted_private.cascade_shift_receipts where id=p_operation_id;
  if found then
    if prior.user_id<>u or prior.goal_id<>p_goal_id or prior.request<>request then return jsonb_build_object('status','invalid','reason','operation'); end if;
    return jsonb_build_object('status',case when prior.undone_at is null then 'already_applied' else 'already_undone' end,'operationId',p_operation_id);
  end if;
  select * into g from public.curriculum_goals where id=p_goal_id and user_id=u and not archived for update;
  if not found then return jsonb_build_object('status','invalid','reason','owner'); end if;
  perform 1 from public.lessons where curriculum_goal_id=p_goal_id order by id for update;
  -- Blocks a concurrent break insert/update during validation+commit. This is
  -- a short global write lock and requires performance review before release.
  lock table public.vacation_blocks in share mode;
  day:=(p_expected->>'localDay')::date;
  if day is null or abs(day-(now() at time zone 'UTC')::date)>1 then return jsonb_build_object('status','invalid','reason','local_day'); end if;
  actual:=rooted_private.cascade_snapshot(p_goal_id,day,p_expected->>'dayStartIso',p_expected->>'dayEndIso');
  if actual is distinct from p_expected then return jsonb_build_object('status','stale'); end if;
  if jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves)=0 then return jsonb_build_object('status','invalid','reason','moves'); end if;
  select * into selected from public.lessons where id=(p_choice->>'lessonId')::uuid and curriculum_goal_id=p_goal_id;
  target:=(p_choice->>'to')::date;
  if not found or selected.completed or selected.skipped or coalesce(selected.is_backfill,false) or selected.continues_lesson_id is not null
    or selected.queue_position is null or selected.queue_position<=g.current_lesson
    or selected.scheduled_date is distinct from (p_choice->>'from')::date
    or target<=selected.scheduled_date or target<day then return jsonb_build_object('status','invalid','reason','selection'); end if;
  delta:=rooted_private.cascade_steps(p_goal_id,selected.scheduled_date,target);
  if delta<1 then return jsonb_build_object('status','invalid','reason','offset'); end if;
  -- Existing book drift must not be silently repaired by a shift.
  select count(*) into bad from (select lesson_number,lag(lesson_number) over(order by queue_position) prev from public.lessons where curriculum_goal_id=p_goal_id and queue_position is not null and lesson_number is not null) q where lesson_number<prev;
  if bad>0 then return jsonb_build_object('status','invalid','reason','queue_order'); end if;
  select count(*) into required from public.lessons where curriculum_goal_id=p_goal_id and not completed and not skipped and not coalesce(is_backfill,false) and continues_lesson_id is null and queue_position>=selected.queue_position;
  select count(distinct x->>'id') into got from jsonb_array_elements(p_moves) x;
  if got<>required or jsonb_array_length(p_moves)<>required then return jsonb_build_object('status','invalid','reason','scope'); end if;
  for w in select * from jsonb_array_elements(p_moves) loop
    select count(*) into got from public.lessons l
      where l.id=(w->>'id')::uuid and l.curriculum_goal_id=p_goal_id and l.user_id=u
        and not l.completed and not l.skipped and not coalesce(l.is_backfill,false) and l.continues_lesson_id is null
        and l.queue_position>=selected.queue_position
        and jsonb_build_object('scheduled_date',l.scheduled_date,'date',l.date,'queue_pinned',l.queue_pinned,'scheduled_source',l.scheduled_source)=w->'before';
    -- Payload keys are checked below; only these four columns are ever written.
    if got<>1 then return jsonb_build_object('status','invalid','reason','row'); end if;
    if (w->'after'->>'date') is distinct from (w->'after'->>'scheduled_date')
      or (w->'after'->>'queue_pinned')::boolean is distinct from (case when (w->>'id')::uuid=selected.id then true else (w->'before'->>'queue_pinned')::boolean end)
      or (w->'after'->>'scheduled_source') is distinct from (case when (w->>'id')::uuid=selected.id then 'plan_move' else 'plan_cascade_shift' end)
      or (w->'after'->>'date')::date<day
      or rooted_private.cascade_steps(p_goal_id,(w->'before'->>'scheduled_date')::date,(w->'after'->>'date')::date)<>delta
      or rooted_private.cascade_steps(p_goal_id,(w->'after'->>'date')::date-1,(w->'after'->>'date')::date)<>1
      or ((w->>'id')::uuid=selected.id and (w->'after'->>'date')::date<>target)
    then return jsonb_build_object('status','invalid','reason','shape'); end if;
  end loop;
  -- A nested block is a subtransaction: any failure rolls EVERY date/pin back.
  begin
    for w in select * from jsonb_array_elements(p_moves) loop
      update public.lessons set scheduled_date=(w->'after'->>'scheduled_date')::date,date=(w->'after'->>'date')::date,
        queue_pinned=(w->'after'->>'queue_pinned')::boolean,scheduled_source=w->'after'->>'scheduled_source'
        where id=(w->>'id')::uuid;
      get diagnostics got=row_count;
      if got<>1 then raise exception 'cascade row refused'; end if;
    end loop;
    -- No newly overloaded destination, including protected continuations and
    -- completed work. Existing unrelated stacked dates remain untouched.
    select count(*) into bad from (
      select l.scheduled_date,count(*) n from public.lessons l where l.curriculum_goal_id=p_goal_id and not l.skipped
        and l.scheduled_date in (select (x->'after'->>'date')::date from jsonb_array_elements(p_moves) x)
      group by l.scheduled_date
    ) d where d.n>coalesce((g.lessons_per_day_overrides->>((array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[extract(dow from d.scheduled_date)::int+1]))::int,g.lessons_per_day);
    if bad>0 then raise exception 'cascade capacity'; end if;
    select count(*) into bad from (select scheduled_date,lag(scheduled_date) over(order by queue_position) prev from public.lessons where curriculum_goal_id=p_goal_id and not completed and not skipped and not coalesce(is_backfill,false) and queue_position>g.current_lesson) q where scheduled_date<prev;
    if bad>0 then raise exception 'cascade order'; end if;
    after_state:=rooted_private.cascade_snapshot(p_goal_id,day,p_expected->>'dayStartIso',p_expected->>'dayEndIso');
    insert into rooted_private.cascade_shift_receipts(id,user_id,goal_id,request,before_snapshot,after_snapshot,moves)
      values(p_operation_id,u,p_goal_id,request,actual,after_state,p_moves);
  exception when others then
    return jsonb_build_object('status','failed','reason','transaction');
  end;
  return jsonb_build_object('status','applied','operationId',p_operation_id,'snapshot',after_state);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return jsonb_build_object('status','invalid','reason','payload');
end $$;
revoke all on function public.commit_cascade_shift(uuid,uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.commit_cascade_shift(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;

create function public.undo_cascade_shift(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare receipt rooted_private.cascade_shift_receipts%rowtype; actual jsonb; w jsonb; n integer;
begin
  if auth.uid() is null then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into receipt from rooted_private.cascade_shift_receipts where id=p_operation_id and user_id=auth.uid() for update;
  if not found then return jsonb_build_object('status','invalid'); end if;
  if receipt.undone_at is not null then return jsonb_build_object('status','already_undone'); end if;
  if clock_timestamp()-receipt.created_at>interval '10 minutes' then return jsonb_build_object('status','expired'); end if;
  perform 1 from public.curriculum_goals where id=receipt.goal_id and user_id=auth.uid() for update;
  if not found then return jsonb_build_object('status','stale'); end if;
  perform 1 from public.lessons where curriculum_goal_id=receipt.goal_id order by id for update;
  lock table public.vacation_blocks in share mode;
  actual:=rooted_private.cascade_snapshot(receipt.goal_id,(receipt.after_snapshot->>'localDay')::date,receipt.after_snapshot->>'dayStartIso',receipt.after_snapshot->>'dayEndIso');
  if actual is distinct from receipt.after_snapshot then return jsonb_build_object('status','stale'); end if;
  begin
    for w in select * from jsonb_array_elements(receipt.moves) loop
      update public.lessons set scheduled_date=(w->'before'->>'scheduled_date')::date,date=(w->'before'->>'date')::date,
        queue_pinned=(w->'before'->>'queue_pinned')::boolean,scheduled_source=w->'before'->>'scheduled_source'
        where id=(w->>'id')::uuid and curriculum_goal_id=receipt.goal_id;
      get diagnostics n=row_count;
      if n<>1 then raise exception 'undo row refused'; end if;
    end loop;
    update rooted_private.cascade_shift_receipts set undone_at=clock_timestamp() where id=p_operation_id;
  exception when others then return jsonb_build_object('status','failed'); end;
  return jsonb_build_object('status','undone');
end $$;
revoke all on function public.undo_cascade_shift(uuid) from public,anon;
grant execute on function public.undo_cascade_shift(uuid) to authenticated;
