-- Appointments feature

-- 1. Create appointments table
CREATE TABLE appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  emoji TEXT DEFAULT '📅',
  date DATE NOT NULL,
  time TIME,
  duration_minutes INTEGER DEFAULT 60,
  location TEXT,
  notes TEXT,
  child_ids UUID[] DEFAULT '{}',
  is_recurring BOOLEAN DEFAULT false,
  recurrence_rule JSONB,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies
CREATE POLICY "appointments_select" ON appointments
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "appointments_insert" ON appointments
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "appointments_update" ON appointments
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "appointments_delete" ON appointments
  FOR DELETE USING (user_id = auth.uid());

-- 4. Indexes
CREATE INDEX idx_appointments_user_date ON appointments (user_id, date);
CREATE INDEX idx_appointments_user_recurring ON appointments (user_id, is_recurring);

-- 5. Add location column to activities
ALTER TABLE activities ADD COLUMN location TEXT;
