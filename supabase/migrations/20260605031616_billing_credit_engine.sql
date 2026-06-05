-- ─── 1. Add `credits` column to users ────────────────────────────────────────
-- Direct remaining-balance column. The webhook will SET this on purchase.
-- The consume_credit RPC will DECREMENT it on use.
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 0;

-- Hydrate existing rows from the derived balance so nothing breaks.
UPDATE users SET credits = GREATEST(total_credits - credits_used, 0)
WHERE credits = 0 AND total_credits > 0;

-- ─── 2. subscriptions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_name             text        NOT NULL,
  status                text        NOT NULL DEFAULT 'active',
  razorpay_payment_id   text,
  razorpay_order_id     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions(user_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can view their own subscription history (service role writes)
CREATE POLICY "select_own_subscriptions" ON subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- ─── 3. credit_transactions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      integer     NOT NULL,   -- positive = granted, negative = consumed
  reason      text        NOT NULL,   -- 'plan_purchase' | 'video_processed' | 'manual_grant'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_transactions_user_id_idx ON credit_transactions(user_id);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Users can view their own transaction log (service role writes)
CREATE POLICY "select_own_credit_transactions" ON credit_transactions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- ─── 4. RPC: can_process_video ────────────────────────────────────────────────
-- Lightweight guard — call before starting any processing job.
CREATE OR REPLACE FUNCTION can_process_video(uid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining integer;
BEGIN
  SELECT credits INTO remaining FROM users WHERE id = uid;
  RETURN COALESCE(remaining, 0) > 0;
END;
$$;

REVOKE ALL ON FUNCTION can_process_video(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_process_video(uuid) TO authenticated, service_role;

-- ─── 5. RPC: consume_credit ───────────────────────────────────────────────────
-- Atomically decrements credits and logs the transaction.
-- Raises an exception if the user has no credits remaining.
CREATE OR REPLACE FUNCTION consume_credit(uid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining integer;
BEGIN
  -- Row-level lock ensures two concurrent requests can't both pass the check
  SELECT credits INTO remaining FROM users WHERE id = uid FOR UPDATE;

  IF remaining IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF remaining <= 0 THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  -- Decrement remaining balance and advance the usage counter
  UPDATE users
     SET credits      = credits - 1,
         credits_used = credits_used + 1
   WHERE id = uid;

  -- Audit trail
  INSERT INTO credit_transactions (user_id, amount, reason)
  VALUES (uid, -1, 'video_processed');

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION consume_credit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_credit(uuid) TO authenticated, service_role;
