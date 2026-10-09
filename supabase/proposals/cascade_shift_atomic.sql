-- LOCAL REVIEW DRAFT ONLY. Never applied remotely. Supabase CLI is unavailable
-- here, so this is deliberately outside migrations/ with no invented version.
-- Apply only after independent review, full-schema rehearsal and release approval.
-- No existing family row is changed by installing these definitions.
alter table public.lessons add column if not exists queue_preserved boolean not null default false;
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

-- The account timezone is scheduling input, not a caller-selected offset.
-- Derive both civil midnights independently: DST days need not be 24 hours.
create function rooted_private.cascade_local_window(p_user uuid,p_day date)
returns jsonb language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare zone text; first_instant timestamptz; last_instant timestamptz;
begin
 select p.timezone into zone from public.profiles p where p.id=p_user;
 if zone is null or p_day is null or not exists(select 1 from pg_timezone_names where name=zone) then return null;end if;
 first_instant:=p_day::timestamp at time zone zone;
 last_instant:=(p_day+1)::timestamp at time zone zone;
 if last_instant<=first_instant then return null;end if;
 return jsonb_build_object('timeZone',zone,
  'dayStartIso',to_char(first_instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'dayEndIso',to_char(last_instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end $$;
revoke all on function rooted_private.cascade_local_window(uuid,date) from public,anon,authenticated;

create function rooted_private.cascade_window_valid(p_user uuid,p_day date,p_start text,p_end text)
returns boolean language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare canonical jsonb:=rooted_private.cascade_local_window(p_user,p_day);
begin
 return canonical is not null and p_start is not null and p_end is not null
  and p_start::timestamptz=(canonical->>'dayStartIso')::timestamptz
  and p_end::timestamptz=(canonical->>'dayEndIso')::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then return false;
end $$;
revoke all on function rooted_private.cascade_window_valid(uuid,date,text,text) from public,anon,authenticated;

-- One exact read shape, including all lesson fields and row membership. Keeping
-- title/notes/etc in expected state prevents Undo from redating later work.
create function rooted_private.cascade_snapshot(p_goal uuid, p_day date, p_start text, p_end text)
returns jsonb language sql stable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'userId', g.user_id, 'goal', to_jsonb(g),
    'rows', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.lessons l where l.curriculum_goal_id=g.id),'[]'::jsonb),
    'rowCount', (select count(*) from public.lessons l where l.curriculum_goal_id=g.id),
    'vacations', coalesce((select jsonb_agg(jsonb_build_object('start_date',v.start_date,'end_date',v.end_date) order by v.start_date,v.end_date) from public.vacation_blocks v where v.user_id=g.user_id),'[]'::jsonb),
    'localDay',p_day::text,'dayStartIso',p_start,'dayEndIso',p_end,
    'timeZone',rooted_private.cascade_local_window(g.user_id,p_day)->>'timeZone')
  from public.curriculum_goals g where g.id=p_goal
$$;
revoke all on function rooted_private.cascade_snapshot(uuid,date,text,text) from public, anon, authenticated;

create function public.read_cascade_snapshot(p_goal_id uuid,p_local_day date,p_day_start text,p_day_end text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare canonical jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.curriculum_goals where id=p_goal_id and user_id=auth.uid() and not archived) then
    return jsonb_build_object('status','invalid','reason','owner');
  end if;
  canonical:=rooted_private.cascade_local_window(auth.uid(),p_local_day);
  if canonical is null or p_local_day is distinct from (now() at time zone (canonical->>'timeZone'))::date then return jsonb_build_object('status','invalid','reason','local_day');end if;
  -- Today/Plan use the active browser calendar. Refuse mismatched boundaries
  -- (even on the same calendar date) instead of silently reinterpreting them.
  if not rooted_private.cascade_window_valid(auth.uid(),p_local_day,p_day_start,p_day_end) then
    return jsonb_build_object('status','invalid','reason','calendar_mismatch');
  end if;
  return jsonb_build_object('status','ready','snapshot',rooted_private.cascade_snapshot(p_goal_id,p_local_day,canonical->>'dayStartIso',canonical->>'dayEndIso'));
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

