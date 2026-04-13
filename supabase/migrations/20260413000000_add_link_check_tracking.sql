-- Add columns to track link check status persistence
-- Used by the weekly broken link checker to reduce false positives

alter table public.resources
  add column if not exists last_check_status text,
  add column if not exists consecutive_failures integer not null default 0;
