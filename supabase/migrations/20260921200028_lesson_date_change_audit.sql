-- ALREADY APPLIED. DO NOT RE-RUN.
--   production gvkbegvvmhcrmxdorctk: 20260921200028 lesson_date_change_audit (2026-09-21)
--   staging    cvgqovweybggrqakhdtd: 20260921174245 lesson_date_change_audit (2026-09-21)
-- The filename carries the PRODUCTION version. The staging ledger recorded
-- 20260921174245; see docs/MIGRATION-LEDGER-CONTAINMENT.md.
--
-- lesson_date_change_audit: a bounded record of every lesson date change that
-- actually LANDS. Staging first; production only with separate approval.
--
-- WHY
-- lessons_resync_blocked records refused attempts. It cannot show a date
-- change that got through: a leak in the block, a parent action, a repair
-- script. updated_at and a retained scheduled_source prove neither that a
-- date moved nor who moved it, because most rows keep 'queue_resync' across
-- writes that never name a source. This table answers "which dates changed,
-- from what to what, by which role, in which transaction".
--
-- BLOCKED VS SUCCESSFUL
-- AFTER UPDATE row trigger. A row refused by lessons_block_stale_resync
-- returns NULL from a BEFORE trigger, which cancels that row's update, and a
-- cancelled row fires no AFTER trigger. So:
--   rooted_private.lesson_date_changes    = changes that landed
--   public.lessons_resync_blocked          = attempts that were refused
-- and one lesson update can never appear in both.
--
-- WHAT IT RECORDS
-- Only UPDATEs where scheduled_date or date really changed (the WHEN clause
-- compares values, so re-sending an unchanged date writes nothing here).
-- INSERTs and DELETEs are out of scope. db_role is the effective role of the
-- statement (authenticated = a signed-in browser writing directly;
-- postgres = a SECURITY DEFINER RPC; service_role = a server key).
-- legacy_resync_intent marks a legacy queue_resync write that the intent
-- window let through, so allowed old-tab parent actions can be counted. It is
-- read from a transaction-local list the block trigger writes; it is
-- telemetry and decides nothing.
--
-- ACCESS
-- rooted_private is not exposed by PostgREST. RLS on, no policies, no grants
-- to anon or authenticated; service_role may read. Written only by
-- rooted_private.record_lesson_date_change, callable only inside a trigger.
--
-- OVERHEAD, measured on staging before applying: see the containment report.
-- One insert per changed row, inside the same transaction as the change.
--
-- RETENTION
-- For the containment observation window only. There is no cleanup job. To
-- end it: export, then run the rollback file (drops the trigger, keeps the
-- table), then drop the table by hand when the export is confirmed.
--
-- FAILURE
-- If the insert fails, the lesson update fails with it. That makes an audit
-- outage visible as failed writes rather than as silently unaudited ones. If
-- that is judged too strict for production, the alternative is an exception
-- block that swallows audit errors, which trades visibility for availability.

create table if not exists rooted_private.lesson_date_changes (
  id                    bigint generated always as identity primary key,
  changed_at            timestamptz not null default clock_timestamp(),
  txid                  bigint      not null default txid_current(),
  lesson_id             uuid        not null,
  user_id               uuid,
  curriculum_goal_id    uuid,
  old_scheduled_date    date,
  new_scheduled_date    date,
  old_date              date,
  new_date              date,
  old_scheduled_source  text,
  new_scheduled_source  text,
  old_queue_pinned      boolean,
  new_queue_pinned      boolean,
  new_completed         boolean,
  db_role               text        not null,
  jwt_sub               uuid,
  legacy_resync_intent  boolean     not null default false
);
create index if not exists lesson_date_changes_changed_at_idx on rooted_private.lesson_date_changes (changed_at);
create index if not exists lesson_date_changes_user_idx on rooted_private.lesson_date_changes (user_id, changed_at);
alter table rooted_private.lesson_date_changes enable row level security;
revoke all on rooted_private.lesson_date_changes from public, anon, authenticated;
grant usage on schema rooted_private to service_role;
grant select on rooted_private.lesson_date_changes to service_role;

create or replace function rooted_private.record_lesson_date_change(
  p_lesson_id uuid, p_user_id uuid, p_goal uuid,
  p_old_sd date, p_new_sd date, p_old_d date, p_new_d date,
  p_old_src text, p_new_src text,
  p_old_pin boolean, p_new_pin boolean, p_new_completed boolean,
  p_role text, p_legacy_intent boolean
) returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'record_lesson_date_change may only run inside the lessons trigger'
      using errcode = '42501';
  end if;
  -- A browser can only ever be recording its own lesson.
  if p_role = 'authenticated' and p_user_id is distinct from auth.uid() then
    raise exception 'record_lesson_date_change: lesson % is not the caller''s', p_lesson_id
      using errcode = '42501';
  end if;
  insert into rooted_private.lesson_date_changes (
    lesson_id, user_id, curriculum_goal_id,
    old_scheduled_date, new_scheduled_date, old_date, new_date,
    old_scheduled_source, new_scheduled_source,
    old_queue_pinned, new_queue_pinned, new_completed,
    db_role, jwt_sub, legacy_resync_intent
  ) values (
    p_lesson_id, p_user_id, p_goal,
    p_old_sd, p_new_sd, p_old_d, p_new_d,
    p_old_src, p_new_src,
    p_old_pin, p_new_pin, p_new_completed,
    p_role, auth.uid(), p_legacy_intent
  );
end;
$fn$;
revoke all on function rooted_private.record_lesson_date_change(
  uuid, uuid, uuid, date, date, date, date, text, text, boolean, boolean, boolean, text, boolean
) from public, anon;
grant execute on function rooted_private.record_lesson_date_change(
  uuid, uuid, uuid, date, date, date, date, text, text, boolean, boolean, boolean, text, boolean
) to authenticated, service_role;
-- The trigger runs as whoever issued the UPDATE, so every role that may change
-- a lesson date needs EXECUTE here, or its write fails (the audit fails
-- closed). authenticated: browsers. service_role: server keys and repair
-- scripts. postgres owns it. Found by the staging rehearsal: without the
-- service_role grant a service-role date write was refused with 42501.

-- SECURITY INVOKER so current_user is the role that ran the statement.
create or replace function public.lessons_audit_date_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_legacy boolean := false;
begin
  -- Set by lessons_block_stale_resync only for rows it let through by intent.
  -- A date-only write on a row that merely keeps 'queue_resync' never fires
  -- that trigger, so it is never mislabelled here.
  v_legacy := position(new.id::text || ',' in coalesce(current_setting('rooted.resync_intent_ids', true), '')) > 0;
  perform rooted_private.record_lesson_date_change(
    new.id, new.user_id, new.curriculum_goal_id,
    old.scheduled_date, new.scheduled_date, old.date, new.date,
    old.scheduled_source, new.scheduled_source,
    old.queue_pinned, new.queue_pinned, new.completed,
    current_user::text, v_legacy
  );
  return null;
end;
$fn$;
revoke all on function public.lessons_audit_date_change() from public, anon, authenticated;

drop trigger if exists lessons_audit_date_change on public.lessons;
create trigger lessons_audit_date_change
  after update of scheduled_date, date on public.lessons
  for each row
  when (old.scheduled_date is distinct from new.scheduled_date or old.date is distinct from new.date)
  execute function public.lessons_audit_date_change();
