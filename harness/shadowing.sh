#!/usr/bin/env bash
# ============================================================================
# Temporary-object shadowing: the mechanism, proved in both directions.
# ============================================================================
# When pg_temp is not listed in search_path, PostgreSQL searches the session's
# TEMPORARY schema FIRST for relation names. Any authenticated caller can
# create a temp table. So a SECURITY DEFINER function that says
# `set search_path = public` and reads `lessons` can be made to read the
# CALLER'S temp table named `lessons` -- while running as postgres.
#
# This test fails under the old definition and passes after hardening, which is
# the only way to know the hardening did anything.
set -uo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
D="${ROOTED_TEST_DSN:-postgresql://postgres@127.0.0.1:55432/atomic?sslmode=disable}"
FAILS=0
pass() { printf "  PASS  %s\n" "$*"; }
fail() { FAILS=$((FAILS+1)); printf "  FAIL  %s\n" "$*"; }

psql -qX -d "$D" >/dev/null 2>&1 <<'SQL'
drop schema if exists shadowtest cascade;
create schema shadowtest;
create table shadowtest.secrets(v text);
insert into shadowtest.secrets values ('REAL');
create or replace function public.shadow_victim() returns text
language plpgsql security definer set search_path = shadowtest
as $f$ declare r text; begin select v into r from secrets limit 1; return r; end $f$;
SQL

# ── 1. the vulnerability, under the OLD shape ──────────────────────────────
OUT=$(psql -X -tA -d "$D" -c "
  create temp table secrets(v text);
  insert into secrets values ('SHADOWED');
  select public.shadow_victim();" 2>&1 | tail -1)
[ "$OUT" = "SHADOWED" ] \
  && pass "without pg_temp: a caller's temp table SHADOWS the real one (the hole is real)" \
  || fail "expected the shadow to win under the old shape, got: $OUT"

# ── 2. the fix ─────────────────────────────────────────────────────────────
psql -qX -d "$D" -c "alter function public.shadow_victim() set search_path = shadowtest, pg_temp;" >/dev/null
OUT=$(psql -X -tA -d "$D" -c "
  create temp table secrets(v text);
  insert into secrets values ('SHADOWED');
  select public.shadow_victim();" 2>&1 | tail -1)
[ "$OUT" = "REAL" ] \
  && pass "with pg_temp LAST: the real table wins" \
  || fail "expected the real table to win after hardening, got: $OUT"

# ── 3. position matters, not mere presence ─────────────────────────────────
psql -qX -d "$D" -c "alter function public.shadow_victim() set search_path = pg_temp, shadowtest;" >/dev/null
OUT=$(psql -X -tA -d "$D" -c "
  create temp table secrets(v text);
  insert into secrets values ('SHADOWED');
  select public.shadow_victim();" 2>&1 | tail -1)
[ "$OUT" = "SHADOWED" ] \
  && pass "pg_temp listed FIRST is still vulnerable: it must be LAST, not merely present" \
  || fail "expected pg_temp-first to be shadowed, got: $OUT"

psql -qX -d "$D" -c "drop function public.shadow_victim(); drop schema shadowtest cascade;" >/dev/null 2>&1

# ── 4. every scheduler function present here is configured correctly ───────
BAD=$(psql -X -tA -d "$D" -c "
  select string_agg(p.proname || ' [' || coalesce(array_to_string(p.proconfig,','),'NONE') || ']', ', ')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
   where (p.proname like 'schedule%' or p.proname like 'delete_lesson%'
          or p.proname in ('delete_year_lessons','delete_goal_pending_lessons',
                           'recompute_curriculum_current_lesson','move_lesson_to_date',
                           'lessons_recompute_current_lesson_trg','curriculum_goals_cleanup_orphans_trg',
                           'lessons_fill_child_id_from_goal','block_lesson_goal_detach',
                           'lessons_block_server_side_completion','enforce_curriculum_school_days_nonempty',
                           'set_lessons_updated_at','enforce_lesson_child_matches_goal'))
     and coalesce(array_to_string(p.proconfig,','),'') !~ 'pg_temp\$';" 2>&1 | tail -1)
[ -z "$BAD" ] \
  && pass "every scheduler function in this database ends its search_path with pg_temp" \
  || fail "these do NOT end with pg_temp: $BAD"

echo
[ "$FAILS" -eq 0 ] && { echo "  shadowing: all assertions passed"; exit 0; }
echo "  shadowing: $FAILS assertion(s) FAILED"; exit 1
