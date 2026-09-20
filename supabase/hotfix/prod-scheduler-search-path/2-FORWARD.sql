-- PRODUCTION HOTFIX: put pg_temp LAST on the four live scheduler functions.
--
-- WHY: each is SECURITY DEFINER and runs as postgres. Their search_path does
-- not list pg_temp, so PostgreSQL searches the CALLER's temporary schema first
-- for relation names. Any authenticated family can `create temp table lessons`
-- and the function body then reads that table with postgres's privileges.
--
-- WHAT THIS IS NOT: it does not add schedule_commit, the delete RPCs, or any
-- Stage 2 behaviour. Bodies are untouched. This is ALTER ... SET only, so
-- behaviour, owner, grants and signatures are unchanged.
--
-- The existing schema list is PRESERVED and pg_temp appended. Position matters:
-- pg_temp first is as vulnerable as pg_temp absent.

begin;

alter function public.schedule_preview(text, jsonb)
  set search_path = public, pg_temp;

alter function public.schedule_state_version(uuid[])
  set search_path = public, pg_temp;

alter function public.schedule_seal_proposal(text, uuid[], jsonb, boolean, boolean)
  set search_path = public, extensions, pg_temp;

alter function public.schedule_commit_dry_run(uuid, text, uuid[], jsonb, boolean, boolean, text)
  set search_path = public, extensions, pg_temp;

-- Refuse to commit unless all four now end with pg_temp.
do $$
declare
  bad int;
begin
  select count(*) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('schedule_preview','schedule_state_version',
                      'schedule_seal_proposal','schedule_commit_dry_run')
    and coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '') !~ 'pg_temp\s*$';
  if bad > 0 then
    raise exception 'hotfix incomplete: % function(s) still lack a trailing pg_temp', bad;
  end if;
end $$;

commit;
