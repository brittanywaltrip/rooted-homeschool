-- Rollback for 20260921174245_lesson_date_change_audit.
--
-- Stops recording landed date changes. Blocking is unaffected. The table is
-- KEPT: export it first, then drop it by hand once the export is confirmed:
--   drop table rooted_private.lesson_date_changes;
--
-- Fastest, no DDL on functions:
--   ALTER TABLE public.lessons DISABLE TRIGGER lessons_audit_date_change;

begin;
drop trigger if exists lessons_audit_date_change on public.lessons;
drop function if exists public.lessons_audit_date_change();
drop function if exists rooted_private.record_lesson_date_change(
  uuid, uuid, uuid, date, date, date, date, text, text, boolean, boolean, boolean, text, boolean
);
commit;
