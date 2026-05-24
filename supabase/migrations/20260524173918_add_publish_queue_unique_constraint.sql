/*
  # Add unique constraint on publish_queue(user_id, clip_id)

  Required for the ON CONFLICT upsert in appStore addToPublishQueue.
  Without this constraint, Supabase upsert throws a 400 error because
  there is no unique index to target.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'publish_queue_user_clip_unique'
  ) THEN
    ALTER TABLE publish_queue
      ADD CONSTRAINT publish_queue_user_clip_unique
      UNIQUE (user_id, clip_id);
  END IF;
END $$;
