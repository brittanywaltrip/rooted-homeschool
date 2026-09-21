-- Rollback for staging-containment-ledger-correction.sql. Staging ONLY.
--
-- Removes exactly the five rows that script added (marker created_by =
-- 'ledger-correction-2026-09-21' AND one of the five production versions).
-- Deletes no historical entry: the original staging rows were never touched.
-- Leaves the backup table in place; drop it by hand once it is no longer
-- wanted:  drop table supabase_migrations.schema_migrations_backup_20260921;

begin;

do $$
declare v_n int;
begin
  select count(*) into v_n from supabase_migrations.schema_migrations
   where created_by = 'ledger-correction-2026-09-21'
     and version in ('20260921200005','20260921200028','20260921210738','20260921210801','20260921210815');
  if v_n <> 5 then
    raise exception 'ABORT: expected the 5 correction rows, found %', v_n;
  end if;
end $$;

delete from supabase_migrations.schema_migrations
 where created_by = 'ledger-correction-2026-09-21'
   and version in ('20260921200005','20260921200028','20260921210738','20260921210801','20260921210815');

-- Every row that existed before the correction must still be there,
-- unchanged, and none of the five correction rows may remain. Rows added by
-- later, unrelated migrations are allowed.
do $$
declare v_missing int; v_left int;
begin
  select count(*) into v_missing from (
    select version, name, statements from supabase_migrations.schema_migrations_backup_20260921
    except
    select version, name, statements from supabase_migrations.schema_migrations
  ) d;
  select count(*) into v_left from supabase_migrations.schema_migrations
   where created_by = 'ledger-correction-2026-09-21';
  if v_missing <> 0 or v_left <> 0 then
    raise exception 'ABORT: rollback check failed (backup rows missing %, correction rows left %)', v_missing, v_left;
  end if;
end $$;

commit;
