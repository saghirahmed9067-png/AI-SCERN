-- =============================================================================
-- Aiscern v10 — Credits, Billing & Scan Limits (Supabase / AUTH DB)
-- Run in Supabase SQL Editor (service role)
-- =============================================================================

-- ── 1. Add credits_balance + plan columns to profiles ──────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS credits_balance  INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan             TEXT      NOT NULL DEFAULT 'free'
                                            CHECK(plan IN ('free','starter','pro','enterprise')),
  ADD COLUMN IF NOT EXISTS plan_period      TEXT      CHECK(plan_period IN ('monthly','yearly')),
  ADD COLUMN IF NOT EXISTS plan_updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email            TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_credits ON profiles(credits_balance);
CREATE INDEX IF NOT EXISTS idx_profiles_plan    ON profiles(plan);

-- ── 2. Plan limits table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_limits (
  plan             TEXT PRIMARY KEY,
  daily_scans      INTEGER NOT NULL DEFAULT 10,   -- -1 = unlimited
  credits_included INTEGER NOT NULL DEFAULT 0,
  modalities       TEXT[]  NOT NULL DEFAULT ARRAY['text','image'],
  overage_allowed  BOOLEAN NOT NULL DEFAULT false,
  credits_per_scan INTEGER NOT NULL DEFAULT 1
);

INSERT INTO plan_limits (plan, daily_scans, credits_included, modalities, overage_allowed) VALUES
  ('free',       10,  0,    ARRAY['text','image'],                            false),
  ('starter',    100, 100,  ARRAY['text','image','audio','video','url'],       false),
  ('pro',        500, 500,  ARRAY['text','image','audio','video','url','batch'], true),
  ('enterprise', -1,  9999, ARRAY['text','image','audio','video','url','batch'], true)
ON CONFLICT (plan) DO UPDATE SET
  daily_scans      = EXCLUDED.daily_scans,
  credits_included = EXCLUDED.credits_included,
  modalities       = EXCLUDED.modalities,
  overage_allowed  = EXCLUDED.overage_allowed;

-- ── 3. Daily scan counters table (reset nightly via pg_cron) ───────────────
CREATE TABLE IF NOT EXISTS user_scan_counts (
  user_id     TEXT        NOT NULL,
  scan_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  daily_count INTEGER     NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, scan_date)
);

CREATE INDEX IF NOT EXISTS idx_scan_counts_date ON user_scan_counts(scan_date);

-- ── 4. Credit transactions table (immutable ledger) ───────────────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT         NOT NULL,
  order_id     TEXT         UNIQUE,                         -- XPay order reference
  transaction_type TEXT     NOT NULL CHECK(transaction_type IN
                             ('purchase','deduction','refund','bonus','admin_grant')),
  credits      INTEGER      NOT NULL,                       -- positive = added, negative = deducted
  amount_pkr   INTEGER,                                     -- for purchases only (in rupees)
  amount_usd   NUMERIC(10,2),
  plan_id      TEXT,                                        -- which plan was purchased
  status       TEXT         NOT NULL DEFAULT 'completed'
               CHECK(status IN ('pending','completed','failed','voided','refunded')),
  scan_id      TEXT,                                        -- for deduction rows
  metadata     JSONB        DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_txn_user_id    ON credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_txn_order_id   ON credit_transactions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_txn_status     ON credit_transactions(status);
CREATE INDEX IF NOT EXISTS idx_credit_txn_created_at ON credit_transactions(created_at DESC);

