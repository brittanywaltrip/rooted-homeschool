-- ============================================================
-- Migration: Add days_of_week column to subjects table
-- This enables the weekly schedule view to show which subjects
-- are scheduled on which days of the week.
-- ============================================================

alter table public.subjects
  add column if not exists days_of_week text[] not null default '{}';
