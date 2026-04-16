-- My Lists feature: lists + list_items tables

-- 1. Create lists table
CREATE TABLE lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '📝',
  sort_order INTEGER DEFAULT 0,
  archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create list_items table
CREATE TABLE list_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  done BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  child_id UUID REFERENCES children(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Enable RLS
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies for lists
CREATE POLICY "lists_select" ON lists
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "lists_insert" ON lists
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "lists_update" ON lists
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "lists_delete" ON lists
  FOR DELETE USING (user_id = auth.uid());

-- 5. RLS policies for list_items
CREATE POLICY "list_items_select" ON list_items
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "list_items_insert" ON list_items
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "list_items_update" ON list_items
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "list_items_delete" ON list_items
  FOR DELETE USING (user_id = auth.uid());

-- 6. Indexes
CREATE INDEX idx_lists_user_archived_sort ON lists (user_id, archived, sort_order);
CREATE INDEX idx_list_items_list_sort ON list_items (list_id, sort_order);

-- 7. Seed default list function (called from API, not a trigger)
CREATE OR REPLACE FUNCTION seed_default_list(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO lists (user_id, name, emoji, sort_order)
  SELECT p_user_id, 'To-Do''s', '✅', 0
  WHERE NOT EXISTS (
    SELECT 1 FROM lists WHERE user_id = p_user_id
  );
END;
$$;
