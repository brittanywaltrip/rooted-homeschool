-- Yearbook Phase 1: school year tracking + yearbook text content

-- School year tracking on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS yearbook_opened_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS yearbook_closed_at timestamptz;

-- All yearbook text content (letter, interviews, future notes)
CREATE TABLE IF NOT EXISTS yearbook_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  yearbook_key text NOT NULL,
  content_type text NOT NULL,
  child_id uuid REFERENCES children(id) ON DELETE CASCADE,
  question_key text,
  content text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, yearbook_key, content_type, child_id, question_key)
);

-- content_type values:
-- 'letter_from_home'          (child_id null, question_key null)
-- 'letter_favorite_caption'   (child_id null, question_key null)
-- 'letter_favorite_quote'     (child_id null, question_key null)
-- 'letter_favorite_memory_id' (child_id null, question_key null) - stores memory uuid as text
-- 'child_interview'           (child_id set, question_key = one of the keys below)
-- 'child_future_note'         (child_id set, question_key null)

-- Interview question keys (same every year - never change these):
-- 'q_loved_learning'
-- 'q_favorite_book'
-- 'q_got_easier'
-- 'q_learn_next_year'
-- 'q_favorite_adventure'
-- 'q_surprised_you'

ALTER TABLE yearbook_content ENABLE ROW LEVEL SECURITY;

-- Users can always read their own content regardless of subscription
CREATE POLICY "Users read own yearbook_content"
  ON yearbook_content FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only write if yearbook is not closed
-- (closed check enforced at API/component level, not RLS,
--  so archived books stay readable forever even post-cancellation)
CREATE POLICY "Users write own yearbook_content"
  ON yearbook_content FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
