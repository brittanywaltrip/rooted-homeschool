-- Replace the active-row uniqueness key for curriculum_goals.
-- Old key (name only) blocked legitimate cases where users add multiple
-- subjects under one publisher name (CLE Math + CLE Language Arts + CLE Reading).
-- New key includes coalesced subject_label so same-name rows with different
-- subjects can coexist, while same-name + same-subject rows are still blocked
-- (the original double-submit protection from PR #61).

DROP INDEX IF EXISTS curriculum_goals_user_child_name_active_uidx;

CREATE UNIQUE INDEX curriculum_goals_user_child_name_subject_active_uidx
  ON curriculum_goals (
    user_id,
    child_id,
    lower(curriculum_name),
    lower(coalesce(subject_label, ''))
  )
  WHERE archived = false AND completed_at IS NULL;
