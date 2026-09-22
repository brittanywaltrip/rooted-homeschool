#!/bin/bash
# Rehearses public.apply_builder_rebuild on a THROWAWAY local cluster.
#   REHEARSAL_DIR=/some/scratch supabase/tests/builder-rebuild/run.sh [migration.sql]
# Synthetic data only. Prints one line per case; every line should read as its
# label says. Nothing here touches a real database.
set -u
S="$(cd "$(dirname "$0")" && pwd)"; M="$(cd "$S/../.." && pwd)"
MIG="${1:-$(ls "$M"/migrations/*apply_builder_rebuild.sql | head -1)}"
R="${REHEARSAL_DIR:?set REHEARSAL_DIR}"; PORT="${REHEARSAL_PORT:-56912}"
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
rm -rf "$R/data"; initdb -D "$R/data" -U postgres -A trust >/dev/null
pg_ctl -D "$R/data" -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories='' -p $PORT" -l "$R/pg.log" start -w >/dev/null
q(){ psql -X -q -At -v ON_ERROR_STOP=1 -d br "$@"; }
psql -X -q -c "create database br" postgres
q -f "$S/stub.sql" >/dev/null
q -f "$MIG" >/dev/null && echo "migration applied: $(basename "$MIG")"

U=bbbbbbbb-0000-4000-8000-000000000001; OTHER=bbbbbbbb-0000-4000-8000-000000000002; G=aaaaaaaa-0000-4000-8000-000000000001
DAY=$(q -c "select (now() at time zone 'UTC')::date")
AS="set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\",\"role\":\"authenticated\"}',false);"
L(){ printf 'cccccccc-0000-4000-8000-%012d' "$1"; }

