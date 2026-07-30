-- ============================================================
-- enforce_lesson_child_matches_goal: split the two failure messages
-- (July 29, 2026)
--
-- Function body replacement ONLY. The trigger
-- (lessons_child_id_matches_goal, BEFORE INSERT OR UPDATE on
-- public.lessons, created in 20260507120000_curriculum_integrity_
-- constraints.sql) is NOT touched — `create or replace function` keeps
-- the existing trigger bound to the same function.
--
-- Problem: the original body tested existence and child match in a
-- single `not exists (... where id = goal and child_id = new.child_id)`,
-- so BOTH of these raised the identical message
--
--     "lessons.child_id does not match curriculum_goals.child_id for goal %"
--
--   (a) the goal exists but belongs to a different child — a real
--       mismatch, the case the guard was written for; and
--   (b) the goal row does not exist at all — a dangling
--       curriculum_goal_id, usually a write racing a delete.
--
-- Case (b) is what Sentry ROOTED-HOMESCHOOL-2 actually was: the e2e
-- smoke suite's afterEach cleanup deleted a goal while the Schedule
-- Builder's phase-2 lesson INSERTs were still in flight, and the
-- resulting error read as a child-mismatch bug. Hours went into looking
-- for a child_id assignment bug that was never there. Distinct messages
-- make that distinction free next time.
--
-- Behavior is otherwise preserved exactly:
--   * both curriculum_goal_id and child_id NULL-checked up front, so
--     legacy lessons with NULL child_id still pass through untouched
--     (the six catchup_resched rows with NULL child_id observed during
--     the ROOTED-HOMESCHOOL-2 investigation are unaffected);
--   * a goal row whose child_id IS NULL against a non-NULL
--     new.child_id still raises the mismatch error, matching the old
--     `not exists` semantics — `is distinct from` handles the NULL
--     comparison the way the old EXISTS predicate did;
--   * no data is read or written beyond the single goal lookup, and
--     no rows are mutated by this migration (Anti-pattern H).
--
-- Note on why the "not found" branch is reachable at all: lessons DOES
-- carry lessons_curriculum_goal_id_fkey, but this is a BEFORE ROW
-- trigger and BEFORE ROW triggers run ahead of FK constraint checks. So
-- an INSERT naming a deleted goal hits THIS function first and always
-- did — the FK error never got the chance to be the message anyone saw.
--
-- Verified against the live database on 2026-07-29 by applying this body
-- inside a transaction that was then aborted (function md5 confirmed
-- unchanged afterward, zero probe rows left behind):
--   missing goal      -> "curriculum goal <uuid> not found"        (new)
--   goal, wrong child -> "lessons.child_id does not match ..."     (unchanged)
--   goal, right child -> passes the trigger                        (unchanged)
--   NULL child_id     -> passes the trigger untouched              (unchanged)
-- ============================================================

create or replace function public.enforce_lesson_child_matches_goal()
returns trigger
language plpgsql
as $$
declare
  goal_child_id uuid;
begin
  if new.curriculum_goal_id is not null and new.child_id is not null then
    select child_id
      into goal_child_id
      from public.curriculum_goals
     where id = new.curriculum_goal_id;

    -- Existence first, so a dangling curriculum_goal_id reports as such
    -- instead of masquerading as a child mismatch.
    if not found then
      raise exception 'curriculum goal % not found', new.curriculum_goal_id;
    end if;

    if goal_child_id is distinct from new.child_id then
      raise exception 'lessons.child_id does not match curriculum_goals.child_id for goal %', new.curriculum_goal_id;
    end if;
  end if;
  return new;
end;
$$;
