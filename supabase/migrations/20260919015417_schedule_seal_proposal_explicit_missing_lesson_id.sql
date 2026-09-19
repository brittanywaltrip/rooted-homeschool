-- ALREADY APPLIED 2026-09-19 (recorded version 20260919015417). Do not re-run.
--
-- Fix: a placement with no lesson_id was reported as "duplicate lesson_id in
-- placements", because count(distinct e->>'lesson_id') ignores NULLs and so
-- disagreed with count(*). A misleading error in an authorization-relevant
-- function earns its own check.
--
-- This file carries the CURRENT body of schedule_seal_proposal. It validates
-- ownership and safety, canonicalizes, hashes with SHA-256, computes the
-- confirmation facts SERVER SIDE from the sealed placements, and stores the
-- seal. It writes exactly one row, to schedule_proposals, and consumes nothing.

create or replace function public.schedule_seal_proposal(
  p_action text, p_goal_ids uuid[], p_placements jsonb,
  p_reset_parent_placements boolean default false,
  p_become_authoritative boolean default false
) returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_canonical text; v_hash text; v_version text; v_facts jsonb;
  v_count int; v_distinct int; v_id uuid; v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'permission denied: no authenticated caller' using errcode = '42501';
  end if;

  if p_action not in ('materialize','recalculate','group_move','rebuild','vacation') then
    raise exception 'unknown action: %', p_action using errcode = '22023';
  end if;

  if p_goal_ids is null or array_length(p_goal_ids,1) is null then
    raise exception 'goal_ids is required' using errcode = '22023';
  end if;

  if (select count(*) from curriculum_goals
       where id = any(p_goal_ids) and user_id = v_uid) <> array_length(p_goal_ids,1) then
    raise exception 'permission denied: goals do not belong to the current user'
      using errcode = '42501';
  end if;

  -- Every placement must name a lesson. Checked before the duplicate test so a
  -- missing id reports itself rather than surfacing as a duplicate.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
     where nullif(e->>'lesson_id','') is null
  ) then
    raise exception 'placement is missing lesson_id' using errcode = '22023';
  end if;

  select count(*), count(distinct (e->>'lesson_id'))
    into v_count, v_distinct
    from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e;

  if v_count <> v_distinct then
    raise exception 'duplicate lesson_id in placements' using errcode = '22023';
  end if;
  if v_count > 5000 then
    raise exception 'too many placements: %', v_count using errcode = '22023';
  end if;

  -- Safety subset: every sealed lesson must belong to a goal in scope. This is
  -- an invariant, not scheduling policy. WHICH lessons ought to move stays a
  -- TypeScript decision; SQL only decides what is legally mutable.
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
      left join lessons l on l.id = (e->>'lesson_id')::uuid
     where l.id is null or l.user_id <> v_uid
        or l.curriculum_goal_id is null
        or not (l.curriculum_goal_id = any(p_goal_ids))
  ) then
    raise exception 'placement references a lesson outside the sealed scope'
      using errcode = '42501';
  end if;

  -- Completed lessons may never be proposed for a move (Invariant 3).
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
      join lessons l on l.id = (e->>'lesson_id')::uuid
     where l.completed
  ) then
    raise exception 'placement references a completed lesson' using errcode = '22023';
  end if;

  v_canonical := public.schedule_canonicalize_proposal(
    p_action, p_goal_ids, p_placements,
    coalesce(p_reset_parent_placements,false), coalesce(p_become_authoritative,false));
  v_hash := encode(extensions.digest(v_canonical, 'sha256'), 'hex');
  v_version := public.schedule_state_version(p_goal_ids);

  -- Confirmation facts, computed here and never accepted from the client.
  -- FROM/TO come from the SEALED placements, so the text Mom reads is bound to
  -- the exact proposal that was hashed.
  with sealed as (
    select (e->>'lesson_id')::uuid as lesson_id,
           nullif(e->>'scheduled_date','')::date as scheduled_date
      from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) e
  ),
  per_goal as (
    select g.id as goal_id, g.curriculum_name as name,
           count(s.lesson_id) as lessons_moving,
           min(s.scheduled_date) as from_date,
           max(s.scheduled_date) as to_date
      from curriculum_goals g
      left join lessons l on l.curriculum_goal_id = g.id
      left join sealed s on s.lesson_id = l.id
     where g.id = any(p_goal_ids)
     group by g.id, g.curriculum_name
  ),
  preserved as (
    select
      count(*) filter (where not l.completed and coalesce(l.queue_pinned,false)
                         and l.id not in (select lesson_id from sealed)) as parent_placed,
      count(*) filter (where l.completed) as completed,
      count(*) filter (where not l.completed
                         and ((l.notes is not null and btrim(l.notes) <> '')
                              or l.minutes_spent is not null)
                         and l.id not in (select lesson_id from sealed)) as with_notes,
      count(*) filter (where not l.completed and coalesce(l.skipped,false)) as skipped
      from lessons l where l.curriculum_goal_id = any(p_goal_ids)
  )
  select jsonb_build_object(
      'goals', coalesce((select jsonb_agg(jsonb_build_object(
                  'goal_id', goal_id, 'name', name, 'lessons_moving', lessons_moving,
                  'from', from_date, 'to', to_date) order by name) from per_goal), '[]'::jsonb),
      'total_lessons_moving', v_count,
      'preserved', (select jsonb_build_object(
                      'parent_placed_lessons', parent_placed,
                      'completed_lessons', completed,
                      'lessons_with_your_notes', with_notes,
                      'skipped_lessons', skipped) from preserved),
      'reset_parent_placements', coalesce(p_reset_parent_placements,false),
      'become_authoritative', coalesce(p_become_authoritative,false))
    into v_facts;

  v_expires := now() + interval '15 minutes';

  insert into public.schedule_proposals(
    user_id, action, goal_ids, proposal_hash, canonical_form, state_version,
    confirmation_facts, placement_count, reset_parent_placements,
    become_authoritative, expires_at)
  values (v_uid, p_action, p_goal_ids, v_hash, v_canonical, v_version,
          v_facts, v_count, coalesce(p_reset_parent_placements,false),
          coalesce(p_become_authoritative,false), v_expires)
  returning id into v_id;

  return jsonb_build_object(
    'preview_id', v_id, 'proposal_hash', v_hash, 'state_version', v_version,
    'confirmation_facts', v_facts, 'placement_count', v_count, 'expires_at', v_expires);
end;
$$;

revoke all on function public.schedule_seal_proposal(text, uuid[], jsonb, boolean, boolean) from public, anon;
grant execute on function public.schedule_seal_proposal(text, uuid[], jsonb, boolean, boolean) to authenticated, service_role;
