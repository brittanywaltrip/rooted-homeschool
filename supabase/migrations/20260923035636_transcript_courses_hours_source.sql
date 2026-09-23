-- transcript_courses.hours_source: who owns hours_logged and credits_earned.
--
-- rooted-staging (cvgqovweybggrqakhdtd): APPLIED 2026-09-23, ledger version
-- 20260923035636, name transcript_courses_hours_source.
-- Production (gvkbegvvmhcrmxdorctk): APPLIED 2026-09-23 with apply_migration,
-- ledger version 20260923051306, same name, before #97's app was merged.
-- ALREADY APPLIED on both: do not re-run. The filename carries the staging
-- version, like daily_reconcile's.
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
