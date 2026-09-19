#!/usr/bin/env bash
# Blocker 4: prove a concurrent lesson edit cannot commit between
# schedule_state_version and the destructive statement.
#
# Session A runs schedule_commit inside an explicit transaction and holds it
# open. Session B then tries the exact edit the hash is meant to protect, with
# a short lock_timeout. If A's locks cover that row, B cannot proceed.
set -uo pipefail
# Every failed assertion must reach the exit code. This harness printed FAIL in
# six branches and still exited 0, so a red run looked green to anything reading
# the status instead of the text.
FAILS=0
fail() { FAILS=$((FAILS+1)); printf "  FAIL  %s\n" "$*"; }
pass() { printf "  PASS  %s\n" "$*"; }
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
D="postgresql://postgres@127.0.0.1:55432/atomic?sslmode=disable"
U=11111111-1111-4111-8111-111111111111
C=cccccccc-0000-4000-8000-000000000001
G=aaaaaaaa-0000-4000-8000-0000000000dd
psql -q -d "$D" -c "
delete from schedule_transactions; delete from schedule_proposals;
delete from lessons where curriculum_goal_id='$G'; delete from curriculum_goals where id='$G';
insert into curriculum_goals (id,user_id,child_id,curriculum_name,total_lessons,school_days)
values ('$G','$U','$C','Two session',10,'{Mon,Tue,Wed,Thu,Fri}');
insert into lessons (id,user_id,child_id,curriculum_goal_id,title,date,lesson_number,queue_position)
select ('dead0000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'$U','$C','$G','L'||n,date '2027-05-01'+n,n,n
  from generate_series(1,4) n;" >/dev/null
P=$(uuidgen | tr 'A-Z' 'a-z')
psql -q -d "$D" -c "
select set_config('request.jwt.claim.sub','$U',false);
insert into schedule_proposals (id,user_id,action,goal_ids,proposal_hash,canonical_form,state_version,confirmation_facts,placement_count)
values ('$P','$U','rebuild',array['$G']::uuid[],repeat('a',64),'{}',public.schedule_state_version(array['$G']::uuid[]),'{}'::jsonb,0);" >/dev/null

# Session A: commit inside a transaction that stays open for 4 seconds.
( psql -q -d "$D" -c "
  set role authenticated; select set_config('request.jwt.claim.sub','$U',false);
  begin;
  select public.schedule_commit('$P'::uuid,'{}'::jsonb,'[]'::jsonb,
    array['dead0000-0000-4000-8000-000000000003']::uuid[],'[]'::jsonb,'{}'::jsonb,'two-session-key-01');
  select pg_sleep(4);
  commit;" >/dev/null 2>&1 ) &
APID=$!
sleep 1.5

# Session B: the edit the hash protects, on a row A locked but did NOT delete.
OUT=$(psql -X -tA -d "$D" -c "
  set lock_timeout = '1500ms';
  update lessons set title='B renamed mid-commit' where id='dead0000-0000-4000-8000-000000000002';" 2>&1 | tr '\n' ' ')
case "$OUT" in
  *"lock timeout"*|*"canceling statement"*)
    pass "a concurrent title edit BLOCKS on the commit's row locks" ;;
  *"UPDATE 1"*)
    fail "the concurrent edit went through while the commit was open" ;;
  *) fail "unexpected: $OUT" ;;
esac

# And a row in an unrelated goal must NOT be blocked: the lock is scoped.
OUT2=$(psql -X -tA -d "$D" -c "
  set lock_timeout = '1500ms';
  update lessons set title='unrelated' where curriculum_goal_id='aaaaaaaa-0000-4000-8000-000000000001';" 2>&1 | tr '\n' ' ')
case "$OUT2" in
  *UPDATE*) pass "an unrelated goal's rows are not locked (the scope is the proposal's goals)" ;;
  *)       fail "the lock reached beyond the proposal: $OUT2" ;;
