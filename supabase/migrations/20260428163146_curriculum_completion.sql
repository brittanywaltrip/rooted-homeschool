-- Curriculum completion tracking
-- Adds completed_at to mark when a curriculum was finished, and an index
-- for fast "completed this year" queries on the Plan page.

ALTER TABLE public.curriculum_goals
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_curriculum_goals_user_completed
ON public.curriculum_goals(user_id, completed_at)
WHERE completed_at IS NOT NULL;

COMMENT ON COLUMN public.curriculum_goals.completed_at IS
  'Set automatically when current_lesson reaches total_lessons. NULL until completion. Preserved if user later edits backwards (historical record of first completion).';
