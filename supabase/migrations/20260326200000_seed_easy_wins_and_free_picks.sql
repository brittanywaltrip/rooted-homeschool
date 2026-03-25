-- Seed Easy Wins into resources table (category = 'easy_win')
-- badge_text stores the emoji, grade_level stores the prep time + grade
INSERT INTO resources (category, title, description, url, grade_level, badge_text, active, sort_order)
VALUES
  ('easy_win', 'Salt Tray Writing', 'Pour salt in a tray, practice spelling words or letters with a finger.', 'https://www.growinghandsonkids.com/', 'K–2', '🎨 5 min', true, 1),
  ('easy_win', 'Shadow Tracing', 'Trace your shadow at different times of day. Watch it move and discuss why.', 'https://spaceplace.nasa.gov/', 'All Ages', '🔭 10 min', true, 2),
  ('easy_win', 'Audiobook Hour', 'Put on a great audiobook and do a puzzle together. Zero prep, total engagement.', 'https://librivox.org', 'All Ages', '📚 0 min prep', true, 3),
  ('easy_win', 'Nature Alphabet Hunt', 'Go outside and find something in nature for each letter of the alphabet.', 'https://www.kidsactivitiesblog.com/', 'K–5', '🌿 15 min', true, 4),
  ('easy_win', 'Kitchen Math', 'Double a recipe together. Real fractions, real reward, and everyone eats the results.', 'https://www.khanacademy.org/math/early-math', '3–8', '🍳 20 min', true, 5),
  ('easy_win', 'History Podcast', 'Put on a Stuff You Missed in History Class episode during lunch or craft time.', 'https://www.missedinhistory.com', 'All Ages', '🎭 0 min prep', true, 6)
ON CONFLICT DO NOTHING;

-- Seed top 3 Free Picks into resources table (category = 'weekly_picks')
INSERT INTO resources (category, title, description, url, grade_level, badge_text, active, sort_order)
VALUES
  ('weekly_picks', 'NASA Virtual Tours', 'Tour Kennedy Space Center and the ISS in 360° — totally free.', 'https://www.nasa.gov/nasa-at-home-virtual-tours-and-apps/', '6–8', 'Field Trip', true, 1),
  ('weekly_picks', 'Khan Academy', '100% free, world-class education for any age or subject.', 'https://www.khanacademy.org', 'All Ages', 'Free Tools', true, 2),
  ('weekly_picks', 'Google Arts & Culture', 'Virtual museum tours from hundreds of the world''s greatest institutions.', 'https://artsandculture.google.com', 'All Ages', 'Field Trip', true, 3)
ON CONFLICT DO NOTHING;
