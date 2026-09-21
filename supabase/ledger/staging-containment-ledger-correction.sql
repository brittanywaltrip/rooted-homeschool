-- staging-containment-ledger-correction: PREPARED, NOT EXECUTED.
-- Target: rooted-staging ONLY (cvgqovweybggrqakhdtd). Never production.
--
-- WHY
-- The five containment migrations were applied to staging and production
-- separately, so each has two ledger versions. The repo filenames carry the
-- PRODUCTION versions (docs/MIGRATION-LEDGER-CONTAINMENT.md). A CLI comparison
-- of local filenames against the staging ledger therefore proposes all five
-- for application again (read-only check, 2026-09-21). Re-running them one at
-- a time is not harmless: 20260921210738 alone restores the block without its
-- intent check, and 20260921210801 alone drops the session scope.
--
-- WHAT THIS DOES
-- Adds five rows to supabase_migrations.schema_migrations on staging, one per
-- migration, at the PRODUCTION version, so the staging ledger also records the
-- filename versions as applied. It is what `supabase migration repair --status
-- applied <versions>` does, written out so every value is visible:
--   * version    : the production version (the filename)
--   * name       : the same name
--   * statements : COPIED from the existing staging row for that name, i.e.
--                  exactly the SQL staging executed
--   * created_by : a marker, so the rollback can find these five rows only
-- It re-runs NO migration SQL, deletes nothing, and keeps the original
-- staging rows (20260921172242, ...174221, ...174245, ...183953, ...194104).
--
-- SQL EQUIVALENCE (verified read-only 2026-09-21)
-- After removing `--` comments and all whitespace, the md5 of the SQL is
-- identical in all three places: the staging ledger row, the production
-- ledger row and the repo file.
--   rooted_private_schema_prerequisite   32ed6d7cf83c1078e835cf6df4dedb80
--   lesson_date_change_audit             d225ec3d2013d3ec310ad2aec520d084
--   lessons_block_stale_resync           ff7f5f7b579716f7c41ba8599d5893cf
--   lessons_resync_parent_intent_window  3d9cb15882b9a2a46137b0e044102d0f
--   lessons_resync_intent_session_scope  dda223091c844ce5362e61ac9f02abcc
-- Byte-for-byte, staging and production recorded identical statements for
-- four of the five; the prerequisite differs in comment text only (staging
-- recorded an earlier wording). The repo files differ from both in comments
-- only (#82 added the ALREADY APPLIED header and renamed version references).
-- The verification block below re-checks the normalized hash at run time.
--
-- BACKUP
-- Step 1 copies the whole ledger to
-- supabase_migrations.schema_migrations_backup_20260921 before any insert,
-- inside the same transaction. The pre-change snapshot (122 rows, fingerprint
-- ea16b90f7542304c36d36dc8e9ed2b58) is committed next to this file as
-- staging-ledger-snapshot-2026-09-21.tsv. If the live fingerprint differs when
-- this runs, the script aborts: the ledger changed since it was prepared.
--
-- ROLLBACK: staging-containment-ledger-correction_ROLLBACK.sql
--
-- RUN: in one psql session or the Supabase SQL editor against staging, as a
-- single transaction. Confirm first:  select current_database(), inet_server_addr();
-- and that the project ref is cvgqovweybggrqakhdtd.

begin;

-- 0. Preflight. Abort on anything unexpected.
do $$
declare
  v_fp   text;
  v_n    int;
  v_have int;
  v_src  int;
begin
  -- Must be the staging database: production has the five prod versions and
  -- none of the staging ones.
  select count(*) into v_src from supabase_migrations.schema_migrations
   where version in ('20260921194104','20260921174245','20260921172242','20260921174221','20260921183953');
  if v_src <> 5 then
    raise exception 'ABORT: expected the 5 staging containment rows, found %. Wrong database?', v_src;
  end if;
  select count(*) into v_have from supabase_migrations.schema_migrations
   where version in ('20260921200005','20260921200028','20260921210738','20260921210801','20260921210815');
  if v_have <> 0 then
    raise exception 'ABORT: % of the production versions are already present', v_have;
  end if;
  select count(*), md5(string_agg(version || coalesce(name,'') || coalesce(md5(array_to_string(statements, E'\n')),'-'), ',' order by version))
    into v_n, v_fp from supabase_migrations.schema_migrations;
  if v_fp <> 'ea16b90f7542304c36d36dc8e9ed2b58' or v_n <> 122 then
    raise exception 'ABORT: ledger changed since preparation (rows %, fingerprint %)', v_n, v_fp;
  end if;
end $$;

-- 1. Backup.
create table supabase_migrations.schema_migrations_backup_20260921 as
  table supabase_migrations.schema_migrations;

-- 2. Record the production versions, statements copied from staging's own rows.
insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
select m.prod_version, s.name, s.statements, 'ledger-correction-2026-09-21'
  from (values
    ('20260921194104', '20260921200005', 'rooted_private_schema_prerequisite'),
    ('20260921174245', '20260921200028', 'lesson_date_change_audit'),
    ('20260921172242', '20260921210738', 'lessons_block_stale_resync'),
    ('20260921174221', '20260921210801', 'lessons_resync_parent_intent_window'),
    ('20260921183953', '20260921210815', 'lessons_resync_intent_session_scope')
  ) as m(staging_version, prod_version, name)
  join supabase_migrations.schema_migrations s
    on s.version = m.staging_version and s.name = m.name;

-- 3. Verify, then commit only if everything holds.
do $$
declare
  v_new    int;
  v_bad    int;
  v_total  int;
  v_backup int;
begin
  select count(*) into v_new from supabase_migrations.schema_migrations
   where created_by = 'ledger-correction-2026-09-21';
  -- Each new row's SQL, normalized, must equal the expected hash for its name.
  select count(*) into v_bad
    from supabase_migrations.schema_migrations r
    join (values
      ('20260921200005', 'rooted_private_schema_prerequisite',  '32ed6d7cf83c1078e835cf6df4dedb80'),
      ('20260921200028', 'lesson_date_change_audit',            'd225ec3d2013d3ec310ad2aec520d084'),
      ('20260921210738', 'lessons_block_stale_resync',          'ff7f5f7b579716f7c41ba8599d5893cf'),
      ('20260921210801', 'lessons_resync_parent_intent_window', '3d9cb15882b9a2a46137b0e044102d0f'),
      ('20260921210815', 'lessons_resync_intent_session_scope', 'dda223091c844ce5362e61ac9f02abcc')
    ) as e(version, name, sql_md5) on e.version = r.version
   where r.name <> e.name
      or md5(regexp_replace(regexp_replace(array_to_string(r.statements, E'\n'), '--[^\n]*', '', 'g'), '\s+', '', 'g')) <> e.sql_md5;
  select count(*) into v_total from supabase_migrations.schema_migrations;
  select count(*) into v_backup from supabase_migrations.schema_migrations_backup_20260921;
  if v_new <> 5 or v_bad <> 0 or v_total <> 127 or v_backup <> 122 then
    raise exception 'ABORT: verification failed (new %, mismatched %, total %, backup %)', v_new, v_bad, v_total, v_backup;
  end if;
end $$;

commit;
