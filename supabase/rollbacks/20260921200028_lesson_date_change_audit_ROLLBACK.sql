-- Rollback for 20260921200028_lesson_date_change_audit.
--
-- Stops recording landed date changes. Blocking is unaffected. The table is
-- KEPT: export it first, then drop it by hand once the export is confirmed:
--   drop table rooted_private.lesson_date_changes;
--
-- FAST PATH, if the audit is failing writes. The trigger is in the write path
-- of every lesson date change, and an audit failure fails that write. This
-- takes it out of the write path (proven on staging 2026-09-21: an injected
-- lesson_date_changes failure broke an ordinary parent move, which landed
-- after this):
--   ALTER TABLE public.lessons DISABLE TRIGGER lessons_audit_date_change;
-- Blocking is unaffected; landed changes simply stop being recorded.

begin;
drop trigger if exists lessons_audit_date_change on public.lessons;
drop function if exists public.lessons_audit_date_change();
drop function if exists rooted_private.record_lesson_date_change(
  uuid, uuid, uuid, date, date, date, date, text, text, boolean, boolean, boolean, text, boolean
);
commit;
