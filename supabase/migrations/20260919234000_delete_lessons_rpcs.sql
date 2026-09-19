-- ============================================================================
-- The remaining legitimate delete shapes, as owner-checked functions.
-- ============================================================================
-- Removing DELETE from `authenticated` breaks every direct client delete, so
-- each legitimate one needs an entry point. There are three shapes in the app:
--
--   one row by id            -> delete_lesson()       (earlier migration)
--   several rows by id       -> delete_lessons()      (here)
--   a whole school year      -> delete_year_lessons() (here)
--
-- Each re-establishes ownership in its own body, because SECURITY DEFINER
-- bypasses RLS and the policy that would have covered the statement no longer
-- applies. Each also refuses an unplanned cascade: lessons.continues_lesson_id
-- references lessons ON DELETE CASCADE, so deleting a row can take others with
-- it, and a caller that did not ask for that should not get it silently.
-- ============================================================================

create or replace function public.delete_lessons(p_lesson_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_bad int; v_deleted int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_lesson_ids is null or array_length(p_lesson_ids, 1) is null then
    return 0;
  end if;
  if array_length(p_lesson_ids, 1) > 1000 then
    raise exception 'refusing to delete more than 1000 lessons in one call'
      using errcode = '22023';
  end if;

  -- Ownership, re-established. A row that is absent and a row that is somebody
  -- else's give the same answer, so this cannot be used to probe.
  select count(*) into v_bad from unnest(p_lesson_ids) t(id)
   where not exists (select 1 from public.lessons l
                      where l.id = t.id and l.user_id = v_uid);
  if v_bad > 0 then
    raise exception '% lesson(s) were not found', v_bad using errcode = '42501';
  end if;

  -- Unplanned cascade.
  select count(*) into v_bad from public.lessons c
   where c.continues_lesson_id = any(p_lesson_ids)
     and not (c.id = any(p_lesson_ids));
  if v_bad > 0 then
    raise exception
      '% continuation row(s) would be deleted as well but were not asked for', v_bad
      using errcode = '40001';
  end if;

  delete from public.lessons where id = any(p_lesson_ids) and user_id = v_uid;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_lessons(uuid[]) from public, anon;
grant execute on function public.delete_lessons(uuid[]) to authenticated, service_role;

-- "Add a past year" undoes itself by removing the year it just created. Its
-- predicate is user + school_year, not a list of ids, so it gets its own
-- entry point rather than being made to fetch thousands of ids first.
create or replace function public.delete_year_lessons(p_school_year_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_deleted int; v_bad int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_school_year_id is null then
    raise exception 'delete_year_lessons requires a school year id' using errcode = '22023';
  end if;
  if not exists (select 1 from public.school_years y
                  where y.id = p_school_year_id and y.user_id = v_uid) then
    raise exception 'school year not found' using errcode = '42501';
  end if;

  -- CASCADE, predicate-complete. The set being deleted is (this user, this
  -- year). A continuation row OUTSIDE that set -- in another year, or another
  -- goal -- that continues from a row inside it would be taken by the cascade
  -- without appearing in the row count. Deleting one year must not reach into
  -- another.
  select count(*) into v_bad
    from public.lessons c
   where c.continues_lesson_id in (
           select l.id from public.lessons l
            where l.user_id = v_uid and l.school_year_id = p_school_year_id)
     and not (c.user_id = v_uid and c.school_year_id is not distinct from p_school_year_id);
  if v_bad > 0 then
    raise exception
      '% lesson(s) outside this school year continue from one inside it and would be deleted with it', v_bad
      using errcode = '40001';
  end if;

  -- Scoped to the caller AND the year. Both, not either.
  delete from public.lessons
   where user_id = v_uid and school_year_id = p_school_year_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_year_lessons(uuid) from public, anon;
grant execute on function public.delete_year_lessons(uuid) to authenticated, service_role;

-- "Stop this curriculum" clears the pending rows for one goal and keeps every
-- completed one (Invariant 3). Its predicate is the goal, not a list of ids,
-- so it gets its own entry point rather than making the client fetch ids.
create or replace function public.delete_goal_pending_lessons(p_goal_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_deleted int; v_bad int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.curriculum_goals g
                  where g.id = p_goal_id and g.user_id = v_uid) then
    raise exception 'curriculum not found' using errcode = '42501';
  end if;

  -- CASCADE, predicate-complete. The earlier version only looked for COMPLETED
  -- continuations, which left a PENDING continuation in another goal free to be
  -- cascaded away unnoticed. The set being deleted is (this goal, not
  -- completed); anything outside that set which continues from inside it is a
  -- row this call was not asked to touch, whatever its own state.
  select count(*) into v_bad
    from public.lessons c
   where c.continues_lesson_id in (
           select l.id from public.lessons l
            where l.curriculum_goal_id = p_goal_id and l.completed = false)
     and not (c.curriculum_goal_id is not distinct from p_goal_id and c.completed = false);
  if v_bad > 0 then
    raise exception
      '% lesson(s) outside this curriculum''s pending rows continue from one inside it and would be deleted with it', v_bad
      using errcode = '40001';
  end if;

  delete from public.lessons
   where curriculum_goal_id = p_goal_id and user_id = v_uid and completed = false;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_goal_pending_lessons(uuid) from public, anon;
grant execute on function public.delete_goal_pending_lessons(uuid) to authenticated, service_role;
