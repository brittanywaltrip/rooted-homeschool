-- Restores each function's PREVIOUS search_path exactly as recorded before the
-- forward migration on 2026-09-19.
--
-- WHAT THIS REOPENS, stated so it is a decision: every function below returns
-- to searching the caller's TEMPORARY schema FIRST for relation names, which
-- lets any authenticated caller shadow a table a SECURITY DEFINER body reads.
-- harness/shadowing.sh demonstrates the difference in both directions.
alter function public.schedule_canonicalize_proposal(text, uuid[], jsonb, boolean, boolean)
  reset search_path;                                        -- was: none at all
alter function public.schedule_preview(text, jsonb)
  set search_path = public;
alter function public.schedule_seal_proposal(text, uuid[], jsonb, boolean, boolean)
  set search_path = public, extensions;
alter function public.schedule_commit_dry_run(uuid, text, uuid[], jsonb, boolean, boolean, text)
  set search_path = public, extensions;
alter function public.recompute_curriculum_current_lesson(uuid)
  set search_path = public;
alter function public.move_lesson_to_date(uuid, date)
  set search_path = public;
alter function public.lessons_recompute_current_lesson_trg()
  set search_path = public;
alter function public.curriculum_goals_cleanup_orphans_trg()
  set search_path = public;
alter function public.lessons_fill_child_id_from_goal()
  set search_path = public;
alter function public.block_lesson_goal_detach()
  set search_path = public;
alter function public.lessons_block_server_side_completion()
  set search_path = public;
alter function public.enforce_curriculum_school_days_nonempty()
  set search_path = public, pg_catalog;
alter function public.set_lessons_updated_at()
  set search_path = public, pg_catalog;
