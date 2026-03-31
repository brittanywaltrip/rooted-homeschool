-- Add default_minutes column to curriculum_goals
-- This column was added directly in Supabase; this migration ensures it's tracked.
alter table public.curriculum_goals
  add column if not exists default_minutes integer not null default 30;
