-- Rollback for 20260922021607_apply_builder_rebuild.
-- Removes the function. The Schedule Builder then sees PGRST202 and falls back
-- to its ordered client-side writes (app/lib/phase2-commit.ts), which are NOT a
-- single transaction, so prefer rolling back the app instead when possible.
-- No data is touched.
drop function if exists public.apply_builder_rebuild(uuid, date, jsonb, jsonb);
