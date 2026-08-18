-- ALREADY APPLIED TO PRODUCTION 2026-08-18 (via Supabase MCP apply_migration).
-- This file exists so the repo's migration history matches the live database.
--
-- Yearbook autosave was INSERTING a new row on every save instead of updating.
--
-- saveContent() upserts with
--   onConflict: "user_id,yearbook_key,content_type,child_id,question_key"
-- and the matching UNIQUE constraint existed, but as a standard index NULLs
-- are distinct, and child_id / question_key are NULL for family-level keys
-- like letter_from_home. ON CONFLICT therefore never matched and every
-- autosave tick inserted a duplicate. One user had 41 letter_from_home rows
-- dating to April. The edit and reader pages build a last-row-wins map over
-- an UNORDERED select, so which duplicate displayed was arbitrary: text
-- looked saved on one load and gone on the next. 62 duplicate groups across
-- 15 users at fix time; 344 stale rows removed (506 -> 162).
--
-- Fix: dedupe keeping the newest row per logical key, then rebuild the
-- constraint's index with NULLS NOT DISTINCT (Postgres 15+; this project is
-- 17.6) so the existing app upsert matches with NO code change.

-- 1. Keep only the newest row of each logical key (updated_at, id as tiebreak).
DELETE FROM public.yearbook_content yc
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, yearbook_key, content_type, child_id, question_key
           ORDER BY updated_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.yearbook_content
) ranked
WHERE yc.id = ranked.id AND ranked.rn > 1;

-- 2. Replace the unique constraint with a NULLS NOT DISTINCT version.
ALTER TABLE public.yearbook_content
  DROP CONSTRAINT yearbook_content_user_id_yearbook_key_content_type_child_id_key;

ALTER TABLE public.yearbook_content
  ADD CONSTRAINT yearbook_content_user_id_yearbook_key_content_type_child_id_key
  UNIQUE NULLS NOT DISTINCT (user_id, yearbook_key, content_type, child_id, question_key);
