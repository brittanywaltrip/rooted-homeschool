-- ALREADY APPLIED 2026-09-09 via MCP, do not re-run.
--
-- Repo-record only. Everything below was applied directly to production on
-- 2026-09-09 while working through the Supabase performance advisor; this
-- file exists so the migrations directory describes the database that is
-- actually running. Verified against pg_indexes and pg_policies on
-- 2026-09-09 before this file was written: all nine indexes exist and all
-- eleven policies already carry the (select ...) form.
--
-- Part 1: unindexed foreign keys. Each is a column the advisor flagged as a
-- foreign key with no covering index, so every delete or update on the
-- referenced table scanned the referencing one.

create index if not exists activities_school_year_id_idx
  on public.activities (school_year_id);
create index if not exists activity_logs_school_year_id_idx
  on public.activity_logs (school_year_id);
create index if not exists family_notifications_user_id_idx
  on public.family_notifications (user_id);
create index if not exists family_notifications_memory_id_idx
  on public.family_notifications (memory_id);
create index if not exists mailbox_progress_child_id_idx
  on public.mailbox_progress (child_id);
create index if not exists referrals_user_id_idx
  on public.referrals (user_id);
create index if not exists resource_reports_user_id_idx
  on public.resource_reports (user_id);
create index if not exists subject_goals_child_id_idx
  on public.subject_goals (child_id);
create index if not exists subject_goals_subject_id_idx
  on public.subject_goals (subject_id);

-- Part 2: auth_rls_initplan. A policy written as `auth.uid() = user_id`
-- re-evaluates auth.uid() for every row. Wrapping it as
-- `(select auth.uid())` lets Postgres evaluate it once per query as an
-- InitPlan. Same rule for auth.jwt(). The policy semantics do not change.

alter policy "families read their own mailbox progress"
  on public.mailbox_progress
  using ((select auth.uid()) = user_id);
alter policy "families insert their own mailbox progress"
  on public.mailbox_progress
  with check ((select auth.uid()) = user_id);
alter policy "families update their own mailbox progress"
  on public.mailbox_progress
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy "families delete their own mailbox progress"
  on public.mailbox_progress
  using ((select auth.uid()) = user_id);

alter policy "monthly_reflections_select_own"
  on public.monthly_reflections
  using ((select auth.uid()) = user_id);
alter policy "monthly_reflections_insert_own"
  on public.monthly_reflections
  with check ((select auth.uid()) = user_id);
alter policy "monthly_reflections_update_own"
  on public.monthly_reflections
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy "monthly_reflections_delete_own"
  on public.monthly_reflections
  using ((select auth.uid()) = user_id);

alter policy "families read their own reports"
  on public.resource_reports
  using ((select auth.uid()) = user_id);
alter policy "families file their own reports"
  on public.resource_reports
  with check ((select auth.uid()) = user_id);

alter policy "Admin can manage partner apps"
  on public.partner_apps
  using (
    ((select auth.jwt()) ->> 'email') = any (array[
      'garfieldbrittany@gmail.com',
      'christopherwaltrip@gmail.com',
      'hello@rootedhomeschoolapp.com'
    ])
  );
