-- The production triggers a Builder settings write can fire, as they are live
-- before 20261005000000 (orphan cleanup md5 1f0dc993d0b17dea8d9aa086cb449128,
-- read from production and rooted-staging on 2026-10-05). Load after stub.sql
-- and BEFORE the migrations, so a migration that replaces one is tested the
-- way it will be applied.
create function public.enforce_curriculum_school_days_nonempty() returns trigger language plpgsql as $$
begin
  if new.school_days is null or cardinality(new.school_days) = 0 then new.school_days := array['Mon','Tue','Wed','Thu','Fri']; end if;
  return new;
end $$;
create trigger curriculum_goals_school_days_guard before insert or update on public.curriculum_goals
  for each row execute function public.enforce_curriculum_school_days_nonempty();
create or replace function public.curriculum_goals_cleanup_orphans_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
DECLARE
  v_skip text;
BEGIN
  v_skip := current_setting('rooted.skip_orphan_cleanup', true);
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_lesson > OLD.current_lesson THEN
    PERFORM set_config('rooted.skip_orphan_cleanup', 'true', true);

    -- UNSCHEDULE orphans. Do not complete them, do not re-date them.
    UPDATE public.lessons
      SET scheduled_date = NULL
      WHERE curriculum_goal_id = NEW.id
        AND completed = false
        AND scheduled_date IS NOT NULL
        AND queue_pinned = false
        AND lesson_number IS NOT NULL
        AND lesson_number <= NEW.current_lesson
        AND (notes IS NULL OR notes = '');
  END IF;

  RETURN NEW;
END;
$function$;
create trigger trg_curriculum_goals_cleanup_orphans after update of current_lesson on public.curriculum_goals
  for each row when (new.current_lesson is distinct from old.current_lesson) execute function public.curriculum_goals_cleanup_orphans_trg();
