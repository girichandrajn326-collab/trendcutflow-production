-- Revoke EXECUTE on SECURITY DEFINER functions from anon and authenticated roles.
-- These functions are only called server-side from Edge Functions using the
-- service_role key, so anon/authenticated should not be able to invoke them
-- directly via /rest/v1/rpc/.

REVOKE EXECUTE ON FUNCTION public.can_process_video(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_credit(uuid) FROM anon, authenticated;

-- Grant EXECUTE only to service_role (used by Edge Functions).
GRANT EXECUTE ON FUNCTION public.can_process_video(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credit(uuid) TO service_role;
