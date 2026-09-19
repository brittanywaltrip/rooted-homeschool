-- Rollback for 20260919012248_curriculum_goals_placement_mode.
--
-- Safe while nothing is authoritative. If any curriculum has crossed, dropping
-- the column silently returns it to legacy projection, which would let page
-- load rewrite its dates again. Check first:
--   select count(*) from curriculum_goals where placement_mode = 'authoritative';

drop index if exists curriculum_goals_placement_mode_idx;

alter table public.curriculum_goals
  drop constraint if exists curriculum_goals_placement_migrated_at_ck;

alter table public.curriculum_goals
  drop column if exists placement_migrated_at,
  drop column if exists placement_mode;

drop type if exists placement_mode_t;
