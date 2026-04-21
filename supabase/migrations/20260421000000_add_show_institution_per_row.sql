-- ============================================================
-- Transcript settings: optional toggle to show institution on
-- every course row (not just rows with external_provider set).
-- Default false preserves existing behavior — only rows with an
-- external_provider show the italic sub-line.
-- Per-child (transcript_settings is keyed on user_id + child_id).
-- ============================================================

alter table public.transcript_settings
  add column if not exists show_institution_per_row boolean not null default false;
