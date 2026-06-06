-- ── 1. Fix column defaults ────────────────────────────────────────────────────
ALTER TABLE public.users ALTER COLUMN total_credits SET DEFAULT 1;
ALTER TABLE public.users ALTER COLUMN credits      SET DEFAULT 1;

-- ── 2. Recreate handle_new_user with correct live-DB column names ─────────────
--    Live schema has `full_name` (not `name`) and `current_plan` as text `'free'`
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, current_plan, total_credits, credits_used, credits)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    'free',
    1,
    0,
    1
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 3. Backfill existing users who got 0 total_credits (broken default) ───────
UPDATE public.users
SET
  total_credits = 1,
  credits       = GREATEST(1 - credits_used, 0)
WHERE total_credits = 0;
