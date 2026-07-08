-- Family portal reactions never saved. Two DB-level causes, both already fixed
-- directly on the live database on 2026-07-07 via migrations
-- update_memory_reactions_emoji_check, memory_reactions_family_token_drop_not_null,
-- and memory_comments_family_token_drop_not_null.
--
-- This file records those changes so the repo matches the live database and so a
-- fresh environment builds the same schema. It is idempotent and safe to re-run,
-- but it was NOT run against the live database from here (already applied there).
--
-- Cause 1: memory_reactions.emoji had a CHECK constraint carrying the old emoji
-- list, so 🙌 and 😍 (shown in the UI) were rejected. Realign it to the shared
-- set in lib/family-reactions.ts.
ALTER TABLE memory_reactions DROP CONSTRAINT IF EXISTS memory_reactions_emoji_check;
ALTER TABLE memory_reactions ADD CONSTRAINT memory_reactions_emoji_check
  CHECK (emoji = ANY (ARRAY['🥹'::text,'❤️'::text,'😂'::text,'🙌'::text,'😍'::text]));

-- Cause 2: family_token was a legacy NOT NULL column that the current routes
-- never populated, so every reaction/comment insert failed. Drop NOT NULL (the
-- routes now also write family_token going forward, but old rows and other
-- writers must not be forced to).
ALTER TABLE memory_reactions ALTER COLUMN family_token DROP NOT NULL;
ALTER TABLE memory_comments ALTER COLUMN family_token DROP NOT NULL;
