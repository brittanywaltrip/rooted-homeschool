-- Ensure RLS + insert policies exist for all core tables used during onboarding
-- These are idempotent (IF NOT EXISTS) so safe to run even if policies already exist

-- lessons
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users can insert own lessons"
  ON lessons FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can read own lessons"
  ON lessons FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can update own lessons"
  ON lessons FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can delete own lessons"
  ON lessons FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- subjects
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users can insert own subjects"
  ON subjects FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can read own subjects"
  ON subjects FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can update own subjects"
  ON subjects FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- curriculum_goals
ALTER TABLE curriculum_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users can insert own curriculum_goals"
  ON curriculum_goals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can read own curriculum_goals"
  ON curriculum_goals FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can update own curriculum_goals"
  ON curriculum_goals FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can delete own curriculum_goals"
  ON curriculum_goals FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
