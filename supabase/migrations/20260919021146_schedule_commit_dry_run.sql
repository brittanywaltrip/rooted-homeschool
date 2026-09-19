-- ALREADY APPLIED 2026-09-19 (recorded version 20260919021146). Do not re-run.
--
-- Stage 0e step 2: schedule_commit_dry_run.
--
-- Runs the full V0-V12 validation pipeline the future schedule_commit will run,
-- and reports what it WOULD do. ZERO scheduling write capability: there is no
-- INSERT, UPDATE or DELETE against lessons, curriculum_goals, vacation_blocks,
-- schedule_proposals or schedule_transactions anywhere in this function, and a
-- test asserts that.
--
-- VOLATILE because it takes real locks (advisory for whole-plan actions, then
-- the goal rows FOR UPDATE) so validation is realistic. Volatility is the price
-- of locking; read-only is proven by the absence of write statements and by
-- fingerprints measured around every call.
--
-- It does NOT consume the proposal. Single-use belongs to the real commit.
--
-- Errors are COLLECTED rather than raised on the first failure, because a dry
-- run is diagnostic: a buggy client should learn everything wrong at once.
--
-- V0  shape            V1  idempotency key shape only (claims nothing)
-- V2  locks            V3  sealed proposal loaded and owned
-- V4  not expired / not consumed (and consumption is not simulated)
-- V5  action, scope and flags match the seal
-- V6  canonical hash of submitted placements equals the stored hash
-- V7  state_version recomputed under lock equals the seal's
-- V8  ownership        V9  placement safety
-- V10 subset: every placement is LEGALLY mutable (safety, not policy)
-- V11 authoritative transition preconditions, including the no-holes rule
-- V12 the actor this commit would record

