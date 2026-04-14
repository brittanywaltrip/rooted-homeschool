-- ============================================================
-- Migration: School Years + Badges + Streak Tracking
-- Safe to re-run (uses IF NOT EXISTS guards throughout)
-- ============================================================

-- ─── 1. school_years table ─────────────────────────────────

CREATE TABLE IF NOT EXISTS school_years (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT school_years_status_check CHECK (status IN ('active', 'upcoming', 'archived'))
);

-- Only one active year per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_years_active
  ON school_years (user_id) WHERE status = 'active';

-- Only one upcoming year per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_years_upcoming
  ON school_years (user_id) WHERE status = 'upcoming';

ALTER TABLE school_years ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'school_years' AND policyname = 'Users can view own school years') THEN
    CREATE POLICY "Users can view own school years" ON school_years FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'school_years' AND policyname = 'Users can insert own school years') THEN
    CREATE POLICY "Users can insert own school years" ON school_years FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'school_years' AND policyname = 'Users can update own school years') THEN
    CREATE POLICY "Users can update own school years" ON school_years FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'school_years' AND policyname = 'Users can delete own school years') THEN
    CREATE POLICY "Users can delete own school years" ON school_years FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 2. badges table ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  badge_type TEXT NOT NULL,
  badge_key TEXT NOT NULL,
  tier TEXT,
  school_year_id UUID REFERENCES school_years(id),
  earned_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_badges_user ON badges (user_id);
CREATE INDEX IF NOT EXISTS idx_badges_child ON badges (child_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_badges_unique ON badges (user_id, COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid), badge_key, COALESCE(school_year_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'badges' AND policyname = 'Users can view own badges') THEN
    CREATE POLICY "Users can view own badges" ON badges FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'badges' AND policyname = 'Users can insert own badges') THEN
    CREATE POLICY "Users can insert own badges" ON badges FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 3. Add school_year_id to existing tables ──────────────

ALTER TABLE curriculum_goals ADD COLUMN IF NOT EXISTS school_year_id UUID REFERENCES school_years(id);
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS school_year_id UUID REFERENCES school_years(id);
ALTER TABLE activities ADD COLUMN IF NOT EXISTS school_year_id UUID REFERENCES school_years(id);
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS school_year_id UUID REFERENCES school_years(id);

-- ─── 4. Streak tracking on profiles ────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_streak_days INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS longest_streak_days INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_logged_date DATE;

-- ─── 5. Backfill: create default school year for existing users ──

-- For every user with at least one curriculum_goal, create a
-- '2025–2026' school year starting from their earliest goal,
-- then link all their existing data to it.

DO $$
DECLARE
  r RECORD;
  new_sy_id UUID;
BEGIN
  FOR r IN
    SELECT
      cg.user_id,
      MIN(cg.created_at)::date AS earliest,
      (MIN(cg.created_at)::date + INTERVAL '1 year')::date AS end_dt
    FROM curriculum_goals cg
    WHERE NOT EXISTS (
      SELECT 1 FROM school_years sy WHERE sy.user_id = cg.user_id
    )
    GROUP BY cg.user_id
  LOOP
    INSERT INTO school_years (user_id, name, start_date, end_date, status)
    VALUES (r.user_id, '2025–2026', r.earliest, r.end_dt, 'active')
    RETURNING id INTO new_sy_id;

    UPDATE curriculum_goals SET school_year_id = new_sy_id WHERE user_id = r.user_id AND school_year_id IS NULL;
    UPDATE lessons SET school_year_id = new_sy_id WHERE user_id = r.user_id AND school_year_id IS NULL;
    UPDATE activities SET school_year_id = new_sy_id WHERE user_id = r.user_id AND school_year_id IS NULL;
    UPDATE activity_logs SET school_year_id = new_sy_id WHERE user_id = r.user_id AND school_year_id IS NULL;
  END LOOP;
END $$;
