-- ============================================================
-- Migration: Copy memory-type rows from app_events → memories
-- Assumes the memories table already exists with columns:
--   id, user_id, child_id, date, type, title, caption,
--   photo_url, include_in_book, page_order, created_at, updated_at
-- ============================================================

INSERT INTO public.memories (
  user_id,
  child_id,
  date,
  type,
  title,
  caption,
  photo_url,
  include_in_book,
  page_order,
  created_at,
  updated_at
)
SELECT
  ae.user_id,
  (ae.payload ->> 'child_id')::uuid,
  COALESCE(
    (ae.payload ->> 'date')::date,
    ae.created_at::date
  ),
  ae.type,
  COALESCE(ae.payload ->> 'title', 'Untitled'),
  COALESCE(ae.payload ->> 'description', ae.payload ->> 'caption'),
  ae.payload ->> 'photo_url',
  false,
  NULL,
  ae.created_at,
  ae.created_at
FROM public.app_events ae
WHERE ae.type IN (
  'memory_photo',
  'memory_book',
  'memory_project',
  'memory_field_trip',
  'memory_activity',
  'book_read'
);

-- Enable RLS on the memories table
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

-- Users can read their own memories
CREATE POLICY IF NOT EXISTS "Users can read own memories"
  ON public.memories FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own memories
CREATE POLICY IF NOT EXISTS "Users can insert own memories"
  ON public.memories FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own memories
CREATE POLICY IF NOT EXISTS "Users can update own memories"
  ON public.memories FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can delete their own memories
CREATE POLICY IF NOT EXISTS "Users can delete own memories"
  ON public.memories FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