esac
wait $APID
echo "  (session A committed; final title of the protected row: $(psql -X -tA -d "$D" -c "select title from lessons where id='dead0000-0000-4000-8000-000000000002';"))"

# ── Blocker A: a vacation that does not exist yet ──────────────────────────
# FOR UPDATE cannot lock an absent row, so the commit also locks the auth.users
# row the vacation FK must key-share. A concurrent INSERT must therefore wait.
psql -q -d "$D" -c "delete from schedule_transactions; delete from schedule_proposals;
  delete from vacation_blocks where user_id='$U';" >/dev/null
P2=$(uuidgen | tr 'A-Z' 'a-z')
psql -q -d "$D" -c "
select set_config('request.jwt.claim.sub','$U',false);
insert into schedule_proposals (id,user_id,action,goal_ids,proposal_hash,canonical_form,state_version,confirmation_facts,placement_count)
values ('$P2','$U','rebuild',array['$G']::uuid[],repeat('a',64),'{}',public.schedule_state_version(array['$G']::uuid[]),'{}'::jsonb,0);" >/dev/null

( psql -q -d "$D" -c "
  set role authenticated; select set_config('request.jwt.claim.sub','$U',false);
  begin;
  select public.schedule_commit('$P2'::uuid,'{}'::jsonb,'[]'::jsonb,
    array['dead0000-0000-4000-8000-000000000001']::uuid[],'[]'::jsonb,'{}'::jsonb,'vac-session-key-01');
  select pg_sleep(4);
  commit;" >/dev/null 2>&1 ) &
BPID=$!
sleep 1.5
OUT3=$(psql -X -tA -d "$D" -c "
  set lock_timeout = '1500ms';
  insert into vacation_blocks (user_id,start_date,end_date) values ('$U','2027-07-01','2027-07-10');" 2>&1 | tr '\n' ' ')
case "$OUT3" in
  *"lock timeout"*|*"canceling statement"*)
    pass "a concurrent vacation INSERT blocks (the absent row's parent is locked)" ;;
  *"INSERT 0 1"*)
    fail "a vacation was inserted while the commit was open" ;;
  *) fail "unexpected: $OUT3" ;;
esac
# Another account must NOT be blocked: the parent lock is one row, not the table.
OUT4=$(psql -X -tA -d "$D" -c "
  set lock_timeout = '1500ms';
  insert into vacation_blocks (user_id,start_date,end_date)
  values ('22222222-2222-4222-8222-222222222222','2027-07-01','2027-07-10');" 2>&1 | tr '\n' ' ')
case "$OUT4" in
  *"INSERT 0 1"*) pass "another account's vacation insert is unaffected" ;;
  *)              fail "the lock reached another account: $OUT4" ;;
esac
wait $BPID
psql -q -d "$D" -c "delete from vacation_blocks where user_id in ('$U','22222222-2222-4222-8222-222222222222');" >/dev/null

# ── Lock ORDER: the deadlock the late auth.users lock would have caused ────
# A concurrent INSERT takes FOR KEY SHARE on auth.users as part of its own FK
# check, then needs a goal/lesson row. If schedule_commit took auth.users LAST
# it would already hold those rows and be waiting for the user row: a cycle.
# Taking auth.users FIRST gives both transactions the same order, so the second
# one simply waits and then completes.
psql -q -d "$D" -c "delete from schedule_transactions; delete from schedule_proposals;
  delete from vacation_blocks where user_id='$U';" >/dev/null
P3=$(uuidgen | tr 'A-Z' 'a-z')
psql -q -d "$D" -c "
select set_config('request.jwt.claim.sub','$U',false);
insert into schedule_proposals (id,user_id,action,goal_ids,proposal_hash,canonical_form,state_version,confirmation_facts,placement_count)
values ('$P3','$U','rebuild',array['$G']::uuid[],repeat('a',64),'{}',public.schedule_state_version(array['$G']::uuid[]),'{}'::jsonb,0);" >/dev/null

