-- Seed curriculum and online_classes resources
-- Uses WHERE NOT EXISTS to avoid duplicates on re-run

INSERT INTO resources (category, title, description, url, grade_level, badge_text, is_free_pick, active, sort_order)
SELECT * FROM (VALUES
  ('curriculum', 'The Good and the Beautiful',
   'Charlotte Mason-inspired curriculum with beautiful design, strong language arts, and integrated faith. Free courses available to download.',
   'https://www.goodandbeautiful.com', 'All Ages', 'Charlotte Mason', true, true, 1),

  ('curriculum', 'Christian Light Education',
   'Complete K-12 homeschool curriculum rooted in Christian values. Workbooks for math, language arts, science, social studies, and Bible.',
   'https://www.christianlighteducation.com', 'All Ages', 'Christian · K-12', false, true, 2),

  ('curriculum', 'Abeka',
   'Traditional Christian homeschool curriculum trusted by millions of families. Strong phonics, grammar, and Bible integration across all grades.',
   'https://www.abeka.com', 'All Ages', 'Christian · Traditional', false, true, 3),

  ('curriculum', 'Sonlight',
   'Literature-based, Charlotte Mason-inspired curriculum built around great books. Strong history and read-aloud focus.',
   'https://www.sonlight.com', 'All Ages', 'Literature-Based', false, true, 4),

  ('curriculum', 'All About Reading & Spelling',
   'Orton-Gillingham based reading and spelling curriculum. Multisensory, systematic, and loved by families with struggling readers or dyslexia.',
   'https://www.allaboutlearningpress.com', 'K-8', 'Reading · Spelling', false, true, 5),

  ('curriculum', 'Math-U-See',
   'Mastery-based math curriculum using manipulatives and visual learning. Each concept is fully mastered before moving on.',
   'https://www.mathusee.com', 'All Ages', 'Math · Mastery', false, true, 6),

  ('curriculum', 'Saxon Math',
   'Incremental, spiral math curriculum with daily review. One of the most widely used math programs in homeschooling.',
   'https://www.hmhco.com/programs/saxon-math', 'All Ages', 'Math · Spiral', false, true, 7),

  ('curriculum', 'My Father''s World',
   'Charlotte Mason and classical approach integrating Bible, history, science, and language arts into a unified daily schedule.',
   'https://www.mfwbooks.com', 'All Ages', 'Charlotte Mason', false, true, 8),

  ('online_classes', 'Outschool',
   'Live online classes for homeschool kids taught by independent teachers. Thousands of subjects from math to art to coding — drop-in or ongoing.',
   'https://outschool.com', 'All Ages', 'Live Classes', true, true, 1),

  ('online_classes', 'Schoolhouse Teachers',
   'One membership, unlimited courses. Thousands of video lessons across every subject for K-12 — one flat annual fee for the whole family.',
   'https://www.schoolhouseteachers.com', 'All Ages', 'Membership', false, true, 2),

  ('online_classes', 'Khan Academy',
   '100% free, world-class education for any age or subject.',
   'https://www.khanacademy.org', 'All Ages', 'Free', true, true, 3)
) AS v(category, title, description, url, grade_level, badge_text, is_free_pick, active, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM resources r WHERE r.title = v.title AND r.category = v.category
);
