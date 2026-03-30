-- Add is_free_pick and created_at columns, expand category constraint

ALTER TABLE resources
  ADD COLUMN is_free_pick boolean NOT NULL DEFAULT false;

ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Drop the old category constraint and add the expanded one
ALTER TABLE resources
  DROP CONSTRAINT IF EXISTS resources_category_check;

ALTER TABLE resources
  ADD CONSTRAINT resources_category_check
  CHECK (category IN ('discounts', 'field_trips', 'printables', 'science', 'easy_win', 'weekly_picks', 'curriculum', 'online_classes'));
