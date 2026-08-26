-- ALREADY APPLIED TO PRODUCTION 2026-08-24 (via Supabase MCP apply_migration).
-- This file exists so the repo's migration history matches the live database.
-- Do NOT re-run it.
--
-- Live version stamp is `20260824203947` (`orphan_cleanup_preserve_queue_position`
-- in supabase_migrations.schema_migrations). The MCP records its own apply-time
-- timestamp, so it does not match this filename — the same drift every
-- MCP-applied file in this directory carries. Match them on the name, not the
-- number.
--
-- Verified live with pg_get_functiondef after applying: the CASE expression is
-- in the running function, `scheduled_date = NULL` is still there (Invariant 13),
-- and the rooted.skip_orphan_cleanup re-entry guard is unchanged.
--
-- This is a PREVENTIVE fix. It stops new stranded slots being made; it heals
-- nothing that already exists. The 860 completed rows that hold a lesson_number
-- with a NULL slot were still there immediately after the apply, as expected.
-- scripts/repair-queue-gaps.ts is the repair for the rows already damaged.
--
-- THE BUG (Sentry ROOTED-HOMESCHOOL-R and -13): the orphan cleanup lowers
-- current_lesson, so the Today projector emits a queue slot that no row
-- occupies and the family sees a blank subject.
--
-- The cleanup is supposed to be a SIDE EFFECT of a current_lesson advance. It
-- moves current_lesson itself, backwards, and that is the whole bug.
--
-- HOW, exactly. Two triggers form the loop:
--
--   trg_curriculum_goals_cleanup_orphans  (this function)
--     AFTER UPDATE OF current_lesson, when NEW > OLD:
--     completes every incomplete row at or below the new pointer and NULLS its
--     queue_position.
--
--   trg_lessons_recompute_current_lesson  (20260519120000)
--     AFTER UPDATE ON lessons, when completed flipped:
--     runs recompute_curriculum_current_lesson, which sets
--     current_lesson = MAX(queue_position) over COMPLETED rows.
--
-- The cleanup's own UPDATE flips `completed`, so it fires the recompute — and
-- the row it just stripped is invisible to MAX(queue_position) because it
-- stripped it. current_lesson lands BELOW the value that triggered the cleanup.
--
-- The re-entry guard does not stop this. `rooted.skip_orphan_cleanup` blocks
-- re-entry into THIS function; it does nothing to the lessons trigger, which is
-- a different function and runs normally.
--
-- The premise in 20260519180000's own comment is what is wrong:
--
--   "queue_position = NULL on cleaned rows leaves MAX(queue_position)
--    unchanged, so recompute writes the same current_lesson"
--
-- It leaves MAX unchanged only when some OTHER completed row already holds a
-- slot at or above the cleaned rows'. In the common case it is exactly the row
-- AT the new pointer that gets swept — current_lesson advanced onto it — so the
-- row that would have carried MAX up to the new value is the row being erased.
-- MAX comes back strictly lower and the pointer moves backward.
--
-- VERIFIED IN PRODUCTION, goal 24f53fcf ("Explode the Code", start_at_lesson 45,
-- total 78), 2026-08-20 23:04:50 UTC:
--
--   before        current_lesson 44; row 45 incomplete, queue_position 45,
--                 scheduled_source 'queue_resync', created 2026-07-22.
--   23:04:50.410  Today's "Did you finish Lesson 44?" prompt is answered Yes.
--                 confirmPriorLessonComplete INSERTs row 44 (completed,
--                 queue_position 44, is_backfill, wizard_create).
--   23:04:50.4xx  it then writes current_lesson = 45 directly. Its code comment
--                 says it deliberately does NOT call recomputeCurrentLesson,
--                 because that formula would clamp the advance straight back.
--                 The author was right about the formula and did not know this
--                 trigger would call it for them.
--   23:04:50.724  NEW(45) > OLD(44): this function sweeps row 45. It is
--                 incomplete, lesson_number 45 <= 45, no notes.
--                 completed_at = 2026-08-19 23:04:50.724513,
--                 updated_at    = 2026-08-20 23:04:50.724513 — exactly one day
--                 apart to the microsecond, this function's fingerprint.
--                 queue_position = NULL.
--   same stmt     the lessons trigger fires on that completed flip. Row 45's
--                 slot is already NULL, so MAX(queue_position) over completed
--                 rows = 44 (row 44 alone).
--                 UPDATE curriculum_goals SET current_lesson = 44.  <- REVERT
--   commit        current_lesson 44. Row 45: completed, queue_position NULL,
--                 lesson_number 45 intact, scheduled_source 'queue_resync'
--                 untouched (this function never writes that column).
--
-- The projector then emits slot current_lesson + 1 = 45, Today hydrates by
-- (curriculum_goal_id, queue_position = 45), finds nothing, and renders a blank
-- subject. The family's next lesson was consumed AND hidden by one tap.
--
-- It ratchets. Goal 85fa7f24 ("Easy Peasy Music") shows rows 3, 4, 5 and 6
-- stripped inside a 47-second window on 2026-08-24: three holes in one goal.
-- Across production this shape accounts for 52 unoccupied slots on 41 goals
-- (see scripts/repair-queue-gaps.ts, which repairs the rows already damaged;
-- this migration stops new ones being made).
--
-- THE FIX: keep the slot when the row belongs at or below the new pointer.
--
--   queue_position = CASE WHEN queue_position <= NEW.current_lesson
--                         THEN queue_position ELSE NULL END
--
-- A swept row is a completed lesson sitting at its own queue slot. Nothing
-- about auto-completing it makes its slot untrue, and MAX(queue_position) over
-- completed rows is precisely the number current_lesson is defined to hold. The
-- recompute this function provokes now returns NEW.current_lesson instead of
-- something lower, so the inner UPDATE is a no-op, the WHEN clause on this
-- trigger is false, and there is still no recursion — the same outcome
-- 20260519180000 claimed and did not get.
--
-- WHY THE <= GUARD, and not plain preservation. queue_position and
-- lesson_number legitimately diverge after move_lesson_to_date, so a swept row
-- (chosen by lesson_number) can hold a slot far ABOVE the new pointer.
-- Preserving that unconditionally would let MAX jump current_lesson past what
-- the family actually reached, marking lessons done that were never done.
-- 14 incomplete rows across 14 goals carry queue_position > lesson_number
-- today, so this is live, not hypothetical. Rows above the pointer keep the
-- existing NULL behavior: no worse than today, and no false advance.
--
-- WHY NOT CHANGE THE RECOMPUTE INSTEAD. The other candidate was to have
-- recompute_curriculum_current_lesson fall back to lesson_number for
-- position-stripped rows, i.e. MAX(COALESCE(queue_position, lesson_number)).
-- Rejected on measurement, not taste:
--   * 860 completed rows on active goals currently hold a lesson_number with a
--     NULL slot. Counting them retroactively moves current_lesson on 84 goals,
--     marks 349 lessons done that nobody did, and jumps one goal by 90 lessons
--     — on the next lesson write, silently.
--   * It breaks 'extra_log' by construction. An extra completion is written
--     with a lesson_number and a deliberately NULL queue_position precisely so
--     it does NOT advance the queue. COALESCE would make every extra advance
--     it. One such row exists on an active goal today.
--   * It mixes two coordinate systems the scheduler keeps apart on purpose:
--     queue_position is queue order, lesson_number is the printed index
--     ("Queue position" in docs/CURRICULUM-SCHEDULING.md).
-- This change touches one column expression in one trigger. That one does not.
--
-- INVARIANTS. Invariant 13 is unaffected: scheduled_date still clears to NULL
-- and date still pins to the synthetic day, so a trigger-completed row still
-- holds no future calendar slot. Invariant 12 is unaffected: this function
-- never writes queue_pinned. Invariant 10 is unaffected: this function has
-- never written scheduled_source and still does not, which is why the damaged
-- rows are identifiable by their untouched source.
--
-- Everything else is byte-identical to the live function body verified with
-- pg_get_functiondef on 2026-08-24: the re-entry guard, the NEW > OLD gate, the
-- notes-bearing skip, the completed_at backdate, the date-cache clearing,
-- SECURITY DEFINER, search_path.

