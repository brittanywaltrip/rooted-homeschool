-- STEP 1: Add new columns to curriculum_goals
ALTER TABLE curriculum_goals
  ADD COLUMN IF NOT EXISTS start_at_lesson INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scheduled_start_time TIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_backfilled BOOLEAN DEFAULT false;

-- STEP 2: Add new columns to lessons
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS is_backfill BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS started_at TIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NULL;

-- STEP 3: Create activities table
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '📝',
  frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  days INTEGER[] DEFAULT '{}'::INTEGER[],
  duration_minutes INTEGER DEFAULT 60,
  scheduled_start_time TIME DEFAULT NULL,
  child_ids UUID[] DEFAULT '{}'::UUID[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- STEP 4: Create activity_logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  minutes_spent INTEGER,
  started_at TIME DEFAULT NULL,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ DEFAULT NULL,
  notes TEXT,
  is_backfill BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- STEP 5: Enable RLS and add policies
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Activities policies
CREATE POLICY "activities_select" ON activities
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "activities_insert" ON activities
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "activities_update" ON activities
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "activities_delete" ON activities
  FOR DELETE USING (user_id = auth.uid());

-- Activity logs policies
CREATE POLICY "activity_logs_select" ON activity_logs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "activity_logs_insert" ON activity_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "activity_logs_update" ON activity_logs
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "activity_logs_delete" ON activity_logs
  FOR DELETE USING (user_id = auth.uid());

-- STEP 6: Create indexes
CREATE INDEX IF NOT EXISTS idx_activities_user_active ON activities (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_date ON activity_logs (user_id, date);
CREATE INDEX IF NOT EXISTS idx_activity_logs_activity_date ON activity_logs (activity_id, date);
CREATE INDEX IF NOT EXISTS idx_lessons_backfill ON lessons (is_backfill) WHERE is_backfill = true;
