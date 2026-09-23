-- transcript_courses.hours_source: who owns hours_logged and credits_earned.
--
-- NOT APPLIED TO PRODUCTION. Per CLAUDE.md, apply it with apply_migration,
-- read back the version the ledger recorded, and rename this file to
-- `<that version>_transcript_courses_hours_source.sql` (and the rollback).
--
-- Additive and inert on its own: a new nullable column with no default, so
-- every existing row reads NULL ("unclassified") and no value changes. The app
-- that reads it (lib/transcript/hours-source.ts) must NOT deploy before this
-- column exists, because its inserts and updates write it.
--
--   'calculated'  the transcript page keeps hours and credits in step with lessons
--   'family'      a family typed them; never recalculated
--   NULL          unclassified; also never recalculated
--
-- No grant needed: authenticated holds a table-level UPDATE grant on
-- transcript_courses (checked 2026-09-23), and the existing own-row RLS
-- policies cover the new column.

alter table public.transcript_courses
  add column if not exists hours_source text;

alter table public.transcript_courses
  drop constraint if exists transcript_courses_hours_source_check;

alter table public.transcript_courses
  add constraint transcript_courses_hours_source_check
  check (hours_source in ('calculated', 'family'));

comment on column public.transcript_courses.hours_source is
  'Who owns hours_logged/credits_earned: calculated (page recalculates), family (typed, never recalculated), NULL (unclassified, never recalculated).';
