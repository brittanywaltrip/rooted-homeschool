-- Drop the old category check constraint and add a new one with easy_win and weekly_picks
ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_category_check;
ALTER TABLE resources ADD CONSTRAINT resources_category_check
  CHECK (category IN ('discounts', 'field_trips', 'printables', 'science', 'easy_win', 'weekly_picks'));
