INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'year-certificates',
  'year-certificates',
  false,
  5242880,
  ARRAY['image/png', 'application/pdf']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users manage own certificates"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'year-certificates'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'year-certificates'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