# 20 lessons, 1/day every day of the week (so the rehearsal never depends on
# the weekday it runs on). 1..5 history (5 dated today, done today), 6..20
# forward from tomorrow. Lesson 5 is then UNTICKED the old way: unfinished,
# unpinned, minutes kept, behind the pointer (start_at_lesson 6 -> pointer 5).
reset_fixture(){ q -c "
  delete from public.lessons; delete from public.curriculum_goals;
  insert into public.curriculum_goals (id,user_id,total_lessons,current_lesson,start_at_lesson,lessons_per_day,school_days,start_date)
    values ('$G','$U',20,5,6,1,array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],date '$DAY' - 4);
  insert into public.lessons (id,user_id,curriculum_goal_id,lesson_number,queue_position,title,scheduled_date,date,scheduled_source,completed,completed_at,minutes_spent,is_backfill)
  select ('cccccccc-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'$U','$G',n,n,'L'||n,
         date '$DAY' - 5 + n, date '$DAY' - 5 + n, 'wizard_create', n<=5,
         case when n<=5 then (date '$DAY' - 5 + n)::timestamptz + interval '12 hours' end,
         case when n<=5 then 30 end, n<=5
    from generate_series(1,20) n;
  update public.lessons set completed=false, completed_at=null, is_backfill=false, scheduled_source='manual_uncomplete'
   where id='$(L 5)';"; }

# What the builder sends, built from the rows themselves.
expected(){ q -c "select jsonb_build_object(
   'goal', (select jsonb_build_object('total_lessons',total_lessons,'current_lesson',current_lesson,'start_at_lesson',start_at_lesson,
            'lessons_per_day',lessons_per_day,'lessons_per_day_overrides',lessons_per_day_overrides,'school_days',to_jsonb(school_days),
            'start_date',start_date::text) from public.curriculum_goals where id='$G'),
   'rows', (select jsonb_agg(jsonb_build_array(id::text,lesson_number,queue_position,completed,queue_pinned,skipped,scheduled_date::text) order by id)
            from public.lessons where curriculum_goal_id='$G'),
   'day_start', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC',
   'day_end', (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC')::text"; }

# The fixed plan (what the builder now computes): lesson 5 becomes a make-up on
# today; 6..20 are deleted and re-inserted from tomorrow.
plan_fixed(){ q -c "select jsonb_build_object(
   'unpin_ids','[]'::jsonb,'makeup_ids',jsonb_build_array('$(L 5)'),
   'delete_ids',(select jsonb_agg(id::text) from public.lessons where curriculum_goal_id='$G' and lesson_number>=6),
   'inserts',(select jsonb_agg(jsonb_build_object('child_id',null,'lesson_number',n,'queue_position',n,'title','L'||n,
              'scheduled_date',(date '$DAY' + (n-5))::text,'scheduled_source','wizard_create','completed',false,'hours',0)) from generate_series(6,20) n),
   'retire_above',20,'retire_keep_ids','[]'::jsonb,'redates','[]'::jsonb)::text"; }
# The OLD plan: lesson 6 lands on today, beside the reopened lesson 5 and the lesson done today.
plan_old(){ plan_fixed | sed "s/\"makeup_ids\": \[[^]]*\]/\"makeup_ids\": []/" | q -c "select replace(\$\$$(plan_fixed)\$\$, 'x','x')" >/dev/null; q -c "select jsonb_set(jsonb_set('$(plan_fixed)'::jsonb,'{makeup_ids}','[]'),'{inserts}',
   (select jsonb_agg(jsonb_build_object('child_id',null,'lesson_number',n,'queue_position',n,'title','L'||n,
     'scheduled_date',(date '$DAY' + (n-6))::text,'scheduled_source','wizard_create','completed',false,'hours',0)) from generate_series(6,20) n))::text"; }
call(){ q -c "$AS select public.apply_builder_rebuild('$G','$DAY','$1'::jsonb,'$2'::jsonb)::text" | tail -1; }
state(){ q -c "select 'rows='||count(*)||' today='||coalesce(string_agg(lesson_number::text,',' order by lesson_number) filter (where scheduled_date=date '$DAY' and not completed),'-')
  ||' tomorrow='||coalesce(string_agg(lesson_number::text,',' order by lesson_number) filter (where scheduled_date=date '$DAY'+1 and not completed),'-')
  ||' L5='||max(case when lesson_number=5 then (case when queue_pinned then 'pinned' else 'unpinned' end)||'/'||coalesce(scheduled_source,'')||'/min '||coalesce(minutes_spent::text,'null')||'/done '||completed end)
  from public.lessons where curriculum_goal_id='$G'"; }

reset_fixture; EXP=$(expected)
echo "T1 not the owner                  -> $(q -c "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$OTHER\"}',false); select public.apply_builder_rebuild('$G','$DAY','$EXP'::jsonb,'$(plan_fixed)'::jsonb)::text" | tail -1)"
echo "T2 anon cannot execute            -> $(psql -X -q -At -d br -c "set role anon; select public.apply_builder_rebuild('$G','$DAY','{}'::jsonb,'{}'::jsonb)" 2>&1 | grep -oE 'permission denied[^\"]*' | head -1)"
q -c "update public.lessons set scheduled_date=scheduled_date+1, date=date+1 where id='$(L 12)'"
echo "T3 a row moved since the plan     -> $(call "$EXP" "$(plan_fixed)")   $(state)"
reset_fixture; EXP=$(expected)
echo "T4 old plan (6 on today) refused  -> $(call "$EXP" "$(plan_old)" | grep -oE '"status": "[a-z]+"|rooted_rebuild_overcapacity: [^"]*' | tr '\n' ' ')  $(state)"
BADDEL=$(q -c "select jsonb_set('$(plan_fixed)'::jsonb,'{delete_ids}', ('$(plan_fixed)'::jsonb->'delete_ids') || jsonb_build_array('$(L 5)'))::text")
echo "T5 delete a row with minutes      -> $(call "$EXP" "$BADDEL")   $(state)"
q -c "create function public._boom() returns trigger language plpgsql as \$b\$ begin if new.lesson_number = 14 then raise exception 'injected failure'; end if; return new; end \$b\$; create trigger _boom before insert on public.lessons for each row execute function public._boom();"
echo "T6 fails mid-write (insert 14)    -> $(call "$EXP" "$(plan_fixed)" | grep -oE '"status": "[a-z]+"|injected failure' | tr '\n' ' ')  $(state)"
q -c "drop trigger _boom on public.lessons; drop function public._boom();"
echo "T7 the fixed plan                 -> $(call "$EXP" "$(plan_fixed)")   $(state)"
echo "T8 the same plan again (stale)    -> $(call "$EXP" "$(plan_fixed)")   $(state)"
# Concurrency: A holds the locks mid-transaction; B, planned from the same rows, waits and then sees them changed.
reset_fixture; EXP=$(expected); PF=$(plan_fixed)
( psql -X -q -At -d br -c "begin; $AS select public.apply_builder_rebuild('$G','$DAY','$EXP'::jsonb,'$PF'::jsonb)::text; select pg_sleep(2); commit;" | grep status > "$R/a.out" ) &
sleep 0.5
echo "T9 concurrent tab B               -> $(call "$EXP" "$PF")   (A: $(wait; cat "$R/a.out"))   $(state)"
# Shortening to 15: rows past 15 retire; one carrying notes is unscheduled, not deleted.
reset_fixture; q -c "update public.lessons set notes='keep me' where id='$(L 18)'; update public.curriculum_goals set total_lessons=15 where id='$G'"; EXP=$(expected)
RET=$(q -c "select jsonb_build_object('unpin_ids','[]'::jsonb,'makeup_ids',jsonb_build_array('$(L 5)'),
   'delete_ids',(select jsonb_agg(id::text) from public.lessons where curriculum_goal_id='$G' and lesson_number between 6 and 15),
   'inserts',(select jsonb_agg(jsonb_build_object('child_id',null,'lesson_number',n,'queue_position',n,'title','L'||n,
              'scheduled_date',(date '$DAY' + (n-5))::text,'scheduled_source','wizard_create','completed',false,'hours',0)) from generate_series(6,15) n),
   'retire_above',15,'retire_keep_ids',jsonb_build_array('$(L 18)'),'redates','[]'::jsonb)::text")
echo "T10 shorten to 15, keep notes row -> $(call "$EXP" "$RET")   $(q -c "select 'rows='||count(*)||' past15='||coalesce(string_agg(lesson_number||':'||coalesce(scheduled_date::text,'unscheduled')||':'||coalesce(queue_position::text,'noslot'),','),'-') from public.lessons where curriculum_goal_id='$G' and lesson_number>15")"
# A completed history row inserted by the function is allowed (trigger depth 1).
reset_fixture; q -c "delete from public.lessons where id='$(L 3)'"; EXP=$(expected)
HIST=$(q -c "select jsonb_set('$(plan_fixed)'::jsonb,'{inserts}', ('$(plan_fixed)'::jsonb->'inserts') || jsonb_build_array(jsonb_build_object('child_id',null,'lesson_number',3,'queue_position',3,'title','L3','scheduled_date',(date '$DAY'-2)::text,'scheduled_source','wizard_create','completed',true,'completed_at',now()::text,'is_backfill',true,'minutes_spent',30,'hours',0.5)))::text")
echo "T11 history insert (completed)    -> $(call "$EXP" "$HIST" | grep -oE '"status": "[a-z]+"|"inserted": [0-9]+' | tr '\n' ' ')  L3 done=$(q -c "select completed from public.lessons where curriculum_goal_id='$G' and lesson_number=3")"
pg_ctl -D "$R/data" stop -m fast >/dev/null; echo done
