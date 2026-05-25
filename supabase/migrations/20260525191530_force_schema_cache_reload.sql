/*
  # Force PostgREST schema cache reload

  credits_used and all other columns already exist. This migration purely
  triggers a cache refresh so PostgREST stops returning 404s for columns
  it has already introspected.
*/

NOTIFY pgrst, 'reload schema';
