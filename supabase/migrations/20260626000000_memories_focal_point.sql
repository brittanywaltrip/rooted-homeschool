-- Per-photo focal point (Phase 2, control #1: reposition).
-- focal_x / focal_y are normalized 0..1 coordinates of the point a family wants
-- kept in view when a photo fills a cover-fit frame (cover + collage cells).
-- NULL = use the existing default heuristic (portrait bias ~0.50/0.35, else center).
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS focal_x real;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS focal_y real;

-- Keep values in range (NULL stays allowed). Guarded so the migration is re-runnable.
DO $$ BEGIN
  ALTER TABLE public.memories
    ADD CONSTRAINT memories_focal_x_range CHECK (focal_x IS NULL OR (focal_x >= 0 AND focal_x <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.memories
    ADD CONSTRAINT memories_focal_y_range CHECK (focal_y IS NULL OR (focal_y >= 0 AND focal_y <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
