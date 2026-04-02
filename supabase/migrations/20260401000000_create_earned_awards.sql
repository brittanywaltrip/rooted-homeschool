CREATE TABLE IF NOT EXISTS earned_awards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  award_type TEXT NOT NULL,
  child_id UUID NULL,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  certificate_data JSONB,
  downloaded_at TIMESTAMPTZ NULL,
  UNIQUE(user_id, award_type, child_id)
);

ALTER TABLE earned_awards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own awards" ON earned_awards
  FOR ALL USING (auth.uid() = user_id);

-- Add printable_style column to profiles if not exists
DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN printable_style TEXT DEFAULT 'garden';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
