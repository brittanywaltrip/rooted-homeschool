-- ============================================================
-- Schedule Builder: per-day overrides + archive flag
--
-- Backs the unified /dashboard/plan/schedule page that replaces the
-- multi-step CurriculumWizard. This migration is additive only.
--
-- What's new:
--   1. curriculum_goals.lessons_per_day_overrides (jsonb, nullable)
--      Per-day lesson counts keyed by the existing school_days labels
--      ("Mon".."Sun"). Null means "use lessons_per_day for every active
--      day" (existing behavior). Set means the keyed counts win for
--      those days; unkeyed days fall back to lessons_per_day.
--      Example: {"Mon":1,"Tue":1,"Wed":1,"Thu":2,"Fri":1}
--
--   2. curriculum_goals.archived (boolean NOT NULL DEFAULT false)
--      Soft-delete flag for the builder. Loaders that show the active
--      schedule must filter archived = false. Existing hard-delete code
--      paths in CurriculumWizard.tsx are unaffected; the builder uses
--      this flag instead so any lesson rows that reference an archived
--      goal stay intact for reports/transcripts.
--
-- What's NOT here (intentional):
--   - No `type` column on curriculum_goals. Co-ops and activities live
--     in the existing public.activities table (added 20260413100000).
--     The Schedule Builder UI will branch save paths: curriculum rows
--     -> curriculum_goals, co-op/activity rows -> activities. Adding
--     `type` here would create a parallel scheduling path that
--     collides with Invariant 7 (lesson completion advances
--     current_lesson). See docs/CURRICULUM-SCHEDULING.md.
--
-- Idempotent: start_date and start_at_lesson already exist
-- (20260413100000); the IF NOT EXISTS guards make this safe to re-run.
-- ============================================================

-- 1. Per-day lesson count overrides (null = use lessons_per_day).
alter table public.curriculum_goals
  add column if not exists lessons_per_day_overrides jsonb;

-- 2. Soft-delete flag for the Schedule Builder.
alter table public.curriculum_goals
  add column if not exists archived boolean not null default false;

-- 3. Idempotent guards for columns the builder relies on. These already
--    exist via 20260413100000 but we keep the guards so anyone running
--    migrations against an older branch ends up with the right schema.
alter table public.curriculum_goals
  add column if not exists start_date date;

alter table public.curriculum_goals
  add column if not exists start_at_lesson integer default 1;