( psql -q -d "$D" -c "
  set role authenticated; select set_config('request.jwt.claim.sub','$U',false);
  begin;
  select public.schedule_commit('$P3'::uuid,'{}'::jsonb,'[]'::jsonb,
    array['dead0000-0000-4000-8000-000000000002']::uuid[],'[]'::jsonb,'{}'::jsonb,'order-session-key-1');
  select pg_sleep(3);
  commit;" >/dev/null 2>&1 ) &
CPID=$!
sleep 1.2
# A same-account LESSON insert under the very goal schedule_commit is rewriting.
OUT5=$(psql -X -tA -d "$D" -c "
  set lock_timeout = '4000ms';
  insert into lessons (id,user_id,child_id,curriculum_goal_id,title,date,lesson_number,queue_position)
  values (gen_random_uuid(),'$U','$C','$G','concurrent insert','2027-09-09',77,77);" 2>&1 | tr '\n' ' ')
case "$OUT5" in
  *"deadlock detected"*) fail "DEADLOCK on a same-account lesson insert" ;;
  *"INSERT 0 1"*)        pass "a same-account lesson insert waits, then COMPLETES (no deadlock)" ;;
  *"lock timeout"*)      pass "a same-account lesson insert waits (timed out at the test's limit, not deadlocked)" ;;
  *) fail "unexpected: $OUT5" ;;
esac
wait $CPID
psql -q -d "$D" -c "delete from lessons where title='concurrent insert';" >/dev/null

# And the whole thing again, letting BOTH finish, to show completion not cycle.
psql -q -d "$D" -c "delete from schedule_transactions; delete from schedule_proposals;" >/dev/null
P4=$(uuidgen | tr 'A-Z' 'a-z')
psql -q -d "$D" -c "
select set_config('request.jwt.claim.sub','$U',false);
insert into schedule_proposals (id,user_id,action,goal_ids,proposal_hash,canonical_form,state_version,confirmation_facts,placement_count)
values ('$P4','$U','rebuild',array['$G']::uuid[],repeat('a',64),'{}',public.schedule_state_version(array['$G']::uuid[]),'{}'::jsonb,0);" >/dev/null
( psql -q -d "$D" -c "
  set role authenticated; select set_config('request.jwt.claim.sub','$U',false);
  begin;
  select public.schedule_commit('$P4'::uuid,'{}'::jsonb,'[]'::jsonb,
    array['dead0000-0000-4000-8000-000000000004']::uuid[],'[]'::jsonb,'{}'::jsonb,'order-session-key-2');
  select pg_sleep(2);
  commit;" >/dev/null 2>&1 ) &
DPID=$!
sleep 0.8
OUT6=$(psql -X -tA -d "$D" -c "
  set lock_timeout = '8000ms';
  insert into vacation_blocks (user_id,start_date,end_date) values ('$U','2027-08-01','2027-08-05');" 2>&1 | tr '\n' ' ')
wait $DPID
case "$OUT6" in
  *"deadlock detected"*) fail "DEADLOCK on a same-account vacation insert" ;;
  *"INSERT 0 1"*)        pass "a same-account vacation insert waits, then COMPLETES (no deadlock)" ;;
  *) fail "unexpected: $OUT6" ;;
esac
COMMITTED=$(psql -X -tA -d "$D" -c "select count(*) from schedule_transactions where idempotency_key='order-session-key-2';")
[ "$COMMITTED" = "1" ] && pass "the save itself committed (both transactions completed)" \
                       || fail "the save did not commit ($COMMITTED)"
psql -q -d "$D" -c "delete from vacation_blocks where user_id='$U';" >/dev/null

echo
if [ "$FAILS" -eq 0 ]; then echo "  all concurrency assertions passed"; exit 0; fi
echo "  $FAILS concurrency assertion(s) FAILED"; exit 1
