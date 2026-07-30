-- Manual placements survive the queue reconciler.
--
-- Background: lessons.scheduled_date was a pure cache of the queue projector.
-- reconcileGoalScheduleCache rewrote any incomplete row that disagreed with the
-- projection and stamped it scheduled_source = 'queue_resync'. Every manual
-- move on the Plan page therefore reverted on the next Today load, and a
-- partially-rewritten tail produced doubled-up days and out-of-order lesson
-- numbers (luvmywk, 2026-07-29: lessons 17-37 kept their moved dates while 38+
-- were resynced, leaving Sep 7 holding both 36 and 38).
--
-- queue_pinned marks a row as user-placed. The projector emits pinned slots at
-- their stored date and fills unpinned slots around them; the reconciler never
-- re-dates a pinned row. See the PINS section in app/lib/scheduler.ts.
--
-- Why a column instead of reading scheduled_source: 'plan_move' is a log of
-- what last wrote the row, not a statement of intent, and it is overwritten by
-- any later system write (a vacation re-spread would silently unpin). Two
-- distinct facts deserve two columns.

alter table public.lessons
  add column if not exists queue_pinned boolean not null default false;

comment on column public.lessons.queue_pinned is
  'True when the user placed this lesson on its scheduled_date by hand (Plan move, cascade shift, push-back, shift-forward, bulk move). Pinned rows are never re-dated by the queue projector or the cache reconciler. Cleared implicitly by completion (completed rows are never re-dated). See app/lib/scheduler.ts PinnedSlot.';

-- Backfill: pin the incomplete rows that a manual move already placed.
--
-- Note on CLAUDE.md anti-pattern H (no bulk lesson UPDATE in a migration):
-- that rule exists because a migration runs in every environment and would
-- rewrite real families' SCHEDULES without warning. This statement writes no
-- date, no queue_position and no completion state. It sets one new additive
-- flag on rows whose scheduled_source already records a manual move, and as of
-- 2026-07-30 that is 31 rows across 6 users / 7 goals. Verified against prod:
-- the hand-repaired luvmywk goals (8ec1eedd…, 915da85b…) carry zero plan_move
-- rows, so this pins nothing there and their projection is unchanged.
update public.lessons
   set queue_pinned = true
 where completed = false
   and scheduled_source = 'plan_move'
   and queue_pinned = false;

-- move_lesson_to_date is the single write path for an explicit user reorder,
-- so it is where the pin is set. Body is unchanged from
-- 20260518064205 except for the three `queue_pinned = true` assignments on the
-- branches that write a date.
create or replace function public.move_lesson_to_date(p_lesson_id uuid, p_target_date date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_goal_id uuid;
  v_old_qp integer;
  v_old_date date;
  v_max_qp_on_d integer;
  v_max_qp_before_d integer;
  v_new_qp integer;
  v_owner_id uuid;
BEGIN
  -- Ownership check: verify the lesson belongs to the calling user
  SELECT user_id INTO v_owner_id
    FROM lessons
    WHERE id = p_lesson_id;

  IF v_owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'permission denied: lesson does not belong to current user';
  END IF;

  SELECT curriculum_goal_id, queue_position, scheduled_date
    INTO v_goal_id, v_old_qp, v_old_date
    FROM lessons
    WHERE id = p_lesson_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lesson % not found', p_lesson_id;
  END IF;

  IF v_goal_id IS NULL OR v_old_qp IS NULL THEN
    UPDATE lessons
      SET scheduled_date = p_target_date,
          date           = p_target_date,
          scheduled_source = 'plan_move',
          queue_pinned   = true
      WHERE id = p_lesson_id;
    RETURN;
  END IF;

  SELECT MAX(queue_position)
    INTO v_max_qp_on_d
    FROM lessons
    WHERE curriculum_goal_id = v_goal_id
      AND scheduled_date = p_target_date
      AND id <> p_lesson_id
      AND queue_position IS NOT NULL;

  IF v_max_qp_on_d IS NULL THEN
    SELECT MAX(queue_position)
      INTO v_max_qp_before_d
      FROM lessons
      WHERE curriculum_goal_id = v_goal_id
        AND scheduled_date < p_target_date
        AND id <> p_lesson_id
        AND queue_position IS NOT NULL;
    v_max_qp_on_d := COALESCE(v_max_qp_before_d, 0);
  END IF;

  IF v_old_qp > v_max_qp_on_d THEN
    v_new_qp := v_max_qp_on_d + 1;
  ELSE
    v_new_qp := v_max_qp_on_d;
  END IF;

  IF v_new_qp = v_old_qp AND v_old_date IS NOT DISTINCT FROM p_target_date THEN
    UPDATE lessons
      SET scheduled_source = 'plan_move',
          queue_pinned = true
      WHERE id = p_lesson_id;
    RETURN;
  END IF;

  UPDATE lessons SET queue_position = NULL WHERE id = p_lesson_id;

  IF v_old_qp < v_new_qp THEN
    UPDATE lessons
      SET queue_position = -(queue_position - 1)
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position > v_old_qp
        AND queue_position <= v_new_qp;
    UPDATE lessons
      SET queue_position = -queue_position
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position < 0;
  ELSIF v_old_qp > v_new_qp THEN
    UPDATE lessons
      SET queue_position = -(queue_position + 1)
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position >= v_new_qp
        AND queue_position < v_old_qp;
    UPDATE lessons
      SET queue_position = -queue_position
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position < 0;
  END IF;

  UPDATE lessons
    SET queue_position = v_new_qp,
        scheduled_date = p_target_date,
        date           = p_target_date,
        scheduled_source = 'plan_move',
        queue_pinned   = true
    WHERE id = p_lesson_id;
END;
$function$;
