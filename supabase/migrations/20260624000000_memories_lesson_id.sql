ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS lesson_id uuid
  REFERENCES public.lessons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS memories_lesson_id_idx ON public.memories (lesson_id);
