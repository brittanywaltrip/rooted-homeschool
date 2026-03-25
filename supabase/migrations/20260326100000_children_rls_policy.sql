-- Ensure RLS is enabled on children table
ALTER TABLE children ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own children
CREATE POLICY IF NOT EXISTS "Users can insert own children"
  ON children FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to read their own children
CREATE POLICY IF NOT EXISTS "Users can read own children"
  ON children FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Allow authenticated users to update their own children
CREATE POLICY IF NOT EXISTS "Users can update own children"
  ON children FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Allow authenticated users to delete their own children
CREATE POLICY IF NOT EXISTS "Users can delete own children"
  ON children FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
