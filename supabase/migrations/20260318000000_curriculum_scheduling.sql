-- ============================================================
-- Migration: Curriculum scheduling support
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Add school_days to curriculum_goals (which days the family schools)
alter table public.curriculum_goals
  add column if not exists school_days text[] not null default array['Mon','Tue','Wed','Thu','Fri'];

-- Add curriculum tracking columns to lessons so auto-scheduled lessons
-- can be linked back to their goal and rescheduled intelligently
alter table public.lessons
  add column if not exists curriculum_goal_id uuid references public.curriculum_goals(id) on delete set null,
  add column if not exists lesson_number integer;

-- Index for fast lookup of incomplete scheduled lessons per goal
create index if not exists idx_lessons_curriculum_goal_id
  on public.lessons(curriculum_goal_id)
  where curriculum_goal_id is not null;
