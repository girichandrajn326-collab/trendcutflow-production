-- Force the videos bucket to 500 MB. Previous migration may not have taken
-- effect if the bucket already existed with a lower limit.
UPDATE storage.buckets
SET
  file_size_limit = 524288000,   -- 500 MB
  public          = true
WHERE id = 'videos';

-- Also update video-uploads bucket in case some code still references it
UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE id = 'video-uploads';
