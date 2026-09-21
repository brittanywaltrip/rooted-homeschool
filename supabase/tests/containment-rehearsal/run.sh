#!/bin/bash
# Rehearses the containment migrations in their proposed production order on a
# THROWAWAY local cluster (loopback only; it creates and deletes $REHEARSAL_DIR/data):
#   20260921200005 prerequisite, 20260921200028 audit, then 20260921210738 block,
#   20260921210801 intent, 20260921210815 session scope; then every rollback.
# Proves: the audit's schema dependency, the write-path failure of each piece,
# that each fast-path DISABLE TRIGGER takes it out of the write path, that an
# intent-CHECK failure needs the containment trigger disabled (intent tracking
# alone is not enough), and that the full rollbacks leave writes working.
#   REHEARSAL_DIR=/some/scratch supabase/tests/containment-rehearsal/run.sh
set -u
M="$(cd "$(dirname "$0")/../.." && pwd)"
R="${REHEARSAL_DIR:?set REHEARSAL_DIR to a scratch directory}"; PORT="${REHEARSAL_PORT:-56791}"
S="$(cd "$(dirname "$0")" && pwd)"
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
rm -rf $R/data; initdb -D $R/data -U postgres -A trust >/dev/null
pg_ctl -D $R/data -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories='' -p $PORT" -l $R/pg.log start -w >/dev/null
psql -Atc "show data_directory" postgres
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
USER_A=bbbbbbbb-0000-4000-8000-000000000001
AUTH="set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$USER_A\",\"role\":\"authenticated\",\"session_id\":\"dddddddd-0000-4000-8000-000000000001\"}', false);"
AUTH2="set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$USER_A\",\"role\":\"authenticated\",\"session_id\":\"dddddddd-0000-4000-8000-000000000002\"}', false);"
L(){ echo "cccccccc-0000-4000-8000-00000000000$1"; }
try(){ # label, db, sql
  local out; out=$(psql -X -q -At -d "$2" -c "$3" 2>&1); local rc=$?
  echo "[$1] rc=$rc $(echo "$out" | grep -E 'ERROR' | head -1 | cut -c1-140)"; }

echo "== D0 dependency: audit alone on a clean database (no prerequisite)"
q -c "create database dep" postgres; q -d dep -f $S/stub.sql >/dev/null
psql -X -q -At -d dep -v ON_ERROR_STOP=1 -f $M/migrations/20260921200028_lesson_date_change_audit.sql >/dev/null 2>$R/dep.err; echo "  apply rc=$? $(grep -m1 ERROR $R/dep.err)"

echo "== D1 proposed order on a clean database: prerequisite, audit"
q -c "create database reh" postgres; q -d reh -f $S/stub.sql >/dev/null
q -d reh -f $M/migrations/20260921200005_rooted_private_schema_prerequisite.sql && echo "  prerequisite applied"
q -d reh -f $M/migrations/20260921200028_lesson_date_change_audit.sql >/dev/null && echo "  audit applied"
try "A1 browser date write" reh "$AUTH update public.lessons set scheduled_date='2026-10-01', date='2026-10-01', scheduled_source='skip_respread' where id='$(L 4)'"
try "A2 service_role date write" reh "set role service_role; update public.lessons set scheduled_date='2026-10-02', date='2026-10-02' where id='$(L 5)'"
try "A3 notes-only write" reh "$AUTH update public.lessons set notes='x' where id='$(L 6)'"
echo "  audit rows: $(q -d reh -c "select string_agg(db_role||':'||coalesce(new_scheduled_source,'-')||':'||(jwt_sub is not null)::text, ' ' order by id) from rooted_private.lesson_date_changes")"
echo "-- A4 injected failure: browser loses EXECUTE on the audit helper"
q -d reh -c "revoke execute on function rooted_private.record_lesson_date_change(uuid,uuid,uuid,date,date,date,date,text,text,boolean,boolean,boolean,text,boolean) from authenticated"
try "A4 browser date write, audit broken" reh "$AUTH update public.lessons set scheduled_date='2026-10-03', date='2026-10-03' where id='$(L 4)'"
q -d reh -c "alter table public.lessons disable trigger lessons_audit_date_change"
try "A4 same write after DISABLE TRIGGER lessons_audit_date_change" reh "$AUTH update public.lessons set scheduled_date='2026-10-03', date='2026-10-03' where id='$(L 4)'"
q -d reh -c "alter table public.lessons enable trigger lessons_audit_date_change; grant execute on function rooted_private.record_lesson_date_change(uuid,uuid,uuid,date,date,date,date,text,text,boolean,boolean,boolean,text,boolean) to authenticated"
echo "-- A5 injected failure: browser loses USAGE on rooted_private (the prerequisite)"
q -d reh -c "revoke usage on schema rooted_private from authenticated"
try "A5 browser date write, no schema usage" reh "$AUTH update public.lessons set scheduled_date='2026-10-04', date='2026-10-04' where id='$(L 4)'"
q -d reh -c "alter table public.lessons disable trigger lessons_audit_date_change"
try "A5 same write after DISABLE TRIGGER" reh "$AUTH update public.lessons set scheduled_date='2026-10-04', date='2026-10-04' where id='$(L 4)'"
q -d reh -c "alter table public.lessons enable trigger lessons_audit_date_change; grant usage on schema rooted_private to authenticated"

