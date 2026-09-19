-- ============================================================================
-- schedule_state_version: hash the parent's words too.
-- ============================================================================
-- The lesson digest already covered notes, minutes_spent, dates, placement and
-- completion. It did NOT cover `title` or `hours`.
--
-- Why that matters: the builder replaces a pending row by deleting it and
-- inserting a new one with a fresh id. A parent who renames a lesson, or logs
-- hours against it, while the builder is open would have that edit deleted and
-- replaced by a generated title -- and because the digest ignored those
-- columns, the proposal did not go stale and nothing refused.
--
-- Adding them makes such an edit invalidate the proposal, so the save refuses
-- on the already-tested stale path and the parent re-plans against current
-- state. That is the same treatment notes and minutes_spent already get.
--
-- Cost, stated plainly: proposals become more fragile. Any title or hours edit
-- on any lesson under the proposal's goals invalidates it. Proposals expire in
-- 15 minutes anyway, and a refused save loses nothing, whereas a silently
-- discarded rename loses a parent's words.
--
-- This redefinition changes every state version, so proposals sealed before it
-- will not match after it. They expire in 15 minutes; no migration of
-- in-flight proposals is needed or attempted.
-- ============================================================================

create or replace function public.schedule_state_version(p_goal_ids uuid[])
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
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
    select 1 from curriculum_goals g
     where g.id = any(p_goal_ids) and g.user_id is distinct from v_owner
  ) then
    raise exception 'permission denied: goals do not belong to the current user'
      using errcode = '42501';
  end if;

  if (select count(*) from curriculum_goals g where g.id = any(p_goal_ids))
     <> coalesce(array_length(p_goal_ids, 1), 0) then
    raise exception 'permission denied: goals do not belong to the current user'
      using errcode = '42501';
  end if;

  select coalesce(md5(string_agg(sig, E'\n' order by sig)), '~') into v_goals
    from (
      select g.id::text || '|' || coalesce(g.current_lesson::text, '~')
          || '|' || coalesce(g.total_lessons::text, '~')
          || '|' || coalesce(g.lessons_per_day::text, '~')
          || '|' || coalesce(array_to_string(g.school_days, ','), '~')
          || '|' || coalesce(g.start_date::text, '~')
          || '|' || coalesce(g.target_date::text, '~')
          || '|' || coalesce(g.archived::text, '~') as sig
        from curriculum_goals g where g.id = any(p_goal_ids)
    ) s;

  select coalesce(md5(string_agg(sig, E'\n' order by sig)), '~') into v_lessons
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
          || '|' || coalesce(l.scheduled_source, '~')
          -- Added: the parent's own words and logged hours.
          || '|' || coalesce(nullif(btrim(l.title), ''), '~')
          || '|' || coalesce(l.hours::text, '~') as sig
        from lessons l where l.curriculum_goal_id = any(p_goal_ids)
    ) s;

  select coalesce(md5(string_agg(sig, E'\n' order by sig)), '~') into v_vacations
    from (
      select v.id::text || '|' || v.start_date::text || '|' || v.end_date::text as sig
        from vacation_blocks v where v.user_id = v_owner
    ) s;

  return md5(v_goals || '|' || v_lessons || '|' || v_vacations);
end;
$$;

revoke all on function public.schedule_state_version(uuid[]) from public, anon;
grant execute on function public.schedule_state_version(uuid[]) to authenticated, service_role;
