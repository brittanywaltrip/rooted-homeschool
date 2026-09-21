-- rooted_private_schema_prerequisite: the schema the containment audit and
-- block helpers live in, split out so the date-change audit
-- (20260921174245) can be applied on its own, before the block.
--
-- Applied to rooted-staging 2026-09-21 (a no-op there: 20260921172242 had
-- already created the schema). The audit migration does NOT create the
-- schema and fails with "schema rooted_private does not exist" on a database
-- that has neither this nor 20260921172242 (rehearsed on a clean cluster,
-- supabase/tests/containment-rehearsal/run.sh).
--
-- The USAGE grants are a write-path dependency, not decoration: the audit
-- trigger runs as the writing role, and without USAGE every browser date
-- write fails with "permission denied for schema rooted_private".
create schema if not exists rooted_private;
revoke all on schema rooted_private from public;
grant usage on schema rooted_private to authenticated, service_role;
