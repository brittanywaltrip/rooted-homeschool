-- Generated from reviewed a10838ae proposals. Local packaging only; not rollout authorization.
-- Requires the reviewed PR146/goal-guard stack and existing completion/move functions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$ BEGIN
IF to_regclass('rooted_private.cascade_shift_receipts') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.lessons'::regclass AND attname='queue_preserved' AND NOT attisdropped) THEN RAISE EXCEPTION 'Unexpected preexisting cascade/preservation schema; reconcile instead of replay'; END IF;
IF to_regclass('rooted_private.builder_commit_log') IS NULL OR to_regclass('rooted_private.daily_reconcile_log') IS NULL OR to_regclass('rooted_private.app_switches') IS NULL THEN RAISE EXCEPTION 'Missing reviewed Builder/daily dependencies'; END IF;
IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('rooted_private.lesson_carries_work(text,integer)')) IS DISTINCT FROM 'df8372242d67b3020f3777ac5e8e9c45' THEN RAISE EXCEPTION 'Baseline function drift: rooted_private.lesson_carries_work(text,integer)'; END IF;
IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.reopen_lesson(uuid,date)')) IS DISTINCT FROM '6a6c3a920eeda6c1299309b9ab19df9d' THEN RAISE EXCEPTION 'Baseline function drift: public.reopen_lesson(uuid,date)'; END IF;
IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.restore_queue_book_order(uuid,date)')) IS DISTINCT FROM '5794a1226fb06f20521913566596a6e2' THEN RAISE EXCEPTION 'Baseline function drift: public.restore_queue_book_order(uuid,date)'; END IF;
IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.move_lesson_keep_slot(uuid,date,date,boolean)')) IS DISTINCT FROM 'cc9d61dd703250808b35fad609c38c24' THEN RAISE EXCEPTION 'Baseline function drift: public.move_lesson_keep_slot(uuid,date,date,boolean)'; END IF;
IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.move_lesson_to_date(uuid,date)')) IS DISTINCT FROM 'd92d6872b2b14011d247779c6e37c546' THEN RAISE EXCEPTION 'Baseline function drift: public.move_lesson_to_date(uuid,date)'; END IF;
IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.apply_builder_rebuild(uuid,date,jsonb,jsonb,jsonb)')) IS DISTINCT FROM 'f31b17b46c25b2458c1ed79656964275' THEN RAISE EXCEPTION 'Baseline function drift: public.apply_builder_rebuild(uuid,date,jsonb,jsonb,jsonb)'; END IF;
IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.apply_builder_rebuild(uuid,date,jsonb,jsonb)')) IS DISTINCT FROM '0f6e208035a1d29e4a5172eef0f04c07' THEN RAISE EXCEPTION 'Baseline function drift: public.apply_builder_rebuild(uuid,date,jsonb,jsonb)'; END IF;
END $preflight$;
ALTER TABLE rooted_private.builder_commit_log ENABLE ROW LEVEL SECURITY;

-- SOURCE: supabase/proposals/cascade_shift_atomic.sql
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
revoke all on function public.read_cascade_snapshot(uuid,date,text,text) from public,anon,service_role;
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


