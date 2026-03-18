-- ============================================================
-- Migration: Add school_year column to lessons and curriculum_goals
-- Run this in your Supabase SQL Editor before using the
-- "Start New School Year" feature in Settings.
-- ============================================================

alter table public.lessons
  add column if not exists school_year text default '2025-2026';

alter table public.curriculum_goals
  add column if not exists school_year text default '2025-2026';
