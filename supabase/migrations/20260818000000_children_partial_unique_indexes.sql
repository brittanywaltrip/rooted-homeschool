-- Let a family re-add a child they deleted.
--
-- THE BUG: deleting a child is a SOFT delete. archiveChild() in
-- app/dashboard/settings/page.tsx does `update({ archived: true })`, and the
-- list query hides the row with `.eq("archived", false)`. The row stays in
-- children with its name and name_key intact.
--
-- Adding a child is a plain INSERT with no archived-aware check, in all three
-- add paths (Settings, onboarding, Plan > Schedule). Both unique indexes below
-- covered every row regardless of archived, so the invisible archived row kept
-- occupying the name and the insert failed with 23505. The family saw
-- "duplicate key value violates unique constraint ..." and had no way to get
-- their child back, because there is no un-archive flow.
--
-- Confirmed in production: user 8fb0f2b6-5a9f-4c95-ae9d-baf10ef8b18c has
-- Catherine and James, both archived = true, and could add back neither.
--
-- THE FIX: scope both indexes to live rows. This is deliberately done at the
-- database level rather than in the three add handlers, so every current and
-- future insert path is covered by one change.
--
-- Notes for whoever reads this next:
--   * These are plain indexes, NOT table constraints. pg_constraint on
--     public.children holds only children_pkey (verified against the live DB
--     2026-08-18), so DROP INDEX is correct here and
--     ALTER TABLE ... DROP CONSTRAINT would fail.
--   * The names are preserved so anything referencing them keeps working.
--   * archived is `boolean not null default false` (verified live), so
--     `WHERE archived = false` indexes every live row. If it ever becomes
--     nullable this must change to `WHERE archived IS NOT TRUE`, or NULL rows
--     would drop out of the index and duplicates would slip through.
--   * A partial index is strictly narrower than the full index it replaces, so
--     if the old index built, the new one builds. No data is read or written.
--   * Two LIVE children may still not share a name. Only archived rows stop
--     blocking, which is exactly the "add a second child with that name while
--     the first is still live" case that must keep being refused.

DROP INDEX IF EXISTS public.children_user_name_unique;
DROP INDEX IF EXISTS public.children_unique_per_user;

CREATE UNIQUE INDEX children_user_name_unique
  ON public.children (user_id, name_key)
  WHERE archived = false;

CREATE UNIQUE INDEX children_unique_per_user
  ON public.children (user_id, lower(name))
  WHERE archived = false;
