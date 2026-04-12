-- Create yearbook-covers storage bucket (public, same limits as family-photos)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('yearbook-covers', 'yearbook-covers', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY IF NOT EXISTS "Users can upload yearbook covers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'yearbook-covers' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow users to overwrite their own cover photo
CREATE POLICY IF NOT EXISTS "Users can update their own yearbook covers"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'yearbook-covers' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Public read access (bucket is public)
CREATE POLICY IF NOT EXISTS "Public read access for yearbook covers"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'yearbook-covers');

-- ── daily_reflections RLS policies ─────────────────────────────────────────
-- The table exists but may be missing RLS policies, causing 400 errors.

ALTER TABLE daily_reflections ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can read own daily_reflections"
  ON daily_reflections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can insert own daily_reflections"
  ON daily_reflections FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can update own daily_reflections"
  ON daily_reflections FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can delete own daily_reflections"
  ON daily_reflections FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
