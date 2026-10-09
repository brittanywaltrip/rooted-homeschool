-- Preserve all forms of recorded unfinished work during pointer cleanup.
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.curriculum_goals_cleanup_orphans_trg()'::regprocedure) IS DISTINCT FROM '3fc51969d09a433b1f375182dfa4bf06' THEN RAISE EXCEPTION 'Cleanup baseline drift';END IF;END $$;
-- LOCAL REVIEW DRAFT. Prevent pointer cleanup and unaware writers from erasing
-- explicitly preserved earlier unfinished work. No existing data updates.
CREATE OR REPLACE FUNCTION public.curriculum_goals_cleanup_orphans_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skip text;
BEGIN
  -- Re-entry guard, kept from 20260519180000. It blocks re-entry into THIS
  -- function only. That was never sufficient on its own (see the header of
  -- 20260824000000), but the statement below no longer flips `completed`, so
  -- lessons_recompute_current_lesson_trg is not fired by it and there is no
  -- second path back into this function to guard against.
  v_skip := current_setting('rooted.skip_orphan_cleanup', true);
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_lesson > OLD.current_lesson THEN
    PERFORM set_config('rooted.skip_orphan_cleanup', 'true', true);

    -- UNSCHEDULE orphans. Do not complete them, do not re-date them.
    --
    -- An orphan is an incomplete row that the queue pointer has moved past.
    -- The harm it does is holding a calendar day the live queue has already
    -- given to a lesson ahead of it, so releasing the day is the entire fix.
    -- Whether the family ever did that lesson is not something this trigger
    -- can know, and it must not guess: every row it guessed about is in the
    -- 289 this migration exists to stop.
    UPDATE public.lessons
      SET scheduled_date = NULL
      WHERE curriculum_goal_id = NEW.id
        AND completed = false
        AND scheduled_date IS NOT NULL
        -- Preserve PR146's placement rule for lessons outside the queue.
        AND queue_position IS NOT NULL
        AND queue_pinned = false
        AND queue_preserved = false
        AND lesson_number IS NOT NULL
        AND lesson_number <= NEW.current_lesson
        AND (notes IS NULL OR notes = '')
        AND coalesce(minutes_spent,0)=0
        AND coalesce(hours,0)=0
        AND started_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Standing rule: re-assert grants whenever a SECURITY DEFINER function is
-- recreated. CREATE OR REPLACE preserves them, but stating them keeps a fresh
-- environment identical to production and stops a future DROP + CREATE from
-- silently widening access. Trigger function; never called over /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM anon;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() TO service_role;

-- Explicit parent operations retain the marker while changing only their
-- validated selection. Legacy and automatic writers retain the old refusal.
CREATE OR REPLACE FUNCTION public.guard_preserved_work() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c rooted_private.scheduler_capabilities%rowtype;permitted boolean:=false;changed text[];
BEGIN
 IF OLD.queue_preserved AND NOT OLD.completed AND NOT OLD.skipped THEN
  IF TG_OP='DELETE' OR (NEW.queue_preserved AND NOT NEW.completed AND NOT NEW.skipped AND
   (NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date OR NEW.date IS DISTINCT FROM OLD.date OR NEW.queue_position IS DISTINCT FROM OLD.queue_position OR NEW.curriculum_goal_id IS DISTINCT FROM OLD.curriculum_goal_id)) THEN
   SELECT * INTO c FROM rooted_private.scheduler_capabilities WHERE tx=txid_current() AND goal_id=OLD.curriculum_goal_id AND owner_id=auth.uid() AND owner_id=OLD.user_id;
   IF FOUND THEN
    IF TG_OP='DELETE' THEN permitted:=c.operation IN ('delete_selected','goal_stop','goal_delete','undo') AND OLD.id=ANY(c.delete_ids);
    ELSE
     SELECT coalesce(array_agg(k),'{}') INTO changed FROM unnest(ARRAY['date','scheduled_date','queue_position','curriculum_goal_id']) k WHERE to_jsonb(OLD)->k IS DISTINCT FROM to_jsonb(NEW)->k;
     permitted:=OLD.id=ANY(c.row_ids) AND changed<@c.lesson_fields AND (
      (c.operation IN ('edit','place_selected','single_move') AND OLD.id=ANY(c.explicit_ids)) OR
      (c.operation='single_move' AND to_jsonb(OLD)-ARRAY['queue_position','updated_at'] IS NOT DISTINCT FROM to_jsonb(NEW)-ARRAY['queue_position','updated_at']) OR
      c.operation IN ('calendar','undo','goal_stop','goal_delete','reassign','reassign_undo') OR
      (c.operation='recalibration' AND OLD.id=ANY(c.explicit_ids)) OR
      (c.operation='recalibration' AND to_jsonb(OLD)-ARRAY['queue_position','updated_at'] IS NOT DISTINCT FROM to_jsonb(NEW)-ARRAY['queue_position','updated_at'])
     );
    END IF;
   END IF;
   IF NOT permitted AND (TG_OP<>'DELETE' OR EXISTS(SELECT 1 FROM public.curriculum_goals WHERE id=OLD.curriculum_goal_id)) THEN RAISE EXCEPTION 'Preserved unfinished work requires a confirmed explicit change';END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_preserved_work() FROM PUBLIC,anon,authenticated,service_role;
