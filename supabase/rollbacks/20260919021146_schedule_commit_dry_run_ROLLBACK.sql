-- Rollback for 20260919021146. The function writes nothing, so dropping it
-- cannot affect any schedule. Nothing in the product calls it.
drop function if exists public.schedule_commit_dry_run(uuid, text, uuid[], jsonb, boolean, boolean, text);
