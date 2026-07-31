/*
# Allow client-side writes to processing_jobs and processing_logs

## Why
The app is being refactored to run the video processing pipeline entirely
client-side (calling Groq/OpenAI directly from the browser) instead of
through Supabase Edge Functions. Previously only the service role could
insert/update these tables. Now the authenticated client needs INSERT
and UPDATE access to:
- processing_jobs: insert a new job row, update its status as the pipeline progresses
- processing_logs: insert log rows for observability

## Changes
1. processing_jobs: add INSERT + UPDATE policies scoped to the owning user
2. processing_logs: add INSERT policy scoped to the owning user
   (SELECT was already granted to authenticated)

## Security
- All policies use auth.uid() ownership checks
- No DELETE policies added (not needed client-side)
- No changes to existing SELECT policies
*/

-- ── processing_jobs: INSERT + UPDATE for authenticated owners ──────────────
DROP POLICY IF EXISTS "insert_own_processing_jobs" ON processing_jobs;
CREATE POLICY "insert_own_processing_jobs"
  ON processing_jobs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_processing_jobs" ON processing_jobs;
CREATE POLICY "update_own_processing_jobs"
  ON processing_jobs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── processing_logs: INSERT for authenticated owners ───────────────────────
DROP POLICY IF EXISTS "insert_own_processing_logs" ON processing_logs;
CREATE POLICY "insert_own_processing_logs"
  ON processing_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
