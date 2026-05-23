/*
  # TrendCutFlow Core Schema

  ## Summary
  Creates the full application schema for TrendCutFlow, a SaaS video repurposing platform.

  ## New Tables

  ### 1. `users`
  Mirrors Supabase auth.users with app-specific profile data.
  - `id` — UUID, matches auth.uid()
  - `email` — unique user email
  - `name` — display name
  - `current_plan` — plan tier enum (FREE / CREATOR / PRO), default FREE
  - `total_credits` — monthly processing credits allotted to the plan
  - `credits_used` — count of videos processed this cycle
  - `created_at` — row creation timestamp

  ### 2. `video_sources`
  One row per uploaded/linked source video.
  - `id` — UUID PK
  - `user_id` — FK → users.id (cascade delete)
  - `title` — video title
  - `source_url` — storage URL or external link
  - `status` — processing lifecycle enum (PENDING / PROCESSING / COMPLETED / FAILED)
  - `duration` — integer seconds

  ### 3. `repurposed_clips`
  Short clips generated from a source video.
  - `id` — UUID PK
  - `video_source_id` — FK → video_sources.id (cascade delete)
  - `start_time` / `end_time` — float seconds within source
  - `clip_storage_url` — Supabase Storage URL for the rendered clip
  - `transcript_json` — JSONB blob `{ words: [{id, word, start_ms, end_ms}] }`
  - `ai_title` / `ai_description` — AI-generated metadata
  - `is_queued` — whether clip is in the delayed publish queue

  ### 4. `integrations`
  Social platform OAuth tokens per user.
  - `id` — UUID PK
  - `user_id` — FK → users.id (cascade delete)
  - `platform` — e.g. 'youtube', 'instagram', 'tiktok'
  - `encrypted_refresh_token` — encrypted OAuth refresh token
  - Unique constraint on (user_id, platform)

  ## Enums
  - `plan_tier`: FREE, CREATOR, PRO
  - `video_status`: PENDING, PROCESSING, COMPLETED, FAILED

  ## Security
  - RLS enabled on all four tables
  - Users can only read/write their own rows (auth.uid() checks throughout)
  - video_sources and repurposed_clips secured transitively through user_id ownership checks
*/

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE plan_tier AS ENUM ('FREE', 'CREATOR', 'PRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE video_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text UNIQUE NOT NULL,
  name            text NOT NULL DEFAULT '',
  current_plan    plan_tier NOT NULL DEFAULT 'FREE',
  total_credits   integer NOT NULL DEFAULT 1,
  credits_used    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can delete own profile"
  ON users FOR DELETE
  TO authenticated
  USING (auth.uid() = id);

-- ─── video_sources ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS video_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '',
  source_url  text NOT NULL DEFAULT '',
  status      video_status NOT NULL DEFAULT 'PENDING',
  duration    integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS video_sources_user_id_idx ON video_sources(user_id);

ALTER TABLE video_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own video sources"
  ON video_sources FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own video sources"
  ON video_sources FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own video sources"
  ON video_sources FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own video sources"
  ON video_sources FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ─── repurposed_clips ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repurposed_clips (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_source_id   uuid NOT NULL REFERENCES video_sources(id) ON DELETE CASCADE,
  start_time        double precision NOT NULL DEFAULT 0,
  end_time          double precision NOT NULL DEFAULT 0,
  clip_storage_url  text NOT NULL DEFAULT '',
  transcript_json   jsonb NOT NULL DEFAULT '{"words":[]}'::jsonb,
  ai_title          text NOT NULL DEFAULT '',
  ai_description    text NOT NULL DEFAULT '',
  is_queued         boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS repurposed_clips_video_source_id_idx ON repurposed_clips(video_source_id);

ALTER TABLE repurposed_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own clips"
  ON repurposed_clips FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_sources vs
      WHERE vs.id = repurposed_clips.video_source_id
        AND vs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own clips"
  ON repurposed_clips FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM video_sources vs
      WHERE vs.id = repurposed_clips.video_source_id
        AND vs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own clips"
  ON repurposed_clips FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_sources vs
      WHERE vs.id = repurposed_clips.video_source_id
        AND vs.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM video_sources vs
      WHERE vs.id = repurposed_clips.video_source_id
        AND vs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own clips"
  ON repurposed_clips FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM video_sources vs
      WHERE vs.id = repurposed_clips.video_source_id
        AND vs.user_id = auth.uid()
    )
  );

-- ─── integrations ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS integrations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform                  text NOT NULL,
  encrypted_refresh_token   text NOT NULL DEFAULT '',
  UNIQUE (user_id, platform)
);

CREATE INDEX IF NOT EXISTS integrations_user_id_idx ON integrations(user_id);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own integrations"
  ON integrations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own integrations"
  ON integrations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own integrations"
  ON integrations FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own integrations"
  ON integrations FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
