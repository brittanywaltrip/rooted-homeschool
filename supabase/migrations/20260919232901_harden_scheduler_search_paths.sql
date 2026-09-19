-- ============================================================================
-- Stage 1b: put pg_temp LAST on every privileged function in the scheduling
-- chain.
-- ============================================================================
-- WHY THIS IS NOT COSMETIC
--
-- When pg_temp is not listed in search_path, PostgreSQL searches the session's
-- TEMPORARY schema FIRST for relation names. Any `authenticated` caller can
-- create a temp table. So a SECURITY DEFINER function that says
-- `set search_path = public` and then reads `lessons` can be made to read the
-- caller's temp table called `lessons` instead -- while running as postgres.
--
-- Demonstrated, not assumed. With `search_path = shadowtest`:
--
--     create temp table secrets(v text);
--     insert into secrets values ('SHADOWED BY A TEMP TABLE');
--     select public.shadow_victim();   -> 'SHADOWED BY A TEMP TABLE'
--
-- and with `search_path = shadowtest, pg_temp` the same call returns 'REAL'.
-- harness/shadowing.sh reproduces both directions on every function below.
--
-- WHAT THIS CHANGES, AND WHAT IT DOES NOT
--
-- Each function keeps the schema list it already had; pg_temp is APPENDED.
-- Naming pg_temp last does not remove a schema any body needs -- it only moves
-- the temp schema from implicitly-first to explicitly-last. Bodies are not
-- touched: this is ALTER FUNCTION ... SET, so the definition, owner, grants and
-- behaviour are unchanged.
--
-- The one exception is schedule_canonicalize_proposal, which had NO search_path
-- at all and inherited the caller's. It is SECURITY INVOKER, but both its
-- callers -- schedule_seal_proposal and schedule_commit_dry_run -- are DEFINER,
-- so when reached through them it runs as postgres with an attacker-influenced
-- resolution order. Its body references nothing in `extensions` and no crypto
-- or uuid helpers (checked), so `public, pg_temp` is both sufficient and
-- strictly tighter than the inherited `public, extensions`.
-- ============================================================================

-- The sealing/preview chain.
alter function public.schedule_canonicalize_proposal(text, uuid[], jsonb, boolean, boolean)
  set search_path = public, pg_temp;
alter function public.schedule_preview(text, jsonb)
  set search_path = public, pg_temp;
alter function public.schedule_seal_proposal(text, uuid[], jsonb, boolean, boolean)
  set search_path = public, extensions, pg_temp;
alter function public.schedule_commit_dry_run(uuid, text, uuid[], jsonb, boolean, boolean, text)
  set search_path = public, extensions, pg_temp;

-- Reached from a lesson write, which schedule_commit performs, so they are in
-- the chain even though nothing calls them by name from the app.
alter function public.recompute_curriculum_current_lesson(uuid)
  set search_path = public, pg_temp;
alter function public.move_lesson_to_date(uuid, date)
  set search_path = public, pg_temp;

-- The lessons and curriculum_goals triggers. Every one of these fires inside
-- schedule_commit's transaction.
alter function public.lessons_recompute_current_lesson_trg()
  set search_path = public, pg_temp;
alter function public.curriculum_goals_cleanup_orphans_trg()
  set search_path = public, pg_temp;
alter function public.lessons_fill_child_id_from_goal()
  set search_path = public, pg_temp;
alter function public.block_lesson_goal_detach()
  set search_path = public, pg_temp;
alter function public.lessons_block_server_side_completion()
  set search_path = public, pg_temp;
alter function public.enforce_curriculum_school_days_nonempty()
  set search_path = public, pg_catalog, pg_temp;
alter function public.set_lessons_updated_at()
  set search_path = public, pg_catalog, pg_temp;

-- enforce_lesson_child_matches_goal already reads `public, pg_temp`, and the
-- seven functions added in Stage 1 were written that way. Nothing to do.
