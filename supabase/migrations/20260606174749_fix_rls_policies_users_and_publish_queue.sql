-- ── users: drop open policies ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for users"    ON public.users;
DROP POLICY IF EXISTS "Allow public select"    ON public.users;

-- Users may only read and update their own row.
-- INSERT is handled by the handle_new_user trigger (service-role), so no INSERT policy needed.
-- DELETE is intentionally omitted to prevent self-deletion via the API.
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── publish_queue: drop open policies ────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for publish_queue"                   ON public.publish_queue;
DROP POLICY IF EXISTS "Allow authenticated users to read own data"    ON public.publish_queue;

CREATE POLICY "publish_queue_select_own" ON public.publish_queue
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "publish_queue_insert_own" ON public.publish_queue
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "publish_queue_update_own" ON public.publish_queue
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "publish_queue_delete_own" ON public.publish_queue
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
