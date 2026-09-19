#!/usr/bin/env bash
# The actual deadlock cycle, constructed rather than hoped for.
#
#   B: BEGIN; insert a vacation  -> holds FOR KEY SHARE on auth.users
#      ... waits ...
#      insert a lesson under G   -> needs FOR KEY SHARE on curriculum_goals
#   A: schedule_commit on G
#
# With auth.users locked LAST, A takes curriculum_goals FOR UPDATE and then
# blocks on auth.users, which B holds; B then blocks on curriculum_goals, which
# A holds. Cycle.
#
# With auth.users locked FIRST, A blocks on auth.users while holding nothing,
# B finishes and commits, A proceeds. No cycle.
set -uo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
D="postgresql://postgres@127.0.0.1:55432/atomic?sslmode=disable"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
U=11111111-1111-4111-8111-111111111111
C=cccccccc-0000-4000-8000-000000000001
G=aaaaaaaa-0000-4000-8000-0000000000dd
# Rebuild the goal's rows so "did the refused save write anything?" is answered
# against this run's fixture and not a row an earlier test already removed.
psql -q -d "$D" -c "delete from schedule_transactions; delete from schedule_proposals;
  delete from vacation_blocks where user_id='$U'; delete from lessons where curriculum_goal_id='$G';
  insert into lessons (id,user_id,child_id,curriculum_goal_id,title,date,lesson_number,queue_position)
  select ('dead0000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'$U','$C','$G','L'||n,
         date '2027-05-01'+n,n,n from generate_series(1,4) n;" >/dev/null
P=$(uuidgen | tr 'A-Z' 'a-z')
psql -q -d "$D" -c "
select set_config('request.jwt.claim.sub','$U',false);
insert into schedule_proposals (id,user_id,action,goal_ids,proposal_hash,canonical_form,state_version,confirmation_facts,placement_count)
values ('$P','$U','rebuild',array['$G']::uuid[],repeat('a',64),'{}',public.schedule_state_version(array['$G']::uuid[]),'{}'::jsonb,0);" >/dev/null

# B first: take auth.users key-share, wait, then need the goal.
( psql -X -tA -d "$D" > "$OUT/b" 2>&1 <<SQL
begin;
insert into vacation_blocks (user_id,start_date,end_date) values ('$U','2027-11-01','2027-11-05');
select pg_sleep(2.5);
insert into lessons (id,user_id,child_id,curriculum_goal_id,title,date,lesson_number,queue_position)
values (gen_random_uuid(),'$U','$C','$G','deadlock probe','2027-11-09',88,88);
commit;
SQL
) & BPID=$!
sleep 1.0
# A second: the save.
( psql -X -tA -d "$D" > "$OUT/a" 2>&1 <<SQL
set role authenticated; select set_config('request.jwt.claim.sub','$U',false);
begin;
select public.schedule_commit('$P'::uuid,'{}'::jsonb,'[]'::jsonb,
  array['dead0000-0000-4000-8000-000000000003']::uuid[],'[]'::jsonb,'{}'::jsonb,'deadlock-probe-key-1');
commit;
SQL
) & APID=$!
wait $BPID; wait $APID
if grep -qi "deadlock detected" "$OUT/a" "$OUT/b"; then
  echo "  DEADLOCK  $(grep -hi 'deadlock detected' "$OUT/a" "$OUT/b" | head -1 | cut -c1-70)"
  exit 2
fi
# Success is "no cycle, and each transaction reached a definite end". The save
# committing and the save REFUSING on the stale path are both correct: B's
# vacation and lesson genuinely changed the state the proposal was sealed
# against, so refusing is the contract working. What must not happen is a
# deadlock, or a save that half-wrote.
COMMITTED=$(psql -X -tA -d "$D" -c "select count(*) from schedule_transactions where idempotency_key='deadlock-probe-key-1';")
PROBE=$(psql -X -tA -d "$D" -c "select count(*) from lessons where title='deadlock probe';")
REFUSED=$(grep -ci "changed since this proposal" "$OUT/a" || true)
if [ "$PROBE" != "1" ]; then echo "  INCOMPLETE: the concurrent insert did not land"; exit 3; fi
if [ "$COMMITTED" = "1" ]; then
  echo "  NO DEADLOCK: the concurrent insert landed and the save committed"; exit 0
fi
if [ "$REFUSED" -ge 1 ]; then
  echo "  NO DEADLOCK: the concurrent insert landed and the save refused on the stale path (correct)"
  DELETED=$(psql -X -tA -d "$D" -c "select count(*) from lessons where id='dead0000-0000-4000-8000-000000000003';")
  if [ "$DELETED" = "1" ]; then
    echo "  and the refused save wrote nothing (its delete target is still present)"
    exit 0
  fi
  # A refused save that had already deleted a row is the exact failure this
  # whole change exists to prevent. It printed a warning and exited 0, which
  # made the harness report success on the one outcome that matters most.
  echo "  FAIL  the refused save had ALREADY DELETED a row"
  exit 4
fi
echo "  INCOMPLETE: save=$COMMITTED probe=$PROBE"; exit 3
