-- Proves the hole is real, then proves the hotfix closes it.
--
-- Runs entirely inside ONE transaction that ROLLS BACK. It creates a temp
-- table and a probe function; it never writes to any application table.
-- Safe to run against production BEFORE the hotfix (it will report VULNERABLE)
-- and AFTER (it will report SAFE).
--
--   psql "$PROD_URL" -f 4-SHADOWING-TEST.sql

begin;

-- A probe that mimics the unhardened shape: SECURITY DEFINER, no pg_temp.
create function pg_temp.probe_unhardened() returns bigint
  language sql security definer set search_path = public as
$$ select count(*) from lessons $$;

-- The hardened shape, for contrast.
create function pg_temp.probe_hardened() returns bigint
  language sql security definer set search_path = public, pg_temp as
$$ select count(*) from lessons $$;

-- The attack: a caller-owned table that shadows public.lessons by name.
create temp table lessons (id uuid);
insert into lessons (id) values (gen_random_uuid()), (gen_random_uuid());

\echo ''
\echo '== real public.lessons row count (the truth) =='
select count(*) as real_rows from public.lessons;

\echo '== what a NO-pg_temp definer function sees =='
\echo '   If this equals 2, it read the ATTACKER table: VULNERABLE.'
select pg_temp.probe_unhardened() as unhardened_sees;

\echo '== what a pg_temp-LAST definer function sees =='
\echo '   This must equal the real count: SAFE.'
select pg_temp.probe_hardened() as hardened_sees;

\echo '== verdict for the four live functions =='
select p.proname,
       coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '(none)') as cfg,
       case when coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '')
                 ~ 'pg_temp\s*$'
            then 'SAFE' else 'VULNERABLE' end as verdict
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('schedule_preview','schedule_state_version',
                    'schedule_seal_proposal','schedule_commit_dry_run')
order by p.proname;

rollback;
