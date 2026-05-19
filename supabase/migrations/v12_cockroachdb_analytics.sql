-- =============================================================================
-- Aiscern v12 — ANALYTICS DB Schema (CockroachDB Serverless)
-- Run against COCKROACH_URL
-- Command: psql $COCKROACH_URL -f v12_cockroachdb_analytics.sql
-- =============================================================================

-- ── 1. Prediction logs — raw ML inference records ──────────────────────────
CREATE TABLE IF NOT EXISTS prediction_logs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id         STRING       NOT NULL,
  user_id         STRING       NOT NULL,
  scan_type       STRING       NOT NULL,
  model_id        STRING       NOT NULL,       -- 'hf:roberta-ai-detector', 'gemini:2.0-flash', etc.
  model_version   STRING,
  raw_score       DECIMAL(5,4),
  verdict         STRING       CHECK(verdict IN ('ai','human','uncertain')),
  confidence      DECIMAL(5,4),
  latency_ms      INT,
  token_count     INT,                         -- for text models
  error           STRING,                      -- null if successful
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pred_logs_scan_id   ON prediction_logs(scan_id);
CREATE INDEX IF NOT EXISTS idx_pred_logs_user_id   ON prediction_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pred_logs_model     ON prediction_logs(model_id);
CREATE INDEX IF NOT EXISTS idx_pred_logs_created   ON prediction_logs(created_at DESC);

-- ── 2. Accuracy metrics — ground-truth feedback for model calibration ───────
CREATE TABLE IF NOT EXISTS accuracy_metrics (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id         STRING       NOT NULL,
  model_id        STRING       NOT NULL,
  predicted       STRING       NOT NULL CHECK(predicted IN ('ai','human','uncertain')),
  ground_truth    STRING       NOT NULL CHECK(ground_truth IN ('ai','human')),
  feedback_source STRING       NOT NULL CHECK(feedback_source IN ('user','admin','automated')),
  user_id         STRING,
  confidence      DECIMAL(5,4),
  is_correct      BOOL         GENERATED ALWAYS AS (predicted = ground_truth) STORED,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accuracy_model    ON accuracy_metrics(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accuracy_correct  ON accuracy_metrics(is_correct, model_id);
CREATE INDEX IF NOT EXISTS idx_accuracy_scan     ON accuracy_metrics(scan_id);

-- ── 3. User activity — append-only event stream ─────────────────────────────
CREATE TABLE IF NOT EXISTS user_activity (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      STRING      NOT NULL,
  event_type   STRING      NOT NULL,   -- 'scan:text', 'credit_purchase', 'login', etc.
  metadata     JSONB       DEFAULT '{}',
  ip_address   STRING,
  user_agent   STRING,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user_id  ON user_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_event    ON user_activity(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_created  ON user_activity(created_at DESC);

-- ── 4. API usage logs — per-key request tracking ───────────────────────────
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      STRING      NOT NULL,
  user_id         STRING      NOT NULL,
  endpoint        STRING      NOT NULL,
  method          STRING      NOT NULL,
  status_code     INT         NOT NULL,
  latency_ms      INT,
  request_size    INT,
  response_size   INT,
  scan_type       STRING,
  ip_address      STRING,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_key     ON api_usage_logs(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_user    ON api_usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_logs(created_at DESC);

-- ── 5. Performance logs — infrastructure latency tracking ──────────────────
CREATE TABLE IF NOT EXISTS performance_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  origin       STRING      NOT NULL,  -- 'vercel', 'netlify', 'cloudflare'
  endpoint     STRING      NOT NULL,
  method       STRING      NOT NULL,
  latency_ms   INT         NOT NULL,
  status_code  INT,
  region       STRING,
  error        STRING,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_perf_origin  ON performance_logs(origin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_created ON performance_logs(created_at DESC);

-- ── 6. Feedback logs — user thumbs-up/down on scan results ─────────────────
CREATE TABLE IF NOT EXISTS feedback_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id      STRING      NOT NULL,
  user_id      STRING      NOT NULL,
  rating       INT         NOT NULL CHECK(rating IN (1, -1)),  -- 1=correct, -1=wrong
  comment      STRING,
  ground_truth STRING      CHECK(ground_truth IN ('ai','human')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_scan_id ON feedback_logs(scan_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback_logs(user_id, created_at DESC);

-- ── 7. Saga outbox — distributed transaction audit trail ───────────────────
CREATE TABLE IF NOT EXISTS saga_outbox (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  saga_id    STRING      NOT NULL,
  saga_name  STRING      NOT NULL,
  step_name  STRING      NOT NULL,
  status     STRING      NOT NULL CHECK(status IN ('started','completed','failed','compensated')),
  payload    JSONB,
  error      STRING,
  created_at STRING      NOT NULL    -- ISO string from application (avoids tz issues)
);

CREATE INDEX IF NOT EXISTS idx_outbox_saga_id   ON saga_outbox(saga_id);
CREATE INDEX IF NOT EXISTS idx_outbox_created   ON saga_outbox(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_status    ON saga_outbox(status) WHERE status IN ('failed','compensated');
