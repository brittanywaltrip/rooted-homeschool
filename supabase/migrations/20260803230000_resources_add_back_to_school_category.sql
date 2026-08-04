-- Add the 'back_to_school' resource category.
--
-- resources.category carries a CHECK constraint listing every allowed value,
-- so a new category is not purely an app-side concern: without this the admin
-- page's "Add Back to School resource" insert fails with
-- resources_category_check and the featured section on /dashboard/resources can
-- never populate.
--
-- Same drop-and-recreate shape as 20260326300000 and 20260330000000. The list
-- is the previous one plus 'back_to_school'; nothing is removed, so every
-- existing row still satisfies it.

ALTER TABLE resources
  DROP CONSTRAINT IF EXISTS resources_category_check;

ALTER TABLE resources
  ADD CONSTRAINT resources_category_check
  CHECK (category IN (
    'discounts',
    'field_trips',
    'printables',
    'science',
    'easy_win',
    'weekly_picks',
    'curriculum',
    'online_classes',
    'back_to_school'
  ));
