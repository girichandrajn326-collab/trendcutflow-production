/*
  # Auto-create user profile on signup via trigger

  ## Problem
  The client-side INSERT into public.users after signUp() fails because
  the RLS policy checks auth.uid() = id, but the session JWT is not yet
  committed in the browser context at the moment of the insert call.

  ## Solution
  A SECURITY DEFINER trigger on auth.users fires after each new row is
  inserted, creating the corresponding public.users profile automatically.
  This runs with elevated privileges on the server side, so RLS never
  blocks it.

  ## Changes
  - New function: `handle_new_user()` — inserts into public.users using
    the new auth.users row values. Safe to call multiple times (ON CONFLICT DO NOTHING).
  - New trigger: `on_auth_user_created` — fires AFTER INSERT on auth.users.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, current_plan, total_credits, credits_used)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'FREE',
    1,
    0
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
