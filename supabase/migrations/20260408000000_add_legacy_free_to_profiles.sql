-- Add legacy_free column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS legacy_free boolean DEFAULT false;

-- Mark all current free users as legacy
UPDATE profiles SET legacy_free = true WHERE (plan_type IS NULL OR plan_type = 'free');
