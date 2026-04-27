-- Drop all AI-feature columns and tables. Rooted no longer uses AI.
-- Apply manually via Supabase dashboard after the code deploy succeeds.

ALTER TABLE profiles DROP COLUMN IF EXISTS ai_update_last_generated;
DROP TABLE IF EXISTS family_updates;
DROP TABLE IF EXISTS ai_usage;
