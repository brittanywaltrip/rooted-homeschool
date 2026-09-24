-- Loaded after ../builder-rebuild/stub.sql. Replaces its trimmed pointer
-- trigger with production's (which also recomputes when a COMPLETED row's
-- queue_position changes, the case restore_queue_book_order exercises) and
-- adds production's orphan cleanup, so the skip flag is tested for real.
create or replace function public.lessons_recompute_current_lesson_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.completed = true and old.queue_position is not null then perform public.recompute_curriculum_current_lesson(old.curriculum_goal_id); end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.completed = true and new.curriculum_goal_id is not null then perform public.recompute_curriculum_current_lesson(new.curriculum_goal_id); end if;
    return new;
  end if;
  if old.curriculum_goal_id is distinct from new.curriculum_goal_id then
    if old.curriculum_goal_id is not null then perform public.recompute_curriculum_current_lesson(old.curriculum_goal_id); end if;
    if new.curriculum_goal_id is not null then perform public.recompute_curriculum_current_lesson(new.curriculum_goal_id); end if;
    return new;
  end if;
  if old.completed is distinct from new.completed then
    perform public.recompute_curriculum_current_lesson(new.curriculum_goal_id);
    return new;
  end if;
  if new.completed = true and old.queue_position is distinct from new.queue_position then
    perform public.recompute_curriculum_current_lesson(new.curriculum_goal_id);
    return new;
  end if;
  return new;
end $$;

create function public.curriculum_goals_cleanup_orphans_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_skip text;
begin
  v_skip := current_setting('rooted.skip_orphan_cleanup', true);
  if v_skip = 'true' then return new; end if;
  if new.current_lesson > old.current_lesson then
    perform set_config('rooted.skip_orphan_cleanup', 'true', true);
    update public.lessons set scheduled_date = null
     where curriculum_goal_id = new.id and completed = false and scheduled_date is not null
       and queue_pinned = false and lesson_number is not null and lesson_number <= new.current_lesson
       and (notes is null or notes = '');
  end if;
  return new;
end $$;
create trigger trg_curriculum_goals_cleanup_orphans after update of current_lesson on public.curriculum_goals
  for each row when (new.current_lesson is distinct from old.current_lesson)
  execute function public.curriculum_goals_cleanup_orphans_trg();
