-- Create storage buckets for photo uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('memory-photos', 'memory-photos', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('family-photos', 'family-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY IF NOT EXISTS "Users can upload memory photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'memory-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY IF NOT EXISTS "Users can upload family photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'family-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow users to update/overwrite their own files (needed for family photo upsert)
CREATE POLICY IF NOT EXISTS "Users can update their own family photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'family-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Public read access (both buckets are public)
CREATE POLICY IF NOT EXISTS "Public read access for memory photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'memory-photos');

CREATE POLICY IF NOT EXISTS "Public read access for family photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'family-photos');
