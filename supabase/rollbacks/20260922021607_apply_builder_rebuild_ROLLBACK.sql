-- Rollback for 20260922021607_apply_builder_rebuild (and the work-guard
-- migration that replaces its body). Removes the function. There is no
-- client-side fallback: with the function gone, every Schedule Builder save
-- stops before writing lessons and asks the family to save again. Roll the
-- APP back first, then run this. No data is touched.
drop function if exists public.apply_builder_rebuild(uuid, date, jsonb, jsonb);
