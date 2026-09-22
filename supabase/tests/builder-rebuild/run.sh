#!/bin/bash
# Rehearses public.apply_builder_rebuild on a THROWAWAY local cluster.
#   REHEARSAL_DIR=/some/scratch supabase/tests/builder-rebuild/run.sh [migration.sql]
# Synthetic data only. Prints one line per case; every line should read as its
# label says. Nothing here touches a real database.
set -u
S="$(cd "$(dirname "$0")" && pwd)"; M="$(cd "$S/../.." && pwd)"
# Every apply_builder_rebuild migration, in filename order (the base, then the work guard).
MIGS="${*:-$(ls "$M"/migrations/*apply_builder_rebuild*.sql | sort)}"
R="${REHEARSAL_DIR:?set REHEARSAL_DIR}"; PORT="${REHEARSAL_PORT:-56912}"
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
rm -rf "$R/data"; initdb -D "$R/data" -U postgres -A trust >/dev/null
pg_ctl -D "$R/data" -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories='' -p $PORT" -l "$R/pg.log" start -w >/dev/null
q(){ psql -X -q -At -v ON_ERROR_STOP=1 -d br "$@"; }
psql -X -q -c "create database br" postgres
q -f "$S/stub.sql" >/dev/null
for MIG in $MIGS; do q -f "$MIG" >/dev/null && echo "migration applied: $(basename "$MIG")"; done
FAILS=0
check(){ if echo "$2" | grep -Eq -- "$3"; then echo "PASS $1 -> $2"; else echo "FAIL $1 -> $2   (expected /$3/)"; FAILS=$((FAILS+1)); fi; }

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
check "T1 not the owner" "$(q -c "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$OTHER\"}',false); select public.apply_builder_rebuild('$G','$DAY','$EXP'::jsonb,'$(plan_fixed)'::jsonb)::text" | tail -1)" 'not_owner'
check "T2 anon cannot execute" "$(psql -X -q -At -d br -c "set role anon; select public.apply_builder_rebuild('$G','$DAY','{}'::jsonb,'{}'::jsonb)" 2>&1 | grep -oE 'permission denied[^\"]*' | head -1)" 'permission denied'
q -c "update public.lessons set scheduled_date=scheduled_date+1, date=date+1 where id='$(L 12)'"
check "T3 a row moved since the plan" "$(call "$EXP" "$(plan_fixed)")   $(state)" '"stale".*today=5 tomorrow=6 L5=unpinned'
reset_fixture; EXP=$(expected)
check "T4 old plan (6 on today) refused" "$(call "$EXP" "$(plan_old)" | grep -oE '"status": "[a-z]+"|rooted_rebuild_overcapacity: [^"]*' | tr '\n' ' ')  $(state)" 'rooted_rebuild_overcapacity.*refused.*L5=unpinned'
BADDEL=$(q -c "select jsonb_set('$(plan_fixed)'::jsonb,'{delete_ids}', ('$(plan_fixed)'::jsonb->'delete_ids') || jsonb_build_array('$(L 5)'))::text")
check "T5 delete a row with minutes" "$(call "$EXP" "$BADDEL")   $(state)" 'delete_rows.*"stale"'
q -c "create function public._boom() returns trigger language plpgsql as \$b\$ begin if new.lesson_number = 14 then raise exception 'injected failure'; end if; return new; end \$b\$; create trigger _boom before insert on public.lessons for each row execute function public._boom();"
check "T6 fails mid-write (insert 14)" "$(call "$EXP" "$(plan_fixed)" | grep -oE '"status": "[a-z]+"|injected failure' | tr '\n' ' ')  $(state)" 'injected failure "status": "failed".*rows=20 today=5 tomorrow=6 L5=unpinned'
q -c "drop trigger _boom on public.lessons; drop function public._boom();"
check "T7 the fixed plan" "$(call "$EXP" "$(plan_fixed)")   $(state)" '"applied".*"made_up": 1.*L5=pinned/reopened/min 30/done false'
check "T8 the same plan again (stale)" "$(call "$EXP" "$(plan_fixed)")   $(state)" '"stale"'
# Concurrency: A holds the locks mid-transaction; B, planned from the same rows, waits and then sees them changed.
reset_fixture; EXP=$(expected); PF=$(plan_fixed)
( psql -X -q -At -d br -c "begin; $AS select public.apply_builder_rebuild('$G','$DAY','$EXP'::jsonb,'$PF'::jsonb)::text; select pg_sleep(2); commit;" | grep status > "$R/a.out" ) &
sleep 0.5
check "T9 concurrent tab B" "$(call "$EXP" "$PF")   (A: $(wait; cat "$R/a.out"))   $(state)" '"stale".*\(A: \{"status": "applied"'
# Shortening to 15: rows past 15 retire; one carrying notes is unscheduled, not deleted.
reset_fixture; q -c "update public.lessons set notes='keep me' where id='$(L 18)'; update public.curriculum_goals set total_lessons=15 where id='$G'"; EXP=$(expected)
RET=$(q -c "select jsonb_build_object('unpin_ids','[]'::jsonb,'makeup_ids',jsonb_build_array('$(L 5)'),
   'delete_ids',(select jsonb_agg(id::text) from public.lessons where curriculum_goal_id='$G' and lesson_number between 6 and 15),
   'inserts',(select jsonb_agg(jsonb_build_object('child_id',null,'lesson_number',n,'queue_position',n,'title','L'||n,
              'scheduled_date',(date '$DAY' + (n-5))::text,'scheduled_source','wizard_create','completed',false,'hours',0)) from generate_series(6,15) n),
   'retire_above',15,'retire_keep_ids',jsonb_build_array('$(L 18)'),'redates','[]'::jsonb)::text")
