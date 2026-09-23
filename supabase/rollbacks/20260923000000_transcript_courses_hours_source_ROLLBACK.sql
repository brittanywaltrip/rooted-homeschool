-- Rollback for 20260923000000_transcript_courses_hours_source.sql.
--
-- Roll the APP back first. The app writes hours_source on every course insert
-- and save, so dropping the column under it breaks saving a course.
-- Dropping the column also discards every 'family' marker, so after this the
-- old page-open recalculation would again overwrite typed hours.

alter table public.transcript_courses drop constraint if exists transcript_courses_hours_source_check;
alter table public.transcript_courses drop column if exists hours_source;
