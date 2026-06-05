-- Fix storage.objects owner_id UUID error.
-- Supabase Storage derives owner_id from the FIRST path segment, which must be
-- a UUID. Our previous path "uploads/{userId}/..." caused it to attempt casting
-- the literal string "uploads" as a UUID → error.
-- New canonical path: "{userId}/{timestamp}_{filename}"

-- Drop old policies (they used the "uploads/..." LIKE pattern)
DROP POLICY IF EXISTS "videos_insert_own"       ON storage.objects;
DROP POLICY IF EXISTS "videos_select_own"       ON storage.objects;
DROP POLICY IF EXISTS "videos_public_read"      ON storage.objects;
DROP POLICY IF EXISTS "users_upload_own_videos" ON storage.objects;
DROP POLICY IF EXISTS "users_select_own_videos" ON storage.objects;

-- New policies: first folder segment IS the user's UUID
CREATE POLICY "videos_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "videos_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
