-- PRODUCTION PREFLIGHT. Read-only. Run this and read the output BEFORE 2-FORWARD.sql.
-- Nothing here writes. Safe to run against production at any time.

\echo '== 1. Am I on production? Expect ref gvkbegvvmhcrmxdorctk =='
select current_database(),
       current_setting('server_version') as pg_version,
       (select system_identifier from pg_control_system()) as system_identifier;

\echo '== 2. The functions this hotfix will alter, and their CURRENT search_path =='
\echo '   Expect exactly 4 rows, each cfg lacking pg_temp. A different count means STOP.'
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_userbyid(p.proowner) as owner,
       case when p.prosecdef then 'DEFINER' else 'INVOKER' end as security,
       coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '(none)') as cfg
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('schedule_preview','schedule_state_version',
                    'schedule_seal_proposal','schedule_commit_dry_run')
order by p.proname;

\echo '== 3. EVERY security-definer function in public whose path lacks pg_temp =='
\echo '   Anything here beyond the 4 above is OUT OF SCOPE for this hotfix. Report, do not fix.'
select p.proname,
       coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '(none)') as cfg
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '') !~ 'pg_temp\s*$'
  -- An EMPTY search_path ("") is the strictest form, not a weakness: nothing is
  -- resolved unqualified, so there is nothing for a temp object to shadow.
  -- get_user_id_by_email is configured that way and must not be "fixed".
  and coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '') <> 'search_path=""'
order by p.proname;

\echo '== 4. Exact current definition, to compare byte-for-byte after rollback =='
select p.proname, md5(pg_get_functiondef(p.oid)) as definition_md5
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('schedule_preview','schedule_state_version',
                    'schedule_seal_proposal','schedule_commit_dry_run')
order by p.proname;

\echo '== 5. Is anything mid-flight? A non-zero count means wait. =='
select count(*) as active_scheduler_calls
from pg_stat_activity
where state = 'active' and query ilike '%schedule\_%' and pid <> pg_backend_pid();
