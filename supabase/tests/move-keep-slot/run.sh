#!/bin/bash
# Rehearses public.move_lesson_keep_slot and public.restore_queue_book_order on
# a THROWAWAY local cluster.
#   REHEARSAL_DIR=/some/scratch supabase/tests/move-keep-slot/run.sh [migration.sql]
# Synthetic data only. Prints one line per case; every line should read PASS.
# Nothing here touches a real database.
set -u
S="$(cd "$(dirname "$0")" && pwd)"; M="$(cd "$S/../.." && pwd)"
MIG="${1:-$(ls "$M"/migrations/*move_lesson_keep_slot.sql | sort | tail -1)}"
R="${REHEARSAL_DIR:?set REHEARSAL_DIR}"; PORT="${REHEARSAL_PORT:-56913}"
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
rm -rf "$R/data"; initdb -D "$R/data" -U postgres -A trust >/dev/null
pg_ctl -D "$R/data" -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories='' -p $PORT" -l "$R/pg.log" start -w >/dev/null
trap 'pg_ctl -D "$R/data" stop -m fast >/dev/null' EXIT
q(){ psql -X -q -At -v ON_ERROR_STOP=1 -d mk "$@"; }
psql -X -q -c "create database mk" postgres
q -f "$M/tests/builder-rebuild/stub.sql" >/dev/null
q -f "$S/stub-extra.sql" >/dev/null
q -f "$MIG" >/dev/null && echo "migration applied: $(basename "$MIG")"
FAILS=0
check(){ if echo "$2" | grep -Eq -- "$3"; then echo "PASS $1 -> $2"; else echo "FAIL $1 -> $2   (expected /$3/)"; FAILS=$((FAILS+1)); fi; }

U=bbbbbbbb-0000-4000-8000-000000000001; OTHER=bbbbbbbb-0000-4000-8000-000000000002; G=aaaaaaaa-0000-4000-8000-000000000001
DAY=$(q -c "select (now() at time zone 'UTC')::date")
AS="set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\",\"role\":\"authenticated\"}',false);"
L(){ printf 'cccccccc-0000-4000-8000-%012d' "$1"; }
d(){ q -c "select (date '$DAY' + $1)::text"; }

# 20 lessons, 1/day every day (independent of the weekday this runs on).
# 1..3 done (dated the three days before today), 4 is today, 5.. follow.
reset_fixture(){ q -c "
  delete from public.lessons; delete from public.curriculum_goals;
  insert into public.curriculum_goals (id,user_id,total_lessons,current_lesson,start_at_lesson,lessons_per_day,school_days,start_date)
    values ('$G','$U',20,3,1,1,array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],date '$DAY' - 3);
  insert into public.lessons (id,user_id,curriculum_goal_id,lesson_number,queue_position,title,scheduled_date,date,scheduled_source,completed,completed_at)
  select ('cccccccc-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'$U','$G',n,n,'L'||n,
         date '$DAY' - 4 + n, date '$DAY' - 4 + n, 'wizard_create', n<=3,
         case when n<=3 then (date '$DAY' - 4 + n)::timestamptz + interval '12 hours' end
    from generate_series(1,20) n;"; }
row(){ q -c "select format('q%s %s pin=%s %s', queue_position, scheduled_date, queue_pinned, scheduled_source) from public.lessons where id='$(L "$1")'"; }
slots(){ q -c "select string_agg(lesson_number||':'||queue_position, ' ' order by lesson_number) from public.lessons where curriculum_goal_id='$G'"; }
call(){ q -c "$AS select public.move_lesson_keep_slot('$(L "$1")', date '$DAY' + $2, date '$DAY', $3)::text" | tail -1; }
qa(){ q -c "$AS $1" | tail -1; }

T3=$(d 3); T0=$(d 0); T1=$(d 1); T2=$(d 2)

# ── Just this lesson: lesson 4 (today) to today+3 ───────────────────────────
reset_fixture
BEFORE=$(slots)
R1=$(call 4 3 true)
check "just-this returns moved"                "$R1" '"status": "moved"'
check "just-this holds lessons 5, 6, 7"        "$(q -c "select string_agg((e->>'lesson_number'), ',' order by (e->>'queue_position')::int) from jsonb_array_elements('$R1'::jsonb->'held') e")" '^5,6,7$'
check "moved lesson keeps its slot, pinned"    "$(row 4)" "^q4 $T3 pin=t plan_move$"
check "lesson 5 held on its own day"           "$(row 5)" "^q5 $T1 pin=t plan_hold$"
check "lesson 7 held on the target day"        "$(row 7)" "^q7 $T3 pin=t plan_hold$"
check "lesson 8 (after the target) untouched"  "$(row 8)" "^q8 $(d 4) pin=f wizard_create$"
check "no queue_position changed anywhere"     "$(slots)" "^${BEFORE}$"
check "pointer unchanged"                      "$(q -c "select current_lesson from public.curriculum_goals where id='$G'")" '^3$'
check "undo data: moved prior state returned"  "$(q -c "select '$R1'::jsonb->'moved'->>'scheduled_date'")" "^$T0$"

# ── Undo is a plain restore of the returned rows ───────────────────────────
q -c "$AS
  update public.lessons l set queue_pinned = (e->>'queue_pinned')::boolean, scheduled_source = e->>'scheduled_source'
    from jsonb_array_elements('$R1'::jsonb->'held') e where l.id = (e->>'id')::uuid;
  update public.lessons set scheduled_date = date '$T0', date = date '$T0', queue_pinned = false, scheduled_source = 'wizard_create'
   where id = '$(L 4)';" >/dev/null
check "undo restores lesson 4"                 "$(row 4)" "^q4 $T0 pin=f wizard_create$"
check "undo restores lesson 6"                 "$(row 6)" "^q6 $T2 pin=f wizard_create$"

# ── What is never held ─────────────────────────────────────────────────────
reset_fixture
q -c "update public.lessons set skipped = true, scheduled_date = null where id='$(L 5)';
      update public.lessons set queue_pinned = true, scheduled_source = 'plan_move', scheduled_date = date '$T2' where id='$(L 6)';
      update public.lessons set scheduled_date = date '$DAY' - 1 where id='$(L 7)';" >/dev/null
R2=$(call 4 3 true)
check "skipped, pinned and overdue not held"   "$(q -c "select coalesce(string_agg((e->>'lesson_number'), ','), '-') from jsonb_array_elements('$R2'::jsonb->'held') e")" '^8$|^-$'
check "skipped lesson 5 untouched"             "$(q -c "select format('%s %s', skipped, queue_pinned) from public.lessons where id='$(L 5)'")" '^t f$'
check "already-pinned lesson 6 keeps its source" "$(row 6)" "^q6 $T2 pin=t plan_move$"
check "overdue lesson 7 not held"              "$(row 7)" "pin=f wizard_create$"

# ── Shift all: only the moved lesson changes here ──────────────────────────
reset_fixture
R3=$(call 4 3 false)
check "shift-all mode holds nothing"           "$(q -c "select jsonb_array_length('$R3'::jsonb->'held')")" '^0$'
check "shift-all moved lesson keeps its slot"  "$(row 4)" "^q4 $T3 pin=t plan_move$"
check "shift-all leaves lesson 5 for the respread" "$(row 5)" "^q5 $T1 pin=f wizard_create$"

# ── Refusals, each writing nothing ─────────────────────────────────────────
reset_fixture
check "an earlier day is refused"              "$(call 5 0 true)" 'not_later'
check "the same day is refused"                "$(call 5 1 true)" 'not_later'
check "a completed lesson is refused"          "$(call 2 5 true)" '"reason": "completed"'
check "refusals wrote nothing"                 "$(row 5)" "^q5 $T1 pin=f wizard_create$"
check "a far local day is refused"             "$(qa "select public.move_lesson_keep_slot('$(L 4)', date '$DAY' + 3, date '$DAY' + 5, true)::text")" 'local_day'
check "another family's lesson is refused"     "$(q -c "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$OTHER\",\"role\":\"authenticated\"}',false); select public.move_lesson_keep_slot('$(L 4)', date '$DAY' + 3, date '$DAY', true)::text" | tail -1)" 'not_owner'
check "anon cannot execute it"                 "$(q -c "set role anon; select public.move_lesson_keep_slot('$(L 4)', date '$DAY' + 3, date '$DAY', true)" 2>&1)" 'permission denied'

