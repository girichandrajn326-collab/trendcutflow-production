-- ── processing_jobs table ──────────────────────────────────────────────────
-- Tracks every async video processing job end-to-end.
-- Status lifecycle: queued → downloading → audio_check → extracting_audio →
--   transcribing → detecting → slicing → completed | failed
CREATE TABLE IF NOT EXISTS processing_jobs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_path     text,
  source_type      text        NOT NULL DEFAULT 'file',
  source_url       text,
  original_name    text,
  status           text        NOT NULL DEFAULT 'queued',
  progress         integer     NOT NULL DEFAULT 0,
  step_detail      text,
  has_audio        boolean,
  result           jsonb,
  error_message    text,
  credits_consumed boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processing_jobs_user_id_idx ON processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS processing_jobs_status_idx  ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS processing_jobs_created_idx ON processing_jobs(created_at DESC);

ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own jobs (required for polling + Realtime)
CREATE POLICY "select_own_jobs" ON processing_jobs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- Service role (edge functions) handles all writes; client only needs SELECT
-- No INSERT/UPDATE/DELETE policies needed for authenticated role

-- ── Supabase Storage bucket ────────────────────────────────────────────────
-- Private bucket; the start-job edge function uploads using service_role key.
-- No client-side storage policies needed — the edge function is the sole writer.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'video-uploads',
  'video-uploads',
  false,
  536870912, -- 512 MB
  ARRAY[
    'video/mp4', 'video/webm', 'video/quicktime',
    'video/x-matroska', 'video/avi', 'video/mpeg',
    'video/x-msvideo', 'video/3gpp', 'video/3gpp2'
  ]
)
ON CONFLICT (id) DO NOTHING;