-- SOURCE: supabase/proposals/preserved_cleanup_guard.sql
-- LOCAL REVIEW DRAFT. Prevent pointer cleanup and unaware writers from erasing
-- explicitly preserved earlier unfinished work. No existing data updates.
CREATE OR REPLACE FUNCTION public.curriculum_goals_cleanup_orphans_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skip text;
BEGIN
  -- Re-entry guard, kept from 20260519180000. It blocks re-entry into THIS
  -- function only. That was never sufficient on its own (see the header of
  -- 20260824000000), but the statement below no longer flips `completed`, so
  -- lessons_recompute_current_lesson_trg is not fired by it and there is no
  -- second path back into this function to guard against.
  v_skip := current_setting('rooted.skip_orphan_cleanup', true);
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_lesson > OLD.current_lesson THEN
    PERFORM set_config('rooted.skip_orphan_cleanup', 'true', true);

    -- UNSCHEDULE orphans. Do not complete them, do not re-date them.
    --
    -- An orphan is an incomplete row that the queue pointer has moved past.
    -- The harm it does is holding a calendar day the live queue has already
    -- given to a lesson ahead of it, so releasing the day is the entire fix.
    -- Whether the family ever did that lesson is not something this trigger
    -- can know, and it must not guess: every row it guessed about is in the
    -- 289 this migration exists to stop.
    UPDATE public.lessons
      SET scheduled_date = NULL
      WHERE curriculum_goal_id = NEW.id
        AND completed = false
        AND scheduled_date IS NOT NULL
        -- Preserve PR146's placement rule for lessons outside the queue.
        AND queue_position IS NOT NULL
        AND queue_pinned = false
        AND queue_preserved = false
        AND lesson_number IS NOT NULL
        AND lesson_number <= NEW.current_lesson
        AND (notes IS NULL OR notes = '');
  END IF;

  RETURN NEW;
END;
$$;

-- Standing rule: re-assert grants whenever a SECURITY DEFINER function is
-- recreated. CREATE OR REPLACE preserves them, but stating them keeps a fresh
-- environment identical to production and stops a future DROP + CREATE from
-- silently widening access. Trigger function; never called over /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM anon;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() TO service_role;



create or replace function public.guard_preserved_work() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if old.queue_preserved and not old.completed and not old.skipped then
  if TG_OP='DELETE' then
   if exists(select 1 from public.curriculum_goals where id=old.curriculum_goal_id) then raise exception 'Preserved unfinished work must be explicitly resolved before deleting';end if;
  elsif new.queue_preserved and not new.completed and not new.skipped and
   (new.scheduled_date is distinct from old.scheduled_date or new.date is distinct from old.date or new.queue_position is distinct from old.queue_position or new.curriculum_goal_id is distinct from old.curriculum_goal_id) then
   raise exception 'Preserved unfinished work cannot be rescheduled implicitly';
  end if;
 end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.guard_preserved_work() from public,anon,authenticated;
drop trigger if exists guard_preserved_work on public.lessons;
create trigger guard_preserved_work before update or delete on public.lessons for each row execute function public.guard_preserved_work();


-- SOURCE: supabase/proposals/preserved_daily_reconcile.sql
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

  -- Completion owns its lesson before its trigger updates the goal. Acquire
  -- both sets without waiting; roll back all row locks if either is busy.
  begin
    select * into v_goal from public.curriculum_goals g
     where g.id = p_goal_id and g.user_id = v_uid for update nowait;
    if not found then
      return jsonb_build_object('status', 'invalid', 'reason', 'not_owner');
    end if;

    -- Once per curriculum per local day.
    if exists (select 1 from rooted_private.daily_reconcile_log l
                where l.curriculum_goal_id = p_goal_id and l.local_day = p_local_day) then
      return jsonb_build_object('status', 'already');
    end if;
    perform 1 from public.lessons l where l.curriculum_goal_id = p_goal_id order by l.id for update nowait;
  exception when lock_not_available then
    return jsonb_build_object('status','stale','reason','busy');
  end;

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


-- SOURCE: supabase/proposals/remaining_completion_locks.sql
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
  -- Preserve the prerequisite migration's completion-in-place contract.
  -- An unslotted curriculum row keeps its parent-owned date, pin and source.
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


DO $postflight$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.lessons'::regclass AND attname='queue_preserved' AND atttypid='boolean'::regtype AND attnotnull) THEN RAISE EXCEPTION 'Missing preservation column'; END IF;
IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='rooted_private.cascade_shift_receipts'::regclass) OR has_table_privilege('authenticated','rooted_private.cascade_shift_receipts','SELECT') OR has_table_privilege('anon','rooted_private.cascade_shift_receipts','SELECT') THEN RAISE EXCEPTION 'Private receipt access mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.lessons'::regclass AND tgname='guard_preserved_work' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Missing preservation guard'; END IF;
END $postflight$;
COMMIT;
