-- daily_reconcile DATE REPAIR: put back the dates the daily reconciliation
-- moved, for lessons nobody has touched since. NOT the rollback.
--
-- Three different levers, in order of how often they should be needed:
--   1. Switch off (stops new writes, any build, open tabs included):
--        update rooted_private.app_switches set enabled = false, updated_at = now()
--         where name = 'daily_reconcile';
--   2. Roll back app code (Vercel): old builds never call the function.
--   3. This file: revert dates ALREADY written. Rarely right. A reconciled date
--      is Today's own projection; reverting it re-creates the drift the job
--      fixed. Use it only if the projection itself was wrong (a projector bug)
--      and switch off FIRST, or tomorrow's run re-dates the lessons again.
--
-- What it restores, per lesson, from rooted_private.lesson_date_changes:
--   the state before the FIRST daily_reconcile change since :since, and only
--   when every change to that lesson after it was also daily_reconcile, the
--   row still carries the last reconciled date and source, and it is still
--   unfinished, unpinned and unskipped. Anything a parent did since (a move,
--   a pin, a completion, a skip, a re-date) wins and the lesson is left alone.
--
-- Usage: set the cutoff, run the DRY RUN, read it, then run the APPLY block.

-- ── DRY RUN ─────────────────────────────────────────────────────────────────
with params as (select timestamptz '2026-09-21 00:00:00+00' as since),
changes as (
  select c.*, row_number() over (partition by c.lesson_id order by c.changed_at, c.id) as rn_first,
         row_number() over (partition by c.lesson_id order by c.changed_at desc, c.id desc) as rn_last
    from rooted_private.lesson_date_changes c, params p
   where c.changed_at >= p.since
     and c.lesson_id in (select lesson_id from rooted_private.lesson_date_changes
                          where new_scheduled_source = 'daily_reconcile' and changed_at >= (select since from params))
),
first_rc as (   -- the first reconcile change per lesson since the cutoff
  select distinct on (lesson_id) * from changes
   where new_scheduled_source = 'daily_reconcile' order by lesson_id, changed_at, id
),
eligible as (
  select f.lesson_id, f.old_scheduled_date, f.old_date, f.old_scheduled_source, l.scheduled_date as current_date_value
    from first_rc f
    join public.lessons l on l.id = f.lesson_id
    join changes last on last.lesson_id = f.lesson_id and last.rn_last = 1
   where not exists (select 1 from changes x where x.lesson_id = f.lesson_id and x.changed_at >= f.changed_at
                       and x.new_scheduled_source is distinct from 'daily_reconcile')
     and l.scheduled_source = 'daily_reconcile'
     and l.scheduled_date is not distinct from last.new_scheduled_date
     and not l.completed and not coalesce(l.queue_pinned, false) and not coalesce(l.skipped, false)
)
select count(*) as lessons_to_restore,
       count(distinct l.user_id) as families,
       min(e.old_scheduled_date) as earliest_restored_date,
       count(*) filter (where e.old_scheduled_date < current_date) as restored_into_the_past
  from eligible e join public.lessons l on l.id = e.lesson_id;

-- ── APPLY ───────────────────────────────────────────────────────────────────
-- Runs only inside a transaction that first sets the confirmation, so pasting
-- the whole file cannot write by accident:
--   begin;
--   set local rooted.daily_reconcile_repair = 'apply';
--   <this DO block>
--   -- compare the NOTICE count with the dry run, then commit (or rollback)
do $$
declare
  v_since timestamptz := timestamptz '2026-09-21 00:00:00+00';
  v_n integer;
begin
  if coalesce(current_setting('rooted.daily_reconcile_repair', true), '') <> 'apply' then
    raise exception 'Not confirmed: set local rooted.daily_reconcile_repair = ''apply'' in this transaction first.';
  end if;
  with changes as (
    select c.*, row_number() over (partition by c.lesson_id order by c.changed_at desc, c.id desc) as rn_last
      from rooted_private.lesson_date_changes c
     where c.changed_at >= v_since
       and c.lesson_id in (select lesson_id from rooted_private.lesson_date_changes
                            where new_scheduled_source = 'daily_reconcile' and changed_at >= v_since)
  ),
  first_rc as (
    select distinct on (lesson_id) * from changes
     where new_scheduled_source = 'daily_reconcile' order by lesson_id, changed_at, id
  ),
  eligible as (
    select f.lesson_id, f.old_scheduled_date, f.old_date, f.old_scheduled_source, last.new_scheduled_date as reconciled_date
      from first_rc f
      join changes last on last.lesson_id = f.lesson_id and last.rn_last = 1
     where not exists (select 1 from changes x where x.lesson_id = f.lesson_id and x.changed_at >= f.changed_at
                         and x.new_scheduled_source is distinct from 'daily_reconcile')
  )
  update public.lessons l
     set scheduled_date = e.old_scheduled_date,
         date = e.old_date,
         scheduled_source = coalesce(e.old_scheduled_source, 'cleanup_sql')
    from eligible e
   where l.id = e.lesson_id
     and l.scheduled_source = 'daily_reconcile'
     and l.scheduled_date is not distinct from e.reconciled_date
     and not l.completed and not coalesce(l.queue_pinned, false) and not coalesce(l.skipped, false);
  get diagnostics v_n = row_count;
  raise notice 'restored % lessons', v_n;
end $$;
--
-- The update is itself recorded in lesson_date_changes (db_role postgres), so
-- the repair can be audited and, if needed, reversed from the same table.
