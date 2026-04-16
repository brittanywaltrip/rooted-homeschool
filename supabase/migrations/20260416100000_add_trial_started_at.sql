-- Add trial tracking to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;

-- Backfill existing users: set trial_started_at to their created_at
-- so their 30-day trial is already "expired"
UPDATE profiles SET trial_started_at = created_at WHERE trial_started_at IS NULL;

-- For future signups, default to now()
ALTER TABLE profiles ALTER COLUMN trial_started_at SET DEFAULT now();
