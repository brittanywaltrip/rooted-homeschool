-- ALREADY APPLIED 2026-09-19 (recorded version 20260919013822). Do not re-run.
--
-- Fix: schedule_state_version used min(user_id) on a uuid column, which has no
-- aggregate in Postgres, so every call raised 42883. The owner is now resolved
-- with a plain SELECT ... LIMIT 1; the authorisation checks are unchanged.
--
-- INVARIANT: if anything changes that could make a confirmed impact different,
-- this value must change. Covers every input the projector and the phase-2
-- planners consume. Deliberately EXCLUDES curriculum_name, icon_emoji,
-- subject_label, default_minutes, scheduled_start_time, course_level,
-- credits_value, lessons.title and every profiles column, because none of them
-- can change which lessons move or where they land. A rename must not
-- invalidate a confirmation. Proven by a rolled-back transaction covering all
-- 11 meaningful inputs and 3 cosmetic ones.

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