check "T10 shorten to 15, keep notes row" "$(call "$EXP" "$RET")   $(q -c "select 'rows='||count(*)||' past15='||coalesce(string_agg(lesson_number||':'||coalesce(scheduled_date::text,'unscheduled')||':'||coalesce(queue_position::text,'noslot'),','),'-') from public.lessons where curriculum_goal_id='$G' and lesson_number>15")" '"applied".*past15=18:unscheduled:noslot'
# A completed history row inserted by the function is allowed (trigger depth 1).
reset_fixture; q -c "delete from public.lessons where id='$(L 3)'"; EXP=$(expected)
HIST=$(q -c "select jsonb_set('$(plan_fixed)'::jsonb,'{inserts}', ('$(plan_fixed)'::jsonb->'inserts') || jsonb_build_array(jsonb_build_object('child_id',null,'lesson_number',3,'queue_position',3,'title','L3','scheduled_date',(date '$DAY'-2)::text,'scheduled_source','wizard_create','completed',true,'completed_at',now()::text,'is_backfill',true,'minutes_spent',30,'hours',0.5)))::text")
check "T11 history insert (completed)" "$(call "$EXP" "$HIST" | grep -oE '"status": "[a-z]+"|"inserted": [0-9]+' | tr '\n' ' ')  L3 done=$(q -c "select completed from public.lessons where curriculum_goal_id='$G' and lesson_number=3")" '"applied" "inserted": 16   L3 done=t'

# ── Retirement race (PR #87 review) ────────────────────────────────────────
# The plan retires 16..20 with nothing kept; then "another tab" puts notes (or
# minutes) on lesson 18; then the original plan is committed.
retire_plan(){ q -c "select jsonb_build_object('unpin_ids','[]'::jsonb,'makeup_ids',jsonb_build_array('$(L 5)'),
   'delete_ids',(select jsonb_agg(id::text) from public.lessons where curriculum_goal_id='$G' and lesson_number between 6 and 15),
   'inserts',(select jsonb_agg(jsonb_build_object('child_id',null,'lesson_number',n,'queue_position',n,'title','L'||n,
              'scheduled_date',(date '$DAY' + (n-5))::text,'scheduled_source','wizard_create','completed',false,'hours',0)) from generate_series(6,15) n),
   'retire_above',15,'retire_keep_ids',${1:-'[]'::jsonb},'redates','[]'::jsonb)::text"; }
