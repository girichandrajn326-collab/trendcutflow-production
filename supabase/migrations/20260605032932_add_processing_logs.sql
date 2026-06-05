-- ─── processing_logs ─────────────────────────────────────────────────────────
-- One row per pipeline step execution. Used for observability and debugging.

CREATE TABLE IF NOT EXISTS processing_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        REFERENCES users(id) ON DELETE SET NULL,
  video_source_id uuid        REFERENCES video_sources(id) ON DELETE SET NULL,
  step            text        NOT NULL,  -- 'download' | 'transcribe' | 'segment' | 'render'
  status          text        NOT NULL,  -- 'pending' | 'success' | 'error'
  message         text,
  error_code      text,                  -- specific FFmpeg/yt-dlp exit codes
  duration_ms     integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processing_logs_user_id_idx     ON processing_logs(user_id);
CREATE INDEX IF NOT EXISTS processing_logs_video_source_idx ON processing_logs(video_source_id);
CREATE INDEX IF NOT EXISTS processing_logs_step_status_idx  ON processing_logs(step, status);

ALTER TABLE processing_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own logs; service role writes
CREATE POLICY "select_own_processing_logs" ON processing_logs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
