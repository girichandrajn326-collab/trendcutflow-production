/*
  # Add publish_queue table and extend repurposed_clips

  1. New Tables
    - `publish_queue`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK → users.id)
      - `clip_id` (uuid, FK → repurposed_clips.id — nullable for clips not yet persisted)
      - `clip_title` (text) — denormalized title for display
      - `platform` (text) — 'youtube_shorts' | 'instagram_reels' | 'snapchat_spotlight'
      - `interval_hours` (integer) — 12 | 24 | 48
      - `scheduled_at` (timestamptz)
      - `status` (text) — 'pending' | 'published' | 'failed'
      - `created_at` (timestamptz)

  2. Extended repurposed_clips
    - Add `metadata_json` column (jsonb) to store viral titles, hashtags, SEO desc, algorithmic tags

  3. Security
    - RLS enabled on publish_queue
    - Users can only read/insert/update/delete their own queue entries
*/

-- ── publish_queue ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS publish_queue (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_id      uuid        REFERENCES repurposed_clips(id) ON DELETE SET NULL,
  clip_title   text        NOT NULL DEFAULT '',
  platform     text        NOT NULL DEFAULT 'youtube_shorts',
  interval_hours integer   NOT NULL DEFAULT 24,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  status       text        NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE publish_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own queue"
  ON publish_queue FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own queue"
  ON publish_queue FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own queue"
  ON publish_queue FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own queue"
  ON publish_queue FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS publish_queue_user_id_idx ON publish_queue(user_id);

-- ── metadata_json on repurposed_clips ─────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'repurposed_clips' AND column_name = 'metadata_json'
  ) THEN
    ALTER TABLE repurposed_clips
      ADD COLUMN metadata_json jsonb NOT NULL DEFAULT '{"viralTitles":[],"seoDescription":"","hashtags":[],"algorithmicTags":[]}'::jsonb;
  END IF;
END $$;

-- ── source_video_url on repurposed_clips ──────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'repurposed_clips' AND column_name = 'source_video_url'
  ) THEN
    ALTER TABLE repurposed_clips ADD COLUMN source_video_url text NOT NULL DEFAULT '';
  END IF;
END $$;
