-- Add icon_emoji column to curriculum_goals
ALTER TABLE curriculum_goals ADD COLUMN IF NOT EXISTS icon_emoji TEXT;

-- Auto-assign emoji based on curriculum name patterns
UPDATE curriculum_goals SET icon_emoji = '📐' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%math%' OR curriculum_name ILIKE '%algebra%' OR curriculum_name ILIKE '%geometry%' OR curriculum_name ILIKE '%calculus%');
UPDATE curriculum_goals SET icon_emoji = '📖' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%language art%' OR curriculum_name ILIKE '%english%' OR curriculum_name ILIKE '%reading%' OR curriculum_name ILIKE '%writing%' OR curriculum_name ILIKE '%grammar%' OR curriculum_name ILIKE '%spelling%' OR curriculum_name ILIKE '%phonics%' OR curriculum_name ILIKE '%literature%');
UPDATE curriculum_goals SET icon_emoji = '🔬' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%science%' OR curriculum_name ILIKE '%biology%' OR curriculum_name ILIKE '%chemistry%' OR curriculum_name ILIKE '%physics%' OR curriculum_name ILIKE '%nature%');
UPDATE curriculum_goals SET icon_emoji = '🌍' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%history%' OR curriculum_name ILIKE '%social stud%' OR curriculum_name ILIKE '%geography%' OR curriculum_name ILIKE '%civics%' OR curriculum_name ILIKE '%government%');
UPDATE curriculum_goals SET icon_emoji = '🎨' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%art%' OR curriculum_name ILIKE '%drawing%' OR curriculum_name ILIKE '%painting%' OR curriculum_name ILIKE '%craft%');
UPDATE curriculum_goals SET icon_emoji = '🎵' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%music%' OR curriculum_name ILIKE '%piano%' OR curriculum_name ILIKE '%guitar%' OR curriculum_name ILIKE '%violin%' OR curriculum_name ILIKE '%instrument%');
UPDATE curriculum_goals SET icon_emoji = '⚽' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%pe %' OR curriculum_name ILIKE '%physical ed%' OR curriculum_name ILIKE '%sport%' OR curriculum_name ILIKE '%gym%');
UPDATE curriculum_goals SET icon_emoji = '🗣️' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%spanish%' OR curriculum_name ILIKE '%french%' OR curriculum_name ILIKE '%latin%' OR curriculum_name ILIKE '%foreign%' OR curriculum_name ILIKE '%language' OR curriculum_name ILIKE '%german%');
UPDATE curriculum_goals SET icon_emoji = '✝️' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%bible%' OR curriculum_name ILIKE '%religion%' OR curriculum_name ILIKE '%faith%' OR curriculum_name ILIKE '%theology%');
UPDATE curriculum_goals SET icon_emoji = '💻' WHERE icon_emoji IS NULL AND (curriculum_name ILIKE '%computer%' OR curriculum_name ILIKE '%coding%' OR curriculum_name ILIKE '%tech%' OR curriculum_name ILIKE '%programming%');
UPDATE curriculum_goals SET icon_emoji = '📚' WHERE icon_emoji IS NULL;
