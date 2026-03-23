-- Add freemium gate columns to profiles (if they don't already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'photo_count') THEN
    ALTER TABLE profiles ADD COLUMN photo_count integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'yearly_review_count') THEN
    ALTER TABLE profiles ADD COLUMN yearly_review_count integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'yearly_review_reset_year') THEN
    ALTER TABLE profiles ADD COLUMN yearly_review_reset_year integer NOT NULL DEFAULT 0;
  END IF;
END
$$;

-- Add is_private column to daily_reflections (if it doesn't already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_reflections' AND column_name = 'is_private') THEN
    ALTER TABLE daily_reflections ADD COLUMN is_private boolean NOT NULL DEFAULT false;
  END IF;
END
$$;

-- Create increment_photo_count function (idempotent — replaces if exists)
CREATE OR REPLACE FUNCTION increment_photo_count(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE profiles
  SET photo_count = photo_count + 1
  WHERE id = p_user_id;
$$;