# ── A make-up holds nothing ────────────────────────────────────────────────
reset_fixture
q -c "update public.lessons set completed = false, completed_at = null, queue_pinned = true, scheduled_source = 'reopened', scheduled_date = date '$T0' where id='$(L 2)';" >/dev/null
check "make-up moves and holds nothing"        "$(q -c "select jsonb_array_length(('$(call 2 3 true)')::jsonb->'held')")" '^0$'

# ── restore_queue_book_order: the family whose lesson 6 fell behind ─────────
# Lesson 5 was moved past lesson 6 (slots 6 and 5), then completed in slot 6,
# so the pointer is 6 and lesson 6 sits unfinished behind it.
reset_fixture
q -c "update public.lessons set queue_position = -5 where id='$(L 5)';
      update public.lessons set queue_position = 5 where id='$(L 6)';
      update public.lessons set queue_position = 6 where id='$(L 5)';
      update public.lessons set completed = true, completed_at = now() where id in ('$(L 4)','$(L 5)');" >/dev/null
DATES_BEFORE=$(q -c "select string_agg(lesson_number||':'||coalesce(scheduled_date::text,'-'), ' ' order by lesson_number) from public.lessons")
check "fixture: the completion unscheduled lesson 6 (as on 2026-08-25)" "$(q -c "select scheduled_date is null from public.lessons where id='$(L 6)'")" '^t$'
check "fixture: pointer stuck at 6"            "$(q -c "select current_lesson from public.curriculum_goals where id='$G'")" '^6$'
R4=$(qa "select public.restore_queue_book_order('$G', date '$DAY')::text")
check "book order restored"                    "$R4" '"status": "restored"'
check "lesson 5 in slot 5, lesson 6 in slot 6" "$(q -c "select string_agg(lesson_number||':'||queue_position, ' ' order by lesson_number) from public.lessons where lesson_number in (5,6)")" '^5:5 6:6$'
check "pointer now 5, lesson 6 is next"        "$(q -c "select current_lesson from public.curriculum_goals where id='$G'")" '^5$'
check "reordering changed no date"             "$(q -c "select string_agg(lesson_number||':'||coalesce(scheduled_date::text,'-'), ' ' order by lesson_number) from public.lessons")" "^${DATES_BEFORE}$"
check "second call is a no-op"                 "$(qa "select public.restore_queue_book_order('$G', date '$DAY')::text")" '"status": "in_order"'
check "another family cannot reorder it"       "$(q -c "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$OTHER\",\"role\":\"authenticated\"}',false); select public.restore_queue_book_order('$G', date '$DAY')::text" | tail -1)" 'not_owner'

echo "FAILS=$FAILS"
[ "$FAILS" -eq 0 ]
