-- Create public 'videos' bucket (500 MB file limit, public read access)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'videos',
  'videos',
  true,
  524288000,   -- 500 MB
  ARRAY[
    'video/mp4', 'video/webm', 'video/quicktime',
    'video/x-matroska', 'video/avi', 'video/mpeg',
    'video/x-msvideo', 'video/3gpp', 'video/3gpp2'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public          = true,
  file_size_limit = 524288000;

-- Drop stale 'video-uploads' policies (wrong bucket name)
DROP POLICY IF EXISTS "users_upload_own_videos" ON storage.objects;
DROP POLICY IF EXISTS "users_select_own_videos" ON storage.objects;

-- Authenticated users may upload into their own folder
CREATE POLICY "videos_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'videos'
    AND name LIKE 'uploads/' || auth.uid()::text || '/%'
  );

-- Authenticated users may read their own files via the SDK
CREATE POLICY "videos_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'videos'
    AND name LIKE 'uploads/' || auth.uid()::text || '/%'
  );