L18(){ q -c "select coalesce(scheduled_date::text,'unscheduled')||'/notes='||coalesce(notes,'')||'/min='||coalesce(minutes_spent::text,'null') from public.lessons where id='$(L 18)'"; }
reset_fixture; q -c "update public.curriculum_goals set total_lessons=15 where id='$G'"; EXP=$(expected); RP=$(retire_plan)
q -c "update public.lessons set notes='written in another tab' where id='$(L 18)'"
check "T12 retire race: notes added"    "$(call "$EXP" "$RP")   L18=$(L18)" '"reason": "retire_rows", "status": "stale".*L18=.*/notes=written in another tab'
reset_fixture; q -c "update public.curriculum_goals set total_lessons=15 where id='$G'"; EXP=$(expected); RP=$(retire_plan)
q -c "update public.lessons set minutes_spent=25 where id='$(L 18)'"
check "T13 retire race: minutes added"  "$(call "$EXP" "$RP")   L18=$(L18)" '"stale".*L18=.*/min=25'
check "T14 re-planned with 18 kept"     "$(call "$EXP" "$(retire_plan "jsonb_build_array('$(L 18)')")")   L18=$(L18)" '"applied".*L18=unscheduled/notes=/min=25'
# Whitespace-only notes (JavaScript trim() whitespace, including U+00A0) are not work, on both sides.
check "T15 work rule: nbsp only"        "$(q -c "select rooted_private.lesson_carries_work(E' \\u00a0\\t', null)::text || '/' || rooted_private.lesson_carries_work(' x ', null)::text || '/' || rooted_private.lesson_carries_work(null, 0)::text")" '^false/true/true$'

# ── reopen_lesson: un-ticking as one transaction ───────────────────────────
# Fixture: lessons 1..5 done (5 dated today), 6..20 ahead; pointer 5 (start_at 6).
reset_reopen(){ reset_fixture; q -c "update public.lessons set completed=true, completed_at=(scheduled_date::timestamptz + interval '12 hours'), is_backfill=true, scheduled_source='wizard_create' where id='$(L 5)'; update public.curriculum_goals set current_lesson=5 where id='$G'"; }
reopen(){ q -c "$AS select public.reopen_lesson('$1','$DAY')::text" | tail -1; }
row(){ q -c "select (case when completed then 'done' else 'open' end)||'/'||(case when queue_pinned then 'pinned' else 'unpinned' end)||'/'||coalesce(scheduled_source,'')||'/'||scheduled_date::text||'/min='||coalesce(minutes_spent::text,'null')||'/ptr='||(select current_lesson from public.curriculum_goals where id='$G') from public.lessons where id='$1'"; }
reset_reopen
check "T16 reopen last history lesson"  "$(reopen "$(L 5)")   $(row "$(L 5)")" "\"made_up\".*open/pinned/reopened/$DAY/min=30/ptr=5"
check "T17 reopen an earlier lesson"    "$(reopen "$(L 3)")   $(row "$(L 3)")" "\"made_up\".*open/pinned/reopened/$DAY/min=30/ptr=5"
q -c "update public.lessons set completed=true, completed_at=now() where id='$(L 6)'"
check "T18 reopen inside the live queue" "$(reopen "$(L 6)")   $(row "$(L 6)")" '"requeued".*open/unpinned/manual_uncomplete/.*/ptr=5'
check "T19 reopen an unfinished lesson" "$(reopen "$(L 7)")" '"not_completed"'
check "T20 reopen: not the owner"       "$(q -c "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$OTHER\"}',false); select public.reopen_lesson('$(L 4)','$DAY')::text" | tail -1)" 'not_owner'
check "T21 reopen: anon cannot execute" "$(psql -X -q -At -d br -c "set role anon; select public.reopen_lesson('$(L 4)','$DAY')" 2>&1 | grep -oE 'permission denied[^\"]*' | head -1)" 'permission denied'
# The make-up write fails: nothing changes, the lesson is still ticked.
reset_reopen
q -c "create function public._boom2() returns trigger language plpgsql as \$b\$ begin if new.scheduled_source = 'reopened' then raise exception 'injected make-up failure'; end if; return new; end \$b\$; create trigger _boom2 before update on public.lessons for each row execute function public._boom2();"
check "T22 make-up write fails"         "$(reopen "$(L 5)")   $(row "$(L 5)")" 'injected make-up failure.*"failed".*done/unpinned/wizard_create/.*/min=30/ptr=5'
q -c "drop trigger _boom2 on public.lessons; drop function public._boom2();"

pg_ctl -D "$R/data" stop -m fast >/dev/null
echo "failures: $FAILS"; exit $FAILS