CREATE OR REPLACE FUNCTION public.curriculum_goals_cleanup_orphans_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skip text;
BEGIN
  -- Re-entry guard. Blocks re-entry into THIS function only. The lessons
  -- recompute trigger is a separate function and still runs on the UPDATE
  -- below — which is the whole reason this migration exists. See the header.
  v_skip := current_setting('rooted.skip_orphan_cleanup', true);
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_lesson > OLD.current_lesson THEN
    PERFORM set_config('rooted.skip_orphan_cleanup', 'true', true);

    -- Mark orphans complete. completed_at is backdated by one day so these
    -- rows do not count against today's lessons_per_day quota (Today reads
    -- completed_at::date = today per goal to anchor today's projected slot
    -- count). The date caches are cleared so the row cannot keep a future
    -- calendar slot and collide with the live queue (Invariant 13).
    -- Rows with notes are parent-intentional and never touched.
    --
    -- queue_position is KEPT for rows at or below the new pointer. Nulling it
    -- made the recompute this statement provokes read a lower MAX and write
    -- current_lesson backwards, stranding the swept row's slot as a hole the
    -- projector emits and nothing fills. A row above the pointer still loses
    -- its slot: it was selected by lesson_number, and a drifted
    -- queue_position from move_lesson_to_date must never be allowed to
    -- advance current_lesson past what the family actually reached.
    UPDATE public.lessons
      SET completed = true,
          completed_at = NOW() - interval '1 day',
          scheduled_date = NULL,
          date = (NOW() - interval '1 day')::date,
          queue_position = CASE
            WHEN queue_position <= NEW.current_lesson THEN queue_position
            ELSE NULL
          END
      WHERE curriculum_goal_id = NEW.id
        AND completed = false
        AND lesson_number IS NOT NULL
        AND lesson_number <= NEW.current_lesson
        AND (notes IS NULL OR notes = '');
  END IF;

  RETURN NEW;
END;
$$;

-- Standing rule: re-assert grants whenever a SECURITY DEFINER function is
-- recreated. CREATE OR REPLACE preserves them (no DROP), but these are stated
-- explicitly so a fresh environment lands on the same grants as production and
-- so a future DROP + CREATE cannot silently widen access. Matches the live
-- state: service_role + postgres only. It is a trigger function and is never
-- called over /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM anon;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() TO service_role;
