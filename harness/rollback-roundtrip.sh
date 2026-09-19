#!/usr/bin/env bash
# Blocker B: prove the 235000 rollback restores exactly what 230000 left.
#
# Capture pg_get_functiondef after the forward chain up to 230000, apply
# 235000, apply its rollback, capture again, and diff. Byte equality or it is
# not a rollback.
set -uo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
M=/tmp/atomic-commit/supabase/migrations
R=/tmp/atomic-commit/supabase/rollbacks
psql -q -d "postgresql://postgres@127.0.0.1:55432/postgres?sslmode=disable" \
  -c "drop database if exists rbtest with (force);" -c "create database rbtest;" >/dev/null
D="postgresql://postgres@127.0.0.1:55432/rbtest?sslmode=disable"
S=/private/tmp/claude-501/-Users-brittanywaltrip/4a7a796e-cec0-4f82-a59f-a0f12c5ca1d7/scratchpad
psql -q -d "$D" -v ON_ERROR_STOP=1 -f "$S/schema.sql"   >/dev/null 2>&1
psql -q -d "$D" -v ON_ERROR_STOP=1 -f "$S/triggers.sql" >/dev/null 2>&1
psql -q -d "$D" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create or replace function auth.uid() returns uuid language sql stable as \$\$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$\$;
create table if not exists public.vacation_blocks (id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade, start_date date, end_date date);
alter table public.school_years add column if not exists user_id uuid;
alter table public.subjects add column if not exists user_id uuid;
SQL
for m in 20260919013700_schedule_transactions_and_preview 20260919013822_schedule_state_version_fix_owner_lookup \
         20260919015230_schedule_proposals_seal 20260919015417_schedule_seal_proposal_explicit_missing_lesson_id \
         20260919021146_schedule_commit_dry_run; do
  psql -q -d "$D" -f "$M/$m.sql" >/dev/null 2>&1
done
sed '/create type actor_type_t/,/^$/d' "$M/20260919021050_schedule_transactions_actor_ready.sql" | psql -q -d "$D" >/dev/null 2>&1
psql -q -d "$D" -v ON_ERROR_STOP=1 -f "$M/20260919230000_schedule_commit_atomic.sql" >/dev/null 2>&1

BEFORE=$(psql -X -tA -d "$D" -c "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='schedule_commit';")
echo "  captured BEFORE: $(printf '%s' "$BEFORE" | wc -c | tr -d ' ') bytes, $(psql -X -tA -d "$D" -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='schedule_commit';") definition(s)"

psql -q -d "$D" -v ON_ERROR_STOP=1 -f "$M/20260919233000_schedule_state_version_title.sql" >/dev/null 2>&1
psql -q -d "$D" -v ON_ERROR_STOP=1 -f "$M/20260919235000_schedule_commit_lesson_updates.sql" >/dev/null 2>&1
echo "  after FORWARD:   $(psql -X -tA -d "$D" -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='schedule_commit';") definition(s)"

psql -q -d "$D" -v ON_ERROR_STOP=1 -f "$R/20260919235000_schedule_commit_lesson_updates_ROLLBACK.sql" >/dev/null 2>&1
AFTER=$(psql -X -tA -d "$D" -c "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='schedule_commit';")
N=$(psql -X -tA -d "$D" -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='schedule_commit';")
echo "  after ROLLBACK:  $(printf '%s' "$AFTER" | wc -c | tr -d ' ') bytes, $N definition(s)"

if [ "$N" != "1" ]; then echo "  FAIL  expected exactly one schedule_commit after rollback, found $N"; exit 1; fi
if [ "$BEFORE" = "$AFTER" ]; then echo "  PASS  pg_get_functiondef is byte-identical before the forward migration and after its rollback"; else
  echo "  FAIL  the rollback did not restore the preceding definition"; diff <(printf '%s' "$BEFORE") <(printf '%s' "$AFTER") | head -6; exit 1; fi
