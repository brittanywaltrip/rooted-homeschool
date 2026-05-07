-- ============================================================
-- Curriculum integrity constraints (May 7, 2026)
--
-- Five constraints / triggers that codify the documented invariants
-- in docs/CURRICULUM-SCHEDULING.md so a future code path that drifts
-- gets caught at the database boundary instead of producing silent
-- data drift like the April 28 / May 3 regressions.
--
--   1. Partial unique index on lessons (curriculum_goal_id,
--      lesson_number) — duplicate (goal, lesson_number) rows have been
--      a recurring bug source. healGoalIntegrity in app/lib/scheduler.ts
--      removes incomplete duplicates on every Plan-page load; this
--      index makes new duplicates structurally impossible.
--   2. CHECK current_lesson >= 0 — recomputeCurrentLesson() already
--      clamps via Math.max(0, ...). Belt-and-suspenders for any direct
--      UPDATE that bypasses it.
--   3. CHECK lesson_number > 0 when set — lesson_number is 1-indexed
--      everywhere in code; zero or negative values would be a bug.
--   4. Trigger: lessons.child_id must match curriculum_goals.child_id
--      when both are set — catches save paths that link a lesson row
--      to the wrong child.
--   5. Trigger: school_days never empty on curriculum_goals
--      (Invariant 5) — falls back to Mon-Fri at the DB boundary so an
--      empty array cannot reach the day-walker (where it would loop
--      forever).
--
-- Anti-pattern H from docs/CURRICULUM-SCHEDULING.md is in force: this
-- migration does NOT bulk-update lessons or curriculum_goals to fix
-- pre-existing violations. If the safety checks below report nonzero
-- counts, the corresponding ALTER TABLE / CREATE INDEX will fail
-- loudly when this migration runs and the operator must clean the
-- offending rows manually (one-off script, backup table, sign-off)
-- before retrying.
--
-- ─── Safety checks — RUN THESE FIRST ──────────────────────────────
--
-- Each query should return zero rows. If any return > 0, stop and
-- clean the data manually before applying this migration.
--
--   -- 1. Duplicate (curriculum_goal_id, lesson_number) — blocks the
--   --    partial unique index. healGoalIntegrity covers incomplete
--   --    duplicates; completed duplicates need human review.
--   SELECT curriculum_goal_id, lesson_number, COUNT(*) AS dup
--   FROM public.lessons
--   WHERE curriculum_goal_id IS NOT NULL AND lesson_number IS NOT NULL
--   GROUP BY 1, 2
--   HAVING COUNT(*) > 1;
--
--   -- 2. Negative current_lesson — blocks the CHECK constraint.
--   SELECT id, current_lesson FROM public.curriculum_goals
--   WHERE current_lesson < 0;
--
--   -- 3. Zero or negative lesson_number — blocks the CHECK constraint.
--   SELECT id, lesson_number FROM public.lessons
--   WHERE lesson_number IS NOT NULL AND lesson_number <= 0;
--
--   -- 4. lessons.child_id mismatched against curriculum_goals.child_id
--   --    — the trigger only fires on new writes, but listing existing
--   --    drift here so the operator can decide whether to clean up.
--   SELECT l.id AS lesson_id, l.child_id AS lesson_child_id,
--          l.curriculum_goal_id, g.child_id AS goal_child_id
--   FROM public.lessons l
--   JOIN public.curriculum_goals g ON g.id = l.curriculum_goal_id
--   WHERE l.curriculum_goal_id IS NOT NULL
--     AND l.child_id IS NOT NULL
--     AND g.child_id IS NOT NULL
--     AND l.child_id <> g.child_id;
--
--   -- 5. Empty school_days on curriculum_goals — the trigger only
--   --    fires on new writes; existing rows with empty arrays are
--   --    listed here so the operator can backfill if any are found.
--   SELECT id, school_days FROM public.curriculum_goals
--   WHERE school_days IS NULL OR cardinality(school_days) = 0;
-- ============================================================

-- 1. Partial unique index — no duplicate (goal, lesson_number) when both set.
create unique index if not exists lessons_goal_lesson_number_unique
  on public.lessons (curriculum_goal_id, lesson_number)
  where curriculum_goal_id is not null and lesson_number is not null;

-- 2. CHECK — current_lesson never negative.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'curriculum_goals_current_lesson_non_negative'
  ) then
    alter table public.curriculum_goals
      add constraint curriculum_goals_current_lesson_non_negative
      check (current_lesson >= 0);
  end if;
end $$;

-- 3. CHECK — lesson_number positive when set.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lessons_lesson_number_positive'
  ) then
    alter table public.lessons
      add constraint lessons_lesson_number_positive
      check (lesson_number is null or lesson_number > 0);
  end if;
end $$;

-- 4. Trigger — lessons.child_id must match curriculum_goals.child_id.
--
-- Fires BEFORE INSERT OR UPDATE on lessons. Only validates when both
-- the lesson's curriculum_goal_id AND child_id are set; legacy lessons
-- with NULL child_id pass through untouched.
create or replace function public.enforce_lesson_child_matches_goal()
returns trigger
language plpgsql
as $$
begin
  if new.curriculum_goal_id is not null and new.child_id is not null then
    if not exists (
      select 1 from public.curriculum_goals
      where id = new.curriculum_goal_id
        and child_id = new.child_id
    ) then
      raise exception 'lessons.child_id does not match curriculum_goals.child_id for goal %', new.curriculum_goal_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lessons_child_id_matches_goal on public.lessons;
create trigger lessons_child_id_matches_goal
before insert or update on public.lessons
for each row
execute function public.enforce_lesson_child_matches_goal();

-- 5. Trigger — school_days never empty on curriculum_goals (Invariant 5).
--
-- Fires BEFORE INSERT OR UPDATE on curriculum_goals. If school_days is
-- null or empty, defaults it to Mon-Fri and emits a WARNING (not an
-- exception) so the write still succeeds and the operator sees the
-- problem in logs. Existing rows with empty arrays are NOT mutated by
-- this migration; the trigger only acts on subsequent writes.
create or replace function public.enforce_curriculum_school_days_nonempty()
returns trigger
language plpgsql
as $$
begin
  if new.school_days is null or cardinality(new.school_days) = 0 then
    new.school_days := array['Mon','Tue','Wed','Thu','Fri'];
    raise warning 'curriculum_goals.school_days was empty; defaulted to Mon-Fri (id=%)', new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists curriculum_goals_school_days_guard on public.curriculum_goals;
create trigger curriculum_goals_school_days_guard
before insert or update on public.curriculum_goals
for each row
execute function public.enforce_curriculum_school_days_nonempty();
