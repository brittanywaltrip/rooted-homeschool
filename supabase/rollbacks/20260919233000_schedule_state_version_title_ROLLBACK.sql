-- Restores schedule_state_version to the digest WITHOUT title and hours, by
-- re-applying the previous definition verbatim rather than describing it.
--
-- The earlier version of this file was a comment saying "re-apply the other
-- migration" and nothing else, so the rollback set did not reproduce the prior
-- state. It does now.
--
-- WHAT THIS RE-OPENS, stated so it is a decision and not a surprise: a parent
-- who renames a lesson or logs hours while the builder is open will have that
-- edit deleted and replaced by a generated title, with nothing detected.

create or replace function public.schedule_state_version(p_goal_ids uuid[])
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid; v_goals text; v_lessons text; v_vacations text;
begin
  if p_goal_ids is null or array_length(p_goal_ids, 1) is null then
    return md5('');
  end if;

  select g.user_id into v_owner
    from curriculum_goals g where g.id = any(p_goal_ids) limit 1;

  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'permission denied: goals do not belong to the current user'
      using errcode = '42501';
  end if;

  -- Every goal must belong to the caller, not just the first one.
  if exists (
    select 1 from curriculum_goals
     where id = any(p_goal_ids) and user_id is distinct from auth.uid()
  ) then
    raise exception 'permission denied: goals do not belong to the current user'
      using errcode = '42501';
  end if;

  select coalesce(md5(string_agg(sig, e'\n' order by sig)), '') into v_goals
  from (
    select g.id::text || '|' || coalesce(g.archived::text, '~')
        || '|' || coalesce(g.total_lessons::text, '~')
        || '|' || coalesce(g.current_lesson::text, '~')
        || '|' || coalesce(g.start_at_lesson::text, '~')
        || '|' || coalesce(g.lessons_per_day::text, '~')
        || '|' || coalesce(g.lessons_per_day_overrides::text, '~')
        || '|' || coalesce(array_to_string(g.school_days, ','), '~')
        || '|' || coalesce(g.start_date::text, '~')
        || '|' || coalesce(g.target_date::text, '~')
        || '|' || g.placement_mode::text as sig
      from curriculum_goals g where g.id = any(p_goal_ids)
  ) s;

  select coalesce(md5(string_agg(sig, e'\n' order by sig)), '') into v_lessons
  from (
    select l.id::text || '|' || coalesce(l.lesson_number::text, '~')
        || '|' || coalesce(l.queue_position::text, '~')
        || '|' || coalesce(l.queue_pinned::text, '~')
        || '|' || coalesce(l.skipped::text, '~')
        || '|' || coalesce(l.completed::text, '~')
        || '|' || coalesce(l.completed_at::text, '~')
        || '|' || coalesce(l.scheduled_date::text, '~')
        || '|' || coalesce(l.date::text, '~')
        || '|' || coalesce(nullif(btrim(l.notes), ''), '~')
        || '|' || coalesce(l.minutes_spent::text, '~')
        || '|' || coalesce(l.scheduled_source, '~') as sig
      from lessons l where l.curriculum_goal_id = any(p_goal_ids)
  ) s;

  -- Vacations are user-level and reshape every goal's projection, so the whole
  -- set belongs in the version even though it is not per goal.
  select coalesce(md5(string_agg(sig, e'\n' order by sig)), '') into v_vacations
  from (
    select v.id::text || '|' || v.start_date::text || '|' || v.end_date::text as sig
      from vacation_blocks v where v.user_id = v_owner
  ) s;

  return md5(v_goals || '|' || v_lessons || '|' || v_vacations);
end;
$$;

revoke all on function public.schedule_state_version(uuid[]) from public, anon;
grant execute on function public.schedule_state_version(uuid[]) to authenticated, service_role;