echo "== D2 block, then intent, then session scope"
for f in 20260921210738_lessons_block_stale_resync 20260921210801_lessons_resync_parent_intent_window 20260921210815_lessons_resync_intent_session_scope; do
  q -d reh -f $M/migrations/$f.sql >/dev/null && echo "  applied $f"; done
q -d reh -c "update public.lessons set scheduled_source='queue_resync', queue_pinned=false"
try "B1 legacy payload, no intent" reh "$AUTH update public.lessons set scheduled_date='2026-11-01', date='2026-11-01', scheduled_source='queue_resync' where id='$(L 7)'"
echo "  L7 date now $(q -d reh -c "select scheduled_date from public.lessons where id='$(L 7)'") blocked rows $(q -d reh -c "select count(*) from public.lessons_resync_blocked")"
try "B2 parent payload skip_respread" reh "$AUTH update public.lessons set scheduled_date='2026-11-02', date='2026-11-02', scheduled_source='skip_respread' where id='$(L 7)'"
try "B3 date-only write on a queue_resync row" reh "$AUTH update public.lessons set scheduled_date='2026-11-03', date='2026-11-03' where id='$(L 8)'"
echo "  L7 $(q -d reh -c "select scheduled_date from public.lessons where id='$(L 7)'") L8 $(q -d reh -c "select scheduled_date from public.lessons where id='$(L 8)'")"
q -d reh -c "update public.lessons set queue_pinned=true where id='$(L 6)'"
try "C1 signal: bare unpin, session 1" reh "$AUTH update public.lessons set queue_pinned=false where id='$(L 6)'"
try "C1 legacy payload, session 1 inside window" reh "$AUTH update public.lessons set scheduled_date='2026-11-05', date='2026-11-05', scheduled_source='queue_resync' where id='$(L 5)'"
try "C2 legacy payload, session 2" reh "$AUTH2 update public.lessons set scheduled_date='2026-11-06', date='2026-11-06', scheduled_source='queue_resync' where id='$(L 4)'"
echo "  L5 $(q -d reh -c "select scheduled_date from public.lessons where id='$(L 5)'") L4 $(q -d reh -c "select scheduled_date from public.lessons where id='$(L 4)'") blocked $(q -d reh -c "select count(*) from public.lessons_resync_blocked") legacy_intent_audit $(q -d reh -c "select count(*) from rooted_private.lesson_date_changes where legacy_resync_intent")"

