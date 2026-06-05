-- Allow authenticated users to upload video files directly from the browser
-- into their own folder (uploads/{userId}/...). This is required to bypass
-- the ~6 MB edge-function request-body limit for large video files.

CREATE POLICY "users_upload_own_videos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'video-uploads'
    AND name LIKE 'uploads/' || auth.uid()::text || '/%'
  );

-- Allow authenticated users to read their own uploaded files
-- (needed so the edge function can download via the service-role client,
-- and for any future signed-URL access).
CREATE POLICY "users_select_own_videos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'video-uploads'
    AND name LIKE 'uploads/' || auth.uid()::text || '/%'
  );
