-- Rollback for 20260921210815_lessons_resync_intent_session_scope.
--
-- Returns intent to per-user, per-goal scope (20260921210801): any session of
-- the same family, on any device, inside the window, gets the exception
-- again. That widens the heuristic; use only if session scoping misbehaves
-- (for example, a client whose JWT lacks session_id). To remove intent
-- tracking entirely, use the 20260921210801 rollback instead.

begin;
delete from rooted_private.schedule_intent;
alter table rooted_private.schedule_intent drop constraint if exists schedule_intent_pkey;
alter table rooted_private.schedule_intent drop column if exists session_id;
alter table rooted_private.schedule_intent add primary key (user_id, curriculum_goal_id);

create or replace function rooted_private.note_schedule_intent(p_goal uuid, p_kind text)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $fn$
declare v_sub uuid := auth.uid();
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'note_schedule_intent may only run inside a trigger' using errcode = '42501';
  end if;
  if v_sub is null or p_goal is null then return; end if;
  if not exists (select 1 from public.curriculum_goals g where g.id = p_goal and g.user_id = v_sub) then return; end if;
  insert into rooted_private.schedule_intent (user_id, curriculum_goal_id, kind, recorded_at)
  values (v_sub, p_goal, p_kind, now())
  on conflict (user_id, curriculum_goal_id) do update set kind = excluded.kind, recorded_at = excluded.recorded_at;
end; $fn$;

create or replace function rooted_private.has_recent_schedule_intent(p_goal uuid)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $fn$
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'has_recent_schedule_intent may only run inside a trigger' using errcode = '42501';
  end if;
  return exists (select 1 from rooted_private.schedule_intent i
    where i.user_id = auth.uid() and i.curriculum_goal_id = p_goal and i.recorded_at > now() - interval '10 minutes');
end; $fn$;
commit;
