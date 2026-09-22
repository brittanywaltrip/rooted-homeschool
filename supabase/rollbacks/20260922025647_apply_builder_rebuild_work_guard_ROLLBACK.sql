-- Rollback for the work-guard migration: removes reopen_lesson and the work
-- helper, and puts apply_builder_rebuild back to its 20260922021607 body by
-- re-running that file (it is create or replace). Roll the APP back first:
-- the app calls reopen_lesson for every un-tick and has no fallback, so with
-- this function gone un-ticking stops (the lesson stays ticked, the family is
-- told). No data is touched.
drop function if exists public.reopen_lesson(uuid, date);
-- Re-apply supabase/migrations/20260922021607_apply_builder_rebuild.sql here, then:
drop function if exists rooted_private.lesson_carries_work(text, integer);