create or replace function public.schedule_commit_dry_run(
  p_preview_id uuid,
  p_action text,
  p_goal_ids uuid[],
  p_placements jsonb,
  p_reset_parent_placements boolean default false,
  p_become_authoritative boolean default false,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_err jsonb := '[]'::jsonb;
  v_prop record;
  v_hash text; v_version text;
  v_count int; v_distinct int; v_nameless int;
  v_movable int; v_pinned int; v_completed int; v_holes int; v_locked int;
begin
  -- V0 ---------------------------------------------------------------------
  if v_uid is null then
    return jsonb_build_object('ok', false, 'errors',
      jsonb_build_array(jsonb_build_object('code','permission_denied','detail','no authenticated caller')));
  end if;
  if p_action is null or p_action not in ('materialize','recalculate','group_move','rebuild','vacation') then
    v_err := v_err || jsonb_build_object('code','bad_request','detail','unknown action');
  end if;
  if p_goal_ids is null or array_length(p_goal_ids,1) is null then
    v_err := v_err || jsonb_build_object('code','bad_request','detail','goal_ids is required');
    return jsonb_build_object('ok', false, 'errors', v_err);
  end if;
  if array_length(p_goal_ids,1) > 200 then
    v_err := v_err || jsonb_build_object('code','bad_request','detail','too many goals');
  end if;

  select count(*), count(distinct (e->>'lesson_id')),
         count(*) filter (where nullif(e->>'lesson_id','') is null)
    into v_count, v_distinct, v_nameless
    from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e;
  if v_count > 5000 then
    v_err := v_err || jsonb_build_object('code','bad_request','detail','too many placements');
  end if;
  if v_nameless > 0 then
    v_err := v_err || jsonb_build_object('code','bad_request','detail','placement missing lesson_id');
  end if;

  -- V1: shape only. Claims nothing.
  if p_idempotency_key is not null and length(p_idempotency_key) not between 8 and 128 then
    v_err := v_err || jsonb_build_object('code','bad_request','detail','idempotency_key shape');
  end if;

  -- V2: real locks, released when the caller's transaction ends.
  if p_action in ('rebuild','vacation') then
    perform pg_advisory_xact_lock(hashtext('rooted:sched:' || v_uid::text));
  end if;
  select count(*) into v_locked
    from (select id from curriculum_goals
           where id = any(p_goal_ids) and user_id = v_uid
           order by id for update) s;

  -- V8
  if v_locked <> array_length(p_goal_ids,1) then
    v_err := v_err || jsonb_build_object('code','permission_denied',
      'detail','one or more goals do not belong to the current user');
    return jsonb_build_object('ok', false, 'errors', v_err);
  end if;

  -- V3 / V4 / V5
  select * into v_prop from schedule_proposals where id = p_preview_id and user_id = v_uid;
  if not found then
    v_err := v_err || jsonb_build_object('code','permission_denied','detail','no such proposal for this user');
    return jsonb_build_object('ok', false, 'errors', v_err);
  end if;
  if v_prop.expires_at <= now() then
    v_err := v_err || jsonb_build_object('code','proposal_expired','detail',v_prop.expires_at::text);
  end if;
  if v_prop.consumed_at is not null then
    v_err := v_err || jsonb_build_object('code','proposal_consumed','detail','already applied');
  end if;
  if v_prop.action <> p_action
     or v_prop.reset_parent_placements <> coalesce(p_reset_parent_placements,false)
     or v_prop.become_authoritative <> coalesce(p_become_authoritative,false)
     or not (v_prop.goal_ids @> p_goal_ids and p_goal_ids @> v_prop.goal_ids) then
    v_err := v_err || jsonb_build_object('code','proposal_mismatch','detail','action, scope or flags differ from the seal');
  end if;

  -- V6: the proposal applied must be the proposal confirmed.
  v_hash := encode(extensions.digest(
    public.schedule_canonicalize_proposal(p_action, p_goal_ids, p_placements,
      coalesce(p_reset_parent_placements,false), coalesce(p_become_authoritative,false)), 'sha256'), 'hex');
  if v_hash <> v_prop.proposal_hash then
    v_err := v_err || jsonb_build_object('code','proposal_mismatch',
      'detail','submitted placements do not match the sealed proposal');
  end if;

  -- V7
  v_version := public.schedule_state_version(p_goal_ids);
  if v_version <> v_prop.state_version then
    v_err := v_err || jsonb_build_object('code','state_changed','detail','scheduler inputs changed since the confirmation');
  end if;

  -- V9: placement safety
  if v_count <> v_distinct and v_nameless = 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_lesson','detail','same lesson_id twice');
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
      left join lessons l on l.id = (e->>'lesson_id')::uuid
     where nullif(e->>'lesson_id','') is not null
       and (l.id is null or l.user_id <> v_uid or l.curriculum_goal_id is null
            or not (l.curriculum_goal_id = any(p_goal_ids)))) then
    v_err := v_err || jsonb_build_object('code','foreign_lesson','detail','placement outside the sealed scope');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
      join lessons l on l.id = (e->>'lesson_id')::uuid where l.completed) then
    v_err := v_err || jsonb_build_object('code','completed_immutable','detail','placement targets a completed lesson');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
      join lessons l on l.id = (e->>'lesson_id')::uuid where coalesce(l.skipped,false)) then
    v_err := v_err || jsonb_build_object('code','skipped_lesson','detail','placement targets a skipped lesson');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
      join lessons l on l.id = (e->>'lesson_id')::uuid
     where (l.notes is not null and btrim(l.notes) <> '') or l.minutes_spent is not null) then
    v_err := v_err || jsonb_build_object('code','parent_work_row','detail','placement targets a row carrying your notes or minutes');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
      join lessons l on l.id = (e->>'lesson_id')::uuid
     where coalesce(l.queue_pinned,false) and not coalesce(p_reset_parent_placements,false)
       and coalesce((e->>'queue_pinned')::boolean, false) = false) then
    v_err := v_err || jsonb_build_object('code','pin_change_not_allowed','detail','a parent placement would be released without reset');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
     where nullif(e->>'scheduled_date','') is not null
       and (  (e->>'scheduled_date') !~ '^\d{4}-\d{2}-\d{2}$'
           or (e->>'scheduled_date')::date < current_date - interval '2 years'
           or (e->>'scheduled_date')::date > current_date + interval '5 years')) then
    v_err := v_err || jsonb_build_object('code','invalid_date','detail','date malformed or out of range');
  end if;
  if exists (select 1 from (
      select l.curriculum_goal_id gid, (e->>'queue_position')::int qp, count(*) n
        from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
        join lessons l on l.id = (e->>'lesson_id')::uuid
       where nullif(e->>'queue_position','') is not null
       group by 1,2 having count(*) > 1) x) then
    v_err := v_err || jsonb_build_object('code','slot_collision','detail','two placements claim one slot');
  end if;

  -- V10: subset. Safety, not scheduling policy. WHICH lessons ought to move is
  -- a TypeScript decision frozen by the seal.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
      join lessons l on l.id = (e->>'lesson_id')::uuid
     where l.curriculum_goal_id = any(p_goal_ids)
       and not (not l.completed and not coalesce(l.skipped,false)
                and (l.notes is null or btrim(l.notes) = '') and l.minutes_spent is null
                and (coalesce(p_reset_parent_placements,false) or not coalesce(l.queue_pinned,false)))) then
    v_err := v_err || jsonb_build_object('code','not_mutable','detail','placement targets a lesson that may not be moved');
  end if;

  -- V11
  if coalesce(p_become_authoritative,false) then
    if p_action not in ('materialize','recalculate','rebuild') then
      v_err := v_err || jsonb_build_object('code','migration_not_permitted','detail','action may not establish authority');
    end if;
    select count(*) into v_holes
      from lessons l
      left join jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
             on (e->>'lesson_id')::uuid = l.id
     where l.curriculum_goal_id = any(p_goal_ids)
       and not l.completed and not coalesce(l.skipped,false)
       and coalesce(nullif(e->>'scheduled_date',''), l.scheduled_date::text) is null;
    if v_holes > 0 then
      v_err := v_err || jsonb_build_object('code','migration_not_permitted',
        'detail', v_holes || ' lesson(s) would have no date');
    end if;
  end if;

  select
    count(*) filter (where not l.completed and not coalesce(l.skipped,false)
                       and (l.notes is null or btrim(l.notes)='') and l.minutes_spent is null
                       and (coalesce(p_reset_parent_placements,false) or not coalesce(l.queue_pinned,false))),
    count(*) filter (where not l.completed and coalesce(l.queue_pinned,false)),
    count(*) filter (where l.completed)
    into v_movable, v_pinned, v_completed
    from lessons l where l.curriculum_goal_id = any(p_goal_ids);

  return jsonb_build_object(
    'ok', jsonb_array_length(v_err) = 0,
    'errors', v_err,
    'would_apply', jsonb_build_object('lessons_moved', v_count, 'goals', array_length(p_goal_ids,1)),
    'would_preserve', jsonb_build_object(
      'parent_placed', case when coalesce(p_reset_parent_placements,false) then 0 else v_pinned end,
      'completed', v_completed,
      'mutable_in_scope', v_movable),
    'would_become_authoritative', coalesce(p_become_authoritative,false),
    'actor', jsonb_build_object('type','parent','user_id', v_uid),   -- V12
    'proposal_consumed', false,
    'dry_run', true);
end;
$$;

revoke all on function public.schedule_commit_dry_run(uuid, text, uuid[], jsonb, boolean, boolean, text) from public, anon;
grant execute on function public.schedule_commit_dry_run(uuid, text, uuid[], jsonb, boolean, boolean, text) to authenticated, service_role;
