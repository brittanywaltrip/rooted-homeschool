-- Safe operational pause, NOT an automatic action. Requires separate approval.
-- Both overloads refuse fresh rebuilds. Ownership checks and committed replay
-- remain available. No data/log deletion, schema removal or cleanup changes.
-- Resume by reapplying the approved goal-guard migration, not the unsafe restore.

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

  -- 1. Ownership, then hold the curriculum and its lessons still.
  select * into v_goal from public.curriculum_goals g
   where g.id = p_goal_id and g.user_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('status', 'invalid', 'reason', 'not_owner');
  end if;
  perform 1 from public.lessons l where l.curriculum_goal_id = p_goal_id for update;

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

  -- A pause refuses every fresh rebuild; replay above remains available.
  return jsonb_build_object('status', 'refused', 'reason', 'builder_paused');
end;
$fn$;
revoke all on function public.apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb) to authenticated;
