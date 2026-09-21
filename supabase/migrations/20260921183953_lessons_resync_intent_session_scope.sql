-- lessons_resync_intent_session_scope: narrow the parent-intent exception to
-- the login session that made it.
--
-- Amends 20260921174221_lessons_resync_parent_intent_window. Staging first.
--
-- WHAT THIS IS, HONESTLY
-- A HEURISTIC EXCEPTION, not identification of parent intent. An old
-- bundle's automatic resync and its parent re-spread send byte-identical
-- requests. This rule lets such a request through when the same login
-- session, within the last 10 minutes, made a write the automatic path never
-- makes (a bare unpin of that goal's lessons, or a curriculum_goals
-- start_at_lesson write). An automatic resync from the same session in that
-- window also passes. A tab and any other tab in the same browser share one
-- session (the auth cookie), so they are indistinguishable here.
--
-- SCOPE, per row in rooted_private.schedule_intent:
--   user     auth.uid() of the signing write      (server-signed JWT)
--   goal     the curriculum_goal_id written       (from the row itself)
--   session  auth.jwt() ->> 'session_id'          (server-signed JWT)
--   kind     'unpin' or 'start_at_lesson'         (recorded, not matched)
-- NOT scoped by operation: the kind is not matched against what follows.
-- NOT consumed: every matching legacy write inside the window passes; a
-- parent re-spread sends several statements per goal, and its undo follows.
-- EXPIRES: 10 minutes after the latest signal for that user, goal and
-- session. The undo toast is 5 seconds; the window also covers a
-- multi-goal re-spread and a backgrounded tab.
-- A request whose JWT has no session_id gets no exception (fails closed).
-- Rows older than a day are pruned by the owner's next signal.

-- Intent rows are 10-minute working state, not evidence. Clear them so the
-- primary key can change.
delete from rooted_private.schedule_intent;
alter table rooted_private.schedule_intent add column if not exists session_id uuid not null;
alter table rooted_private.schedule_intent drop constraint if exists schedule_intent_pkey;
alter table rooted_private.schedule_intent add primary key (user_id, curriculum_goal_id, session_id);

create or replace function rooted_private.note_schedule_intent(p_goal uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_sub  uuid := auth.uid();
  v_sess uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'note_schedule_intent may only run inside a trigger' using errcode = '42501';
  end if;
  if v_sub is null or v_sess is null or p_goal is null then return; end if;
  if not exists (select 1 from public.curriculum_goals g where g.id = p_goal and g.user_id = v_sub) then
    return;
  end if;
  delete from rooted_private.schedule_intent
   where user_id = v_sub and recorded_at < now() - interval '1 day';
  insert into rooted_private.schedule_intent (user_id, curriculum_goal_id, session_id, kind, recorded_at)
  values (v_sub, p_goal, v_sess, p_kind, now())
  on conflict (user_id, curriculum_goal_id, session_id)
  do update set kind = excluded.kind, recorded_at = excluded.recorded_at;
end;
$fn$;
revoke all on function rooted_private.note_schedule_intent(uuid, text) from public, anon;
grant execute on function rooted_private.note_schedule_intent(uuid, text) to authenticated;

create or replace function rooted_private.has_recent_schedule_intent(p_goal uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_sess uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'has_recent_schedule_intent may only run inside a trigger' using errcode = '42501';
  end if;
  if v_sess is null then return false; end if;
  return exists (
    select 1 from rooted_private.schedule_intent i
     where i.user_id = auth.uid()
       and i.curriculum_goal_id = p_goal
       and i.session_id = v_sess
       and i.recorded_at > now() - interval '10 minutes'
  );
end;
$fn$;
revoke all on function rooted_private.has_recent_schedule_intent(uuid) from public, anon;
grant execute on function rooted_private.has_recent_schedule_intent(uuid) to authenticated;
