-- Per-photo "feature" flag (Phase 2, control #3).
-- A featured photo gets its own full-bleed feature page in the yearbook,
-- inserted at its ordered position within the chapter. Nullable, default false.
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
