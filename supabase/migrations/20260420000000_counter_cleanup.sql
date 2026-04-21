-- Counter cleanup: drop denormalized photo_count + its increment RPC.
--
-- BACKGROUND
-- profiles.photo_count was a denormalized counter used only for the 50-photo
-- free-tier cap check in LogTodayModal. Two problems:
--   1. The increment_photo_count RPC had no decrement → deletions caused drift.
--   2. Photos insert into two tables (memories + app_events.payload.photo_url);
--      the RPC only fired from LogTodayModal, so other insert paths never
--      incremented the counter.
-- Result: 68 users had drifted counters on prod. A SQL backfill was run
-- directly on production to resync users; this migration drops the column and
-- RPC so the app no longer depends on the denormalized value. The 50-cap
-- check now computes the count live from memories + app_events on each
-- upload attempt (see app/lib/integrity-checks.ts: getPhotoCount).
--
-- NOTE ON THE PRODUCTION BACKFILL (for the record — this migration does NOT
-- re-run it; it's already applied):
--   UPDATE profiles p
--   SET photo_count = (
--     SELECT count(*) FROM memories m
--     WHERE m.user_id = p.id AND m.photo_url IS NOT NULL AND m.photo_url <> ''
--   ) + (
--     SELECT count(*) FROM app_events e
--     WHERE e.user_id = p.id AND e.payload->>'photo_url' IS NOT NULL AND e.payload->>'photo_url' <> ''
--   );
--
-- current_streak_days is NOT touched by this migration. Drift there is fixed
-- on the read side (app/lib/integrity-checks.ts: validateStreak) — storage
-- remains the write-time source; display returns 0 when last_logged_date is
-- older than the user's previous school day.

DROP FUNCTION IF EXISTS increment_photo_count(uuid);

ALTER TABLE profiles DROP COLUMN IF EXISTS photo_count;
