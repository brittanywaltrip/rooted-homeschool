-- Fix: allow title and caption to be NULL so photo captures
-- (which have no title/caption) can be inserted without error.

ALTER TABLE public.memories ALTER COLUMN title DROP NOT NULL;
ALTER TABLE public.memories ALTER COLUMN title SET DEFAULT '';

ALTER TABLE public.memories ALTER COLUMN caption DROP NOT NULL;
