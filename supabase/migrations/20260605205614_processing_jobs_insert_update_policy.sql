-- Allow authenticated users to insert their own processing_jobs rows.
-- This enables a fully decoupled frontend: upload → INSERT → worker picks it up.
-- The server-side credit check still happens in start-job before inserting.
CREATE POLICY "insert_own_jobs" ON processing_jobs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own jobs (needed for future retry/cancel UI).
CREATE POLICY "update_own_jobs" ON processing_jobs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
