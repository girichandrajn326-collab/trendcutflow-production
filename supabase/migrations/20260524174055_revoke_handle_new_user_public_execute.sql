/*
  # Revoke public EXECUTE on handle_new_user()

  handle_new_user() is a SECURITY DEFINER trigger function called only by the
  auth.users trigger — it must never be callable directly via the REST API by
  anon or authenticated roles.

  Revoke EXECUTE from both roles and from PUBLIC (which grants to all future
  roles by default).
*/

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
