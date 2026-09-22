#!/bin/bash
# Rehearses public.apply_daily_reconcile on a THROWAWAY local cluster.
#   REHEARSAL_DIR=/some/scratch supabase/tests/daily-reconcile/run.sh
set -u
S="$(cd "$(dirname "$0")" && pwd)"; M="$(cd "$S/../.." && pwd)"
R="${REHEARSAL_DIR:?set REHEARSAL_DIR}"; PORT="${REHEARSAL_PORT:-56911}"
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
rm -rf "$R/data"; initdb -D "$R/data" -U postgres -A trust >/dev/null
pg_ctl -D "$R/data" -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories='' -p $PORT" -l "$R/pg.log" start -w >/dev/null
psql -Atc "show data_directory" postgres
q(){ psql -X -q -At -v ON_ERROR_STOP=1 -d dr "$@"; }
psql -X -q -c "create database dr" postgres
q -f "$S/stub.sql" >/dev/null
q -f "$M/migrations/20260921230610_daily_reconcile.sql" >/dev/null && echo "migration applied"

U=bbbbbbbb-0000-4000-8000-000000000001; OTHER=bbbbbbbb-0000-4000-8000-000000000002; G=aaaaaaaa-0000-4000-8000-000000000001
DAY=$(q -c "select (now() at time zone 'UTC')::date")
AS="set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\",\"role\":\"authenticated\"}',false);"
reset_fixture(){ q -c "
  delete from rooted_private.daily_reconcile_log; delete from public.lessons; delete from public.curriculum_goals; delete from public.vacation_blocks;
  insert into public.curriculum_goals values ('$G','$U',10,2,1,null,array['Mon','Tue','Wed','Thu','Fri'],'2026-09-01',false);
  insert into public.lessons (id,user_id,curriculum_goal_id,lesson_number,queue_position,scheduled_date,date,scheduled_source,completed,completed_at,queue_pinned,skipped,is_backfill)
  select ('cccccccc-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'$U','$G',n,n,
         case when n<=2 then date '$DAY' - 10 + n else date '$DAY' - 3 + n end, case when n<=2 then date '$DAY' - 10 + n else date '$DAY' - 3 + n end,
         case when n<=2 then 'completion_today' else 'queue_resync' end, n<=2, case when n<=2 then now() - interval '9 days' else null end, n=9, false, false
    from generate_series(1,10) n;
  insert into public.vacation_blocks (user_id,start_date,end_date) values ('$U', date '$DAY' + 30, date '$DAY' + 32);"; }
L(){ echo "cccccccc-0000-4000-8000-0000000000$(printf %02d $1)"; }
EXP="{\"goal\":{\"total_lessons\":10,\"current_lesson\":2,\"lessons_per_day\":1,\"lessons_per_day_overrides\":null,\"school_days\":[\"Mon\",\"Tue\",\"Wed\",\"Thu\",\"Fri\"],\"start_date\":\"2026-09-01\"},\"vacations\":[[\"$(q -c "select (date '$DAY'+30)::text")\",\"$(q -c "select (date '$DAY'+32)::text")\"]],\"pins\":[[9,\"$(q -c "select (date '$DAY'+6)::text")\"]],\"skipped\":[],\"done_today\":0,\"day_start\":\"$(q -c "select date_trunc('day', now())")\",\"day_end\":\"$(q -c "select date_trunc('day', now()) + interval '1 day'")\"}"
W(){ echo "[{\"id\":\"$(L 3)\",\"from\":\"$(q -c "select (date '$DAY'+0)::text")\",\"to\":\"$(q -c "select (date '$DAY'+1)::text")\"},{\"id\":\"$(L 4)\",\"from\":\"$(q -c "select (date '$DAY'+1)::text")\",\"to\":\"$(q -c "select (date '$DAY'+2)::text")\"}]"; }
call(){ local exp="$1" writes="$2" day="${3:-$DAY}"; q -c "$AS select public.apply_daily_reconcile('$G','$day','$exp'::jsonb,'$writes'::jsonb)::text" | tail -1; }
state(){ q -c "select 'L3='||(select scheduled_date||'/'||scheduled_source from public.lessons where id='$(L 3)')||' L4='||(select scheduled_date from public.lessons where id='$(L 4)')||' log='||(select count(*) from rooted_private.daily_reconcile_log)"; }
sw(){ q -c "update rooted_private.app_switches set enabled=$1 where name='daily_reconcile'"; }

reset_fixture
echo "T1 switch off (created off)      -> $(call "$EXP" "$(W)")   $(state)"
sw true
echo "T2 not the owner                 -> $(q -c "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$OTHER\"}',false); select public.apply_daily_reconcile('$G','$DAY','$EXP'::jsonb,'$(W)'::jsonb)::text" | tail -1)"
echo "T3 local day far away            -> $(call "$EXP" "$(W)" "2026-01-01")"
q -c "update public.curriculum_goals set current_lesson=3 where id='$G'"
echo "T4 pointer moved since calc      -> $(call "$EXP" "$(W)")   $(state)"
q -c "update public.curriculum_goals set current_lesson=2 where id='$G'"
q -c "update public.lessons set queue_pinned=true where id='$(L 5)'"
echo "T5 new pin since calc            -> $(call "$EXP" "$(W)")   $(state)"
q -c "update public.lessons set queue_pinned=false where id='$(L 5)'"
q -c "update public.lessons set scheduled_date=scheduled_date+5, date=date+5 where id='$(L 4)'"
echo "T6 row moved since calc          -> $(call "$EXP" "$(W)")   $(state)"
q -c "update public.lessons set scheduled_date=scheduled_date-5, date=date-5 where id='$(L 4)'"
q -c "update public.lessons set completed=true, completed_at=now() where id='$(L 10)'"
echo "T7 completed today since calc    -> $(call "$EXP" "$(W)")   $(state)"
q -c "update public.lessons set completed=false, completed_at=null where id='$(L 10)'"
q -c "insert into public.vacation_blocks (user_id,start_date,end_date) values ('$U', date '$DAY'+40, date '$DAY'+41)"
echo "T8 break added since calc        -> $(call "$EXP" "$(W)")   $(state)"
q -c "delete from public.vacation_blocks where start_date = date '$DAY'+40"
q -c "update public.lessons set skipped=true where id='$(L 6)'"
echo "T9 skip since calc               -> $(call "$EXP" "$(W)")   $(state)"
q -c "update public.lessons set skipped=false where id='$(L 6)'"
BACK="[{\"id\":\"$(L 3)\",\"from\":\"$(q -c "select (date '$DAY'+0)::text")\",\"to\":\"$(q -c "select (date '$DAY'-1)::text")\"}]"
echo "T10 move into the past           -> $(call "$EXP" "$BACK")   $(state)"
PIN="[{\"id\":\"$(L 9)\",\"from\":\"$(q -c "select (date '$DAY'+6)::text")\",\"to\":\"$(q -c "select (date '$DAY'+7)::text")\"}]"
echo "T11 try to move a pinned row     -> $(call "$EXP" "$PIN")   $(state)"
# Interrupted write: a local-only trigger fails the 2nd row; nothing may land, day not marked.
q -c "create function public._boom() returns trigger language plpgsql as \$b\$ begin if new.id = '$(L 4)' then raise exception 'injected failure'; end if; return new; end \$b\$; create trigger _boom before update on public.lessons for each row execute function public._boom();"
echo "T12 interrupted mid-write        -> $(call "$EXP" "$(W)" 2>&1 | grep -oE 'injected failure|status.*' | head -1)   $(state)"
q -c "drop trigger _boom on public.lessons; drop function public._boom();"
echo "T13 retry after the failure      -> $(call "$EXP" "$(W)")   $(state)"
echo "T14 second call, same day        -> $(call "$EXP" "$(W)")   $(state)"
# Concurrency: session A holds the lock mid-transaction; B must wait and then see 'already'.
q -c "delete from rooted_private.daily_reconcile_log"; q -c "update public.lessons set scheduled_date = date '$DAY' - 3 + lesson_number, date = date '$DAY' - 3 + lesson_number, scheduled_source='queue_resync' where lesson_number in (3,4)"
( psql -X -q -At -d dr -c "begin; $AS select public.apply_daily_reconcile('$G','$DAY','$EXP'::jsonb,'$(W)'::jsonb)::text; select pg_sleep(2); commit;" | grep status > "$R/a.out" ) &
sleep 0.5
echo "T15 concurrent tab, B            -> $(call "$EXP" "$(W)")   (A: $(wait; cat $R/a.out))   $(state)"
sw false
q -c "delete from rooted_private.daily_reconcile_log"
echo "T16 switched off, open tab calls -> $(call "$EXP" "$(W)")   $(state)"
echo "T17 anon cannot execute          -> $(psql -X -q -At -d dr -c "set role anon; select public.apply_daily_reconcile('$G','$DAY','{}'::jsonb,'[]'::jsonb)" 2>&1 | grep -oE 'permission denied[^\"]*' | head -1)"
q -c "set role authenticated; select count(*) from rooted_private.daily_reconcile_log" 2>&1 | grep -oE 'permission denied[^\"]*' | head -1 | sed 's/^/T18 browser cannot read the log  -> /'
psql -X -q -At -d dr -v ON_ERROR_STOP=1 -f "$M/rollbacks/20260921230610_daily_reconcile_ROLLBACK.sql" >/dev/null && echo "rollback applied: function gone=$(q -c "select to_regprocedure('public.apply_daily_reconcile(uuid,date,jsonb,jsonb)') is null") log kept=$(q -c "select to_regclass('rooted_private.daily_reconcile_log') is not null")"
pg_ctl -D "$R/data" stop -m fast >/dev/null; echo done