-- ── 5. check_and_increment_scan() — atomic credit + scan guard ─────────────
-- Called by credit-guard on every scan request.
-- Returns: allowed, reason, plan, daily_scans, daily_limit, upgrade_required
CREATE OR REPLACE FUNCTION check_and_increment_scan(
  p_user_id    TEXT,
  p_media_type TEXT
)
RETURNS TABLE(
  allowed          BOOLEAN,
  reason           TEXT,
  plan             TEXT,
  daily_scans      INTEGER,
  daily_limit      INTEGER,
  upgrade_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan           TEXT;
  v_credits        INTEGER;
  v_daily_count    INTEGER;
  v_daily_limit    INTEGER;
  v_modalities     TEXT[];
  v_overage        BOOLEAN;
  v_credits_cost   INTEGER := 1;
BEGIN
  -- Fetch user profile
  SELECT p.plan, p.credits_balance
  INTO   v_plan, v_credits
  FROM   profiles p
  WHERE  p.id = p_user_id
  FOR UPDATE;  -- lock row to prevent race conditions

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'user_not_found'::TEXT, 'free'::TEXT, 0, 10, true;
    RETURN;
  END IF;

  -- Fetch plan limits
  SELECT pl.daily_scans, pl.modalities, pl.overage_allowed, pl.credits_per_scan
  INTO   v_daily_limit, v_modalities, v_overage, v_credits_cost
  FROM   plan_limits pl
  WHERE  pl.plan = v_plan;

  IF NOT FOUND THEN
    -- Unknown plan → treat as free
    v_daily_limit  := 10;
    v_modalities   := ARRAY['text','image'];
    v_overage      := false;
    v_credits_cost := 1;
  END IF;

  -- Check modality access
  IF NOT (p_media_type = ANY(v_modalities)) THEN
    RETURN QUERY SELECT false, 'modality_not_included'::TEXT, v_plan, 0, v_daily_limit, true;
    RETURN;
  END IF;

  -- Get/create today's scan count
  INSERT INTO user_scan_counts(user_id, scan_date, daily_count)
  VALUES (p_user_id, CURRENT_DATE, 0)
  ON CONFLICT (user_id, scan_date) DO NOTHING;

  SELECT daily_count INTO v_daily_count
  FROM   user_scan_counts
  WHERE  user_id = p_user_id AND scan_date = CURRENT_DATE
  FOR UPDATE;

  -- Check daily limit (enterprise = -1 = unlimited)
  IF v_daily_limit != -1 AND v_daily_count >= v_daily_limit THEN
    -- If user has purchased credits and overage is allowed, let them continue
    IF v_overage AND v_credits >= v_credits_cost THEN
      -- Deduct from credit balance instead of daily counter
      UPDATE profiles SET credits_balance = credits_balance - v_credits_cost WHERE id = p_user_id;
      UPDATE user_scan_counts SET daily_count = daily_count + 1, updated_at = NOW()
      WHERE  user_id = p_user_id AND scan_date = CURRENT_DATE;
      RETURN QUERY SELECT true, 'credit_overage'::TEXT, v_plan, v_daily_count + 1, v_daily_limit, false;
      RETURN;
    END IF;

    RETURN QUERY SELECT false, 'daily_limit_reached'::TEXT, v_plan, v_daily_count, v_daily_limit, true;
    RETURN;
  END IF;

  -- Check purchased credit balance (free tier only has daily limit, no credit balance)
  IF v_plan != 'free' AND v_credits < v_credits_cost THEN
    RETURN QUERY SELECT false, 'modality_credits_exhausted'::TEXT, v_plan, v_daily_count, v_daily_limit, true;
    RETURN;
  END IF;

  -- All checks passed — increment counters atomically
  UPDATE user_scan_counts
  SET    daily_count = daily_count + 1, updated_at = NOW()
  WHERE  user_id = p_user_id AND scan_date = CURRENT_DATE;

  -- Deduct from credit balance for paid plans
  IF v_plan != 'free' THEN
    UPDATE profiles
    SET credits_balance = GREATEST(0, credits_balance - v_credits_cost)
    WHERE id = p_user_id;
  END IF;

  RETURN QUERY SELECT
    true,
    'allowed'::TEXT,
    v_plan,
    v_daily_count + 1,
    v_daily_limit,
    false;
END;
$$;

-- ── 6. Cleanup cron: reset daily scan counters at midnight PKT ─────────────
-- Requires pg_cron extension (enabled by default in Supabase)
SELECT cron.schedule(
  'reset-daily-scan-counts',
  '0 19 * * *',  -- 00:00 PKT = 19:00 UTC (UTC+5)
  $$DELETE FROM user_scan_counts WHERE scan_date < CURRENT_DATE$$
) ON CONFLICT DO NOTHING;

-- ── 7. RLS Policies ────────────────────────────────────────────────────────

ALTER TABLE plan_limits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_scan_counts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- plan_limits: public read
CREATE POLICY "Public read plan_limits" ON plan_limits FOR SELECT USING (true);

-- user_scan_counts: users see only their own
CREATE POLICY "Users read own scan counts" ON user_scan_counts
  FOR SELECT USING (user_id = auth.uid()::TEXT);
CREATE POLICY "Service write scan counts" ON user_scan_counts
  FOR ALL USING (auth.role() = 'service_role');

-- credit_transactions: users see own, service role writes
CREATE POLICY "Users read own transactions" ON credit_transactions
  FOR SELECT USING (user_id = auth.uid()::TEXT);
CREATE POLICY "Service write transactions" ON credit_transactions
  FOR ALL USING (auth.role() = 'service_role');

-- ── 8. Grant execute on check_and_increment_scan ───────────────────────────
GRANT EXECUTE ON FUNCTION check_and_increment_scan(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION check_and_increment_scan(TEXT, TEXT) TO authenticated;
