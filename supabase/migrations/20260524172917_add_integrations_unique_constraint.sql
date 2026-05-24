/*
  # Add unique constraint on integrations(user_id, platform)

  Required so OAuth token upserts work correctly — prevents duplicate rows
  per user per platform and allows ON CONFLICT DO UPDATE.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrations_user_platform_unique'
  ) THEN
    ALTER TABLE integrations
      ADD CONSTRAINT integrations_user_platform_unique
      UNIQUE (user_id, platform);
  END IF;
END $$;
