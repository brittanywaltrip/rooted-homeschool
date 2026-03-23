-- Add school schedule columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_days text[] DEFAULT ARRAY['monday','tuesday','wednesday','thursday','friday'];
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_year_start date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_year_end date;

-- Create vacations table (if it doesn't already exist)
CREATE TABLE IF NOT EXISTS vacations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on vacations
ALTER TABLE vacations ENABLE ROW LEVEL SECURITY;

-- RLS policy for vacations (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'vacations' AND policyname = 'Users manage own vacations'
  ) THEN
    CREATE POLICY "Users manage own vacations" ON vacations
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END
$$;