echo "-- C3 injected failure in the INTENT CHECK (has_recent_schedule_intent)"
q -d reh -c "create or replace function rooted_private.has_recent_schedule_intent(p_goal uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp as \$f\$ begin raise exception 'injected intent-check failure'; end \$f\$"
try "C3 legacy payload, intent check broken" reh "$AUTH update public.lessons set scheduled_date='2026-11-07', date='2026-11-07', scheduled_source='queue_resync' where id='$(L 4)'"
try "C3 parent payload, intent check broken" reh "$AUTH update public.lessons set scheduled_date='2026-11-08', date='2026-11-08', scheduled_source='skip_respread' where id='$(L 4)'"
q -d reh -c "alter table public.lessons disable trigger lessons_note_schedule_intent; alter table public.curriculum_goals disable trigger curriculum_goals_note_schedule_intent"
try "C3 legacy payload after disabling INTENT TRACKING only" reh "$AUTH update public.lessons set scheduled_date='2026-11-09', date='2026-11-09', scheduled_source='queue_resync' where id='$(L 4)'"
q -d reh -c "alter table public.lessons disable trigger lessons_block_stale_resync"
try "C3 legacy payload after DISABLE TRIGGER lessons_block_stale_resync" reh "$AUTH update public.lessons set scheduled_date='2026-11-09', date='2026-11-09', scheduled_source='queue_resync' where id='$(L 4)'"
q -d reh -c "alter table public.lessons enable trigger lessons_block_stale_resync; alter table public.lessons enable trigger lessons_note_schedule_intent; alter table public.curriculum_goals enable trigger curriculum_goals_note_schedule_intent"
q -d reh -f $M/migrations/20260921210815_lessons_resync_intent_session_scope.sql >/dev/null && echo "  intent check restored by re-applying 183953"

echo "-- C4 injected failure in INTENT SIGNALS (note_schedule_intent)"
q -d reh -c "create or replace function rooted_private.note_schedule_intent(p_goal uuid, p_kind text) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as \$f\$ begin raise exception 'injected signal failure'; end \$f\$"
q -d reh -c "update public.lessons set queue_pinned=true where id='$(L 6)'"
try "C4 bare unpin, signal broken" reh "$AUTH update public.lessons set queue_pinned=false where id='$(L 6)'"
try "C4 start_at_lesson write, signal broken" reh "$AUTH update public.curriculum_goals set start_at_lesson=2"
q -d reh -c "alter table public.lessons disable trigger lessons_note_schedule_intent; alter table public.curriculum_goals disable trigger curriculum_goals_note_schedule_intent"
try "C4 bare unpin after disabling intent triggers" reh "$AUTH update public.lessons set queue_pinned=false where id='$(L 6)'"
try "C4 start_at_lesson after disabling intent triggers" reh "$AUTH update public.curriculum_goals set start_at_lesson=2"
q -d reh -c "alter table public.lessons enable trigger lessons_note_schedule_intent; alter table public.curriculum_goals enable trigger curriculum_goals_note_schedule_intent"
q -d reh -f $M/migrations/20260921210815_lessons_resync_intent_session_scope.sql >/dev/null && echo "  signals restored by re-applying 183953"

echo "== D3 full rollbacks, reverse order"
for f in 20260921210815_lessons_resync_intent_session_scope 20260921200028_lesson_date_change_audit 20260921210801_lessons_resync_parent_intent_window 20260921210738_lessons_block_stale_resync; do
  psql -X -q -At -d reh -v ON_ERROR_STOP=1 -f $M/rollbacks/${f}_ROLLBACK.sql >/dev/null 2>$R/rb.err && echo "  rolled back $f" || echo "  ROLLBACK FAILED $f: $(grep -m1 ERROR $R/rb.err)"; done
psql -X -q -At -d reh -v ON_ERROR_STOP=1 -f $M/rollbacks/20260921200005_rooted_private_schema_prerequisite_ROLLBACK.sql >/dev/null 2>$R/rb.err && echo "  rolled back the prerequisite (schema empty)" || echo "  prerequisite rollback refused: $(grep -m1 ERROR $R/rb.err)"
echo "  our triggers left: $(q -d reh -c "select coalesce(string_agg(tgname,','),'none') from pg_trigger where not tgisinternal and tgname in ('lessons_block_stale_resync','lessons_note_schedule_intent','curriculum_goals_note_schedule_intent','lessons_audit_date_change')")"
try "D3 legacy payload after full rollback" reh "$AUTH update public.lessons set scheduled_date='2026-12-01', date='2026-12-01', scheduled_source='queue_resync' where id='$(L 4)'"
try "D3 unpin + start_at_lesson after full rollback" reh "$AUTH update public.lessons set queue_pinned=false where id='$(L 6)'; update public.curriculum_goals set start_at_lesson=3"

pg_ctl -D $R/data stop -m fast >/dev/null; echo done
