/*
  # Fix missing columns and reload PostgREST schema cache

  1. Changes
     - Add `created_at` column to `video_sources` (queried by HistoryScreen)
     - Notify PostgREST to reload its schema cache, which fixes the
       "Could not find column in schema cache" 404 errors

  2. Notes
     - `credits_used` already exists on `users` — the 404 was caused by the
       stale cache, not a truly missing column
     - NOTIFY pgrst.reload triggers an immediate cache refresh without a restart
*/

-- Add missing created_at to video_sources
ALTER TABLE video_sources
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Reload PostgREST schema cache to clear stale column metadata
NOTIFY pgrst, 'reload schema';