-- Compare the intended complete post-state to trigger-visible stored state.
-- Only targeted scheduling fields and their updated_at may differ.
create function rooted_private.cascade_postcondition(before_state jsonb,after_state jsonb,moves jsonb,direction text)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare r jsonb; actual_row jsonb; change jsonb; expected_row jsonb;
begin
 if (before_state-'rows') is distinct from (after_state-'rows') then return false; end if;
 if jsonb_array_length(before_state->'rows')<>jsonb_array_length(after_state->'rows') then return false; end if;
 for r in select * from jsonb_array_elements(before_state->'rows') loop
  select x into actual_row from jsonb_array_elements(after_state->'rows') x where x->>'id'=r->>'id';
  if actual_row is null then return false; end if;
  select x->direction into change from jsonb_array_elements(moves) x where x->>'id'=r->>'id';
  if change is null then
   if actual_row is distinct from r then return false; end if;
  else
   expected_row:=r||jsonb_build_object('date',change->'date','scheduled_date',change->'scheduled_date','queue_pinned',change->'queue_pinned','scheduled_source',change->'scheduled_source','queue_preserved',change->'queue_preserved');
   if (actual_row-'updated_at') is distinct from (expected_row-'updated_at') then return false; end if;
  end if;
 end loop;
 return true;
end $$;
revoke all on function rooted_private.cascade_postcondition(jsonb,jsonb,jsonb,text) from public,anon,authenticated;

-- Independent server counterpart of computeNextLessonsForGoal. This is a
-- validator, never a repair: any divergence refuses the entire transaction.
-- Differential tests must accompany changes to either projector.
create function rooted_private.cascade_projection_matches(state jsonb)
returns boolean language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare
 g jsonb:=state->'goal'; r jsonb; slot integer; pointer integer:=(g->>'current_lesson')::int;
 total integer:=(g->>'total_lessons')::int; day date:=(state->>'localDay')::date;
 cursor_day date:=greatest(day,(g->>'start_date')::date); end_day date:=day+3650;
 pin_dates jsonb:='{}'; skipped jsonb:='{}'; used jsonb:='{}'; emitted jsonb:='{}'; projected jsonb:='{}'; makeups jsonb:='{}';
 d date; next_slot integer; done_count integer; back integer; cap integer; used_count integer;
 first_applied boolean:=false; placed boolean; safety integer:=0; label text; override_value jsonb;
begin
 if day is null or pointer is null or total is null then return false; end if;
 -- PR146's unslotted reservations are not implemented by this validator.
 -- Conservative refusal is required; ignoring them can certify wrong dates.
 if exists(select 1 from jsonb_array_elements(state->'rows') x where x->>'queue_position' is null) then return false;end if;
 select count(*) into done_count from jsonb_array_elements(state->'rows') x where (x->>'completed')::boolean
  and (x->>'completed_at')::timestamptz >= (state->>'dayStartIso')::timestamptz
  and (x->>'completed_at')::timestamptz < (state->>'dayEndIso')::timestamptz;
 for r in select * from jsonb_array_elements(state->'rows') loop
  slot:=(r->>'queue_position')::int;
  if slot is not null and not coalesce((r->>'completed')::boolean,false) and coalesce((r->>'skipped')::boolean,false) then skipped:=skipped||jsonb_build_object(slot::text,true); end if;
 end loop;
 for r in select * from jsonb_array_elements(state->'rows') loop
  slot:=(r->>'queue_position')::int;d:=coalesce(r->>'scheduled_date',r->>'date')::date;
  if slot is not null and d is not null and slot>=1 and slot<=total and not coalesce((r->>'completed')::boolean,false) and not skipped ? slot::text and coalesce((r->>'queue_preserved')::boolean,false) then
   emitted:=emitted||jsonb_build_object(slot::text,true);makeups:=makeups||jsonb_build_object(slot::text,true);
   projected:=projected||jsonb_build_object(slot::text,d);used:=used||jsonb_build_object(d::text,coalesce((used->>d::text)::int,0)+1);continue;
  end if;
  if slot is null or d is null or coalesce((r->>'completed')::boolean,false) or not coalesce((r->>'queue_pinned')::boolean,false) or skipped ? slot::text then continue; end if;
  if slot>pointer and slot<=total then
   if pin_dates ? slot::text then return false; end if;
   pin_dates:=pin_dates||jsonb_build_object(slot::text,d);used:=used||jsonb_build_object(d::text,coalesce((used->>d::text)::int,0)+1);
  elsif slot>=1 and slot<=pointer and d>=day and d<end_day then
   if makeups ? slot::text then return false; end if;
   makeups:=makeups||jsonb_build_object(slot::text,true);emitted:=emitted||jsonb_build_object(slot::text,true);
   used:=used||jsonb_build_object(d::text,coalesce((used->>d::text)::int,0)+1);
  end if;
 end loop;
 next_slot:=pointer+1;
 while next_slot<=total and safety<10000 loop
  safety:=safety+1;
  if emitted ? next_slot::text or skipped ? next_slot::text then next_slot:=next_slot+1;continue; end if;
  if pin_dates ? next_slot::text then
   d:=(pin_dates->>next_slot::text)::date;if d>=end_day then exit;end if;
   projected:=projected||jsonb_build_object(next_slot::text,d);emitted:=emitted||jsonb_build_object(next_slot::text,true);
   cursor_day:=greatest(cursor_day,d);next_slot:=next_slot+1;continue;
  end if;
  placed:=false;
  while cursor_day<end_day and safety<10000 loop
   safety:=safety+1;
   if rooted_private.cascade_steps((g->>'id')::uuid,cursor_day-1,cursor_day)=1 then
    label:=(array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[extract(dow from cursor_day)::int+1];
    override_value:=g->'lessons_per_day_overrides'->label;
    cap:=greatest(1,(g->>'lessons_per_day')::int);
    if jsonb_typeof(override_value)='number' and (override_value::text)::numeric>=0 then cap:=floor((override_value::text)::numeric)::int;end if;
    if cap>0 then
     if not first_applied and cursor_day=day then
      next_slot:=pointer+1;back:=done_count;
      while back>0 and next_slot>1 loop next_slot:=next_slot-1;if not skipped ? next_slot::text and not makeups ? next_slot::text then back:=back-1;end if;end loop;
      while skipped ? next_slot::text or makeups ? next_slot::text loop next_slot:=next_slot+1;end loop;
      first_applied:=true;
      if next_slot>total or pin_dates ? next_slot::text then exit;end if;
     end if;
     used_count:=coalesce((used->>cursor_day::text)::int,0);
     if used_count<cap or (first_applied and cursor_day=day and next_slot<=pointer) then
      projected:=projected||jsonb_build_object(next_slot::text,cursor_day);emitted:=emitted||jsonb_build_object(next_slot::text,true);
      used:=used||jsonb_build_object(cursor_day::text,used_count+1);next_slot:=next_slot+1;placed:=true;exit;
     end if;
    end if;
   end if;
   cursor_day:=cursor_day+1;
  end loop;
  if not placed then if pin_dates ? next_slot::text and cursor_day<end_day then continue;end if;exit;end if;
 end loop;
 for r in select * from jsonb_array_elements(state->'rows') loop
  slot:=(r->>'queue_position')::int;
  if slot is null or slot<=pointer or coalesce((r->>'completed')::boolean,false) or coalesce((r->>'skipped')::boolean,false) or coalesce((r->>'is_backfill')::boolean,false) or r->>'continues_lesson_id' is not null then continue;end if;
  if (projected->>slot::text) is distinct from (r->>'scheduled_date') then return false;end if;
 end loop;
 return true;
end $$;
revoke all on function rooted_private.cascade_projection_matches(jsonb) from public,anon,authenticated;

create function public.commit_cascade_shift(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_choice jsonb,p_moves jsonb,p_preserved jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  u uuid:=auth.uid(); g public.curriculum_goals%rowtype; selected public.lessons%rowtype;
  prior rooted_private.cascade_shift_receipts%rowtype; actual jsonb; after_state jsonb;
  request jsonb:=jsonb_build_object('expected',p_expected,'choice',p_choice,'moves',p_moves,'preserved',p_preserved);
  all_moves jsonb:=p_moves||p_preserved; day date; target date; delta integer; required integer; got integer; bad integer; w jsonb;
begin
  if u is null or p_operation_id is null then return jsonb_build_object('status','invalid','reason','owner'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into prior from rooted_private.cascade_shift_receipts where id=p_operation_id;
  if found then
    if prior.user_id<>u or prior.goal_id<>p_goal_id or prior.request<>request then return jsonb_build_object('status','invalid','reason','operation'); end if;
    return jsonb_build_object('status',case when prior.undone_at is null then 'already_applied' else 'already_undone' end,'operationId',p_operation_id);
  end if;
  -- Completion locks a lesson before its trigger updates the goal. Never wait
  -- for its lesson while holding that goal. This subtransaction releases every
  -- acquired row lock on conflict, even if the caller keeps its transaction open.
  begin
    select * into g from public.curriculum_goals where id=p_goal_id and user_id=u and not archived for update nowait;
    if not found then return jsonb_build_object('status','invalid','reason','owner'); end if;
    perform 1 from public.lessons where curriculum_goal_id=p_goal_id order by id for update nowait;
  exception when lock_not_available then
    return jsonb_build_object('status','stale','reason','busy');
  end;
  -- Pin the authoritative timezone through validation and all writes.
  perform 1 from public.profiles where id=u for share;
  if not found then return jsonb_build_object('status','invalid','reason','time_zone');end if;
  -- Blocks a concurrent break insert/update during validation+commit. This is
  -- a short global write lock and requires performance review before release.
  lock table public.vacation_blocks in share mode;
  day:=(p_expected->>'localDay')::date;
  if day is null or abs(day-(now() at time zone 'UTC')::date)>1 then return jsonb_build_object('status','invalid','reason','local_day'); end if;
  if not rooted_private.cascade_window_valid(u,day,p_expected->>'dayStartIso',p_expected->>'dayEndIso') or day is distinct from (now() at time zone (rooted_private.cascade_local_window(u,day)->>'timeZone'))::date then return jsonb_build_object('status','invalid','reason','day_window');end if;
  actual:=rooted_private.cascade_snapshot(p_goal_id,day,p_expected->>'dayStartIso',p_expected->>'dayEndIso');
  if actual is distinct from p_expected then return jsonb_build_object('status','stale'); end if;
  if exists(select 1 from public.lessons where curriculum_goal_id=p_goal_id and queue_position is null) then
    return jsonb_build_object('status','invalid','reason','unsupported_queue');
  end if;
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
        and jsonb_build_object('scheduled_date',l.scheduled_date,'date',l.date,'queue_pinned',l.queue_pinned,'scheduled_source',l.scheduled_source,'queue_preserved',l.queue_preserved)=w->'before';
    -- Payload keys are checked below; only these four columns are ever written.
    if got<>1 then return jsonb_build_object('status','invalid','reason','row'); end if;
    if (w->'after'->>'queue_preserved')::boolean is distinct from false or (w->'after'->>'date') is distinct from (w->'after'->>'scheduled_date')
      or (w->'after'->>'queue_pinned')::boolean is distinct from (case when (w->>'id')::uuid=selected.id then true else (w->'before'->>'queue_pinned')::boolean end)
      or (w->'after'->>'scheduled_source') is distinct from (case when (w->>'id')::uuid=selected.id then 'plan_move' else 'plan_cascade_shift' end)
      or (w->'after'->>'date')::date<day
      or rooted_private.cascade_steps(p_goal_id,(w->'before'->>'scheduled_date')::date,(w->'after'->>'date')::date)<>delta
      or rooted_private.cascade_steps(p_goal_id,(w->'after'->>'date')::date-1,(w->'after'->>'date')::date)<>1
      or ((w->>'id')::uuid=selected.id and (w->'after'->>'date')::date<>target)
    then return jsonb_build_object('status','invalid','reason','shape'); end if;
  end loop;
  -- Earlier unfinished dates remain authoritative without becoming pins or
  -- completions. The exact prefix is separate from the confirmed moved suffix.
  select count(*) into required from public.lessons where curriculum_goal_id=p_goal_id and not completed and not skipped and not coalesce(is_backfill,false) and continues_lesson_id is null and queue_position<selected.queue_position and scheduled_date is not null and not queue_preserved;
  if jsonb_typeof(p_preserved) is distinct from 'array' or jsonb_array_length(p_preserved)<>required or (select count(distinct x->>'id') from jsonb_array_elements(p_preserved) x)<>required then return jsonb_build_object('status','invalid','reason','preserved_scope');end if;
  for w in select * from jsonb_array_elements(p_preserved) loop
   select count(*) into got from public.lessons l where l.id=(w->>'id')::uuid and l.curriculum_goal_id=p_goal_id and l.user_id=u and not completed and not skipped and not coalesce(is_backfill,false) and continues_lesson_id is null and queue_position<selected.queue_position and scheduled_date is not null and not queue_preserved
    and jsonb_build_object('scheduled_date',l.scheduled_date,'date',l.date,'queue_pinned',l.queue_pinned,'scheduled_source',l.scheduled_source,'queue_preserved',l.queue_preserved)=w->'before';
   if got<>1 or w->'after' is distinct from ((w->'before')||'{"queue_preserved":true}'::jsonb) then return jsonb_build_object('status','invalid','reason','preserved_row');end if;
  end loop;
  -- A nested block is a subtransaction: any failure rolls EVERY date/pin back.
  begin
    for w in select * from jsonb_array_elements(all_moves) loop
      update public.lessons set scheduled_date=(w->'after'->>'scheduled_date')::date,date=(w->'after'->>'date')::date,
        queue_preserved=(w->'after'->>'queue_preserved')::boolean,queue_pinned=(w->'after'->>'queue_pinned')::boolean,scheduled_source=w->'after'->>'scheduled_source'
        where id=(w->>'id')::uuid;
      get diagnostics got=row_count;
      if got<>1 then raise exception 'cascade row refused'; end if;
    end loop;
    set constraints all immediate;
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
    if not rooted_private.cascade_postcondition(actual,after_state,all_moves,'after') then raise exception 'cascade postcondition';end if;
    if not rooted_private.cascade_projection_matches(after_state) then raise exception 'cascade projector mismatch';end if;
    insert into rooted_private.cascade_shift_receipts(id,user_id,goal_id,request,before_snapshot,after_snapshot,moves)
      values(p_operation_id,u,p_goal_id,request,actual,after_state,all_moves);
  exception when others then
    return jsonb_build_object('status','failed','reason','transaction');
  end;
  return jsonb_build_object('status','applied','operationId',p_operation_id,'snapshot',after_state);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return jsonb_build_object('status','invalid','reason','payload');
end $$;
revoke all on function public.commit_cascade_shift(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.commit_cascade_shift(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;

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
  -- Match commit's nonblocking goal/lesson acquisition and release semantics.
  begin
    perform 1 from public.curriculum_goals where id=receipt.goal_id and user_id=auth.uid() for update nowait;
    if not found then return jsonb_build_object('status','stale'); end if;
    perform 1 from public.lessons where curriculum_goal_id=receipt.goal_id order by id for update nowait;
  exception when lock_not_available then
    return jsonb_build_object('status','stale','reason','busy');
  end;
  perform 1 from public.profiles where id=auth.uid() for share;
  lock table public.vacation_blocks in share mode;
  actual:=rooted_private.cascade_snapshot(receipt.goal_id,(receipt.after_snapshot->>'localDay')::date,receipt.after_snapshot->>'dayStartIso',receipt.after_snapshot->>'dayEndIso');
  if actual is distinct from receipt.after_snapshot then return jsonb_build_object('status','stale'); end if;
  begin
    for w in select * from jsonb_array_elements(receipt.moves) loop
      update public.lessons set scheduled_date=(w->'before'->>'scheduled_date')::date,date=(w->'before'->>'date')::date,
        queue_preserved=(w->'before'->>'queue_preserved')::boolean,queue_pinned=(w->'before'->>'queue_pinned')::boolean,scheduled_source=w->'before'->>'scheduled_source'
        where id=(w->>'id')::uuid and curriculum_goal_id=receipt.goal_id;
      get diagnostics n=row_count;
      if n<>1 then raise exception 'undo row refused'; end if;
    end loop;
    set constraints all immediate;
    if not rooted_private.cascade_postcondition(actual,rooted_private.cascade_snapshot(receipt.goal_id,(receipt.after_snapshot->>'localDay')::date,receipt.after_snapshot->>'dayStartIso',receipt.after_snapshot->>'dayEndIso'),receipt.moves,'before') then raise exception 'undo postcondition';end if;
    update rooted_private.cascade_shift_receipts set undone_at=clock_timestamp() where id=p_operation_id;
  exception when others then return jsonb_build_object('status','failed'); end;
  return jsonb_build_object('status','undone');
end $$;
revoke all on function public.undo_cascade_shift(uuid) from public,anon;
grant execute on function public.undo_cascade_shift(uuid) to authenticated;
