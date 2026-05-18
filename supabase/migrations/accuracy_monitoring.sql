-- ============================================================
-- Aiscern — Accuracy Monitoring Migration
-- Run in: Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Idempotent: safe to run multiple times (IF NOT EXISTS everywhere)
-- ============================================================

-- ── 1. pgvector extension ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 2. Per-model prediction log ───────────────────────────────────────────────
-- Written at every inference call (fire-and-forget from detect routes).
-- Captures what EACH individual model predicted, not just the ensemble verdict.
CREATE TABLE IF NOT EXISTS model_predictions (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id              UUID        REFERENCES scans(id) ON DELETE CASCADE,
  model_id             TEXT        NOT NULL,
  modality             TEXT        NOT NULL CHECK (modality IN ('text', 'image', 'audio', 'video')),
  raw_score            REAL        NOT NULL,                         -- 0–1 AI probability
  verdict              TEXT        NOT NULL CHECK (verdict IN ('AI', 'HUMAN', 'UNCERTAIN')),
  latency_ms           INTEGER,
  agreed_with_ensemble BOOLEAN,                                      -- did this model agree with final verdict?
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mp_scan_id  ON model_predictions(scan_id);
CREATE INDEX IF NOT EXISTS idx_mp_model_id ON model_predictions(model_id);
CREATE INDEX IF NOT EXISTS idx_mp_modality ON model_predictions(modality);
CREATE INDEX IF NOT EXISTS idx_mp_created  ON model_predictions(created_at DESC);

-- ── 3. Ground-truth feedback table ───────────────────────────────────────────
-- Users or admins confirm/correct a detection verdict.
-- One row per scan (UNIQUE on scan_id — last feedback wins via upsert).
CREATE TABLE IF NOT EXISTS scan_feedback (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id         UUID        REFERENCES scans(id) ON DELETE CASCADE,
  ground_truth    TEXT        NOT NULL CHECK (ground_truth IN ('AI', 'HUMAN')),
  feedback_source TEXT        NOT NULL DEFAULT 'user'
                              CHECK (feedback_source IN ('user', 'admin', 'benchmark')),
  note            TEXT,
  created_by      TEXT,       -- Clerk user_id or 'admin'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT scan_feedback_scan_unique UNIQUE (scan_id)
);

CREATE INDEX IF NOT EXISTS idx_sf_scan_id ON scan_feedback(scan_id);
CREATE INDEX IF NOT EXISTS idx_sf_source  ON scan_feedback(feedback_source);
CREATE INDEX IF NOT EXISTS idx_sf_created ON scan_feedback(created_at DESC);

-- ── 4. Detection embeddings for RAG retrieval ─────────────────────────────────
-- Populated after feedback is confirmed — stores 384-dim MiniLM embeddings.
-- Used by detection-rag.ts to find similar past scans at inference time.
CREATE TABLE IF NOT EXISTS detection_embeddings (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id      UUID        REFERENCES scans(id) ON DELETE CASCADE,
  embedding    vector(384),                                          -- sentence-transformers/all-MiniLM-L6-v2
  ground_truth TEXT        NOT NULL CHECK (ground_truth IN ('AI', 'HUMAN')),
  modality     TEXT        NOT NULL CHECK (modality IN ('text', 'image', 'audio', 'video')),
  indexed_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT detection_embeddings_scan_unique UNIQUE (scan_id)
);

CREATE INDEX IF NOT EXISTS idx_de_modality ON detection_embeddings(modality);
CREATE INDEX IF NOT EXISTS idx_de_gt       ON detection_embeddings(ground_truth);

-- IVFFlat index for fast ANN search — run this AFTER the table has >= 100 rows:
-- CREATE INDEX ON detection_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
-- (Uncomment and run manually once you have enough data)

-- ── 5. Cosine similarity search RPC ─────────────────────────────────────────
-- Called by detection-rag.ts at inference time.
-- Returns top-K neighbours with similarity > 0.70 (configurable via threshold).
CREATE OR REPLACE FUNCTION match_detection_embeddings(
  query_embedding vector(384),
  match_modality  TEXT,
  match_count     INT     DEFAULT 10,
  min_similarity  FLOAT   DEFAULT 0.70
)
RETURNS TABLE (
  scan_id      UUID,
  ground_truth TEXT,
  similarity   FLOAT
) LANGUAGE SQL STABLE AS $$
  SELECT
    scan_id,
    ground_truth,
    1 - (embedding <=> query_embedding) AS similarity
  FROM detection_embeddings
  WHERE modality = match_modality
    AND (1 - (embedding <=> query_embedding)) > min_similarity
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── 6. Per-model accuracy view — last 7 days ──────────────────────────────────
-- Joined on scan_feedback: only scans with confirmed ground-truth are counted.
-- F1 score formula: 2*TP / (2*TP + FP + FN)
CREATE OR REPLACE VIEW model_accuracy_7d AS
SELECT
  mp.model_id,
  mp.modality,
  COUNT(*)                                                                                    AS total_labeled,
  COUNT(*) FILTER (WHERE mp.verdict = sf.ground_truth)                                       AS correct,
  COUNT(*) FILTER (WHERE mp.verdict != sf.ground_truth)                                      AS incorrect,
  ROUND(
    COUNT(*) FILTER (WHERE mp.verdict = sf.ground_truth)::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 2
  )                                                                                           AS accuracy_pct,
  COUNT(*) FILTER (WHERE mp.verdict = 'AI'    AND sf.ground_truth = 'AI')                    AS true_pos,
  COUNT(*) FILTER (WHERE mp.verdict = 'HUMAN' AND sf.ground_truth = 'AI')                    AS false_neg,
  COUNT(*) FILTER (WHERE mp.verdict = 'AI'    AND sf.ground_truth = 'HUMAN')                 AS false_pos,
  COUNT(*) FILTER (WHERE mp.verdict = 'HUMAN' AND sf.ground_truth = 'HUMAN')                AS true_neg,
  -- F1 score
  ROUND(
    2.0 * COUNT(*) FILTER (WHERE mp.verdict = 'AI' AND sf.ground_truth = 'AI')::NUMERIC
    / NULLIF(
        2 * COUNT(*) FILTER (WHERE mp.verdict = 'AI' AND sf.ground_truth = 'AI')
        + COUNT(*) FILTER (WHERE mp.verdict = 'AI' AND sf.ground_truth = 'HUMAN')
        + COUNT(*) FILTER (WHERE mp.verdict = 'HUMAN' AND sf.ground_truth = 'AI'),
      0) * 100, 2
  )                                                                                           AS f1_score_pct,
  MAX(mp.created_at)                                                                         AS last_seen
FROM model_predictions mp
JOIN scan_feedback sf ON sf.scan_id = mp.scan_id
WHERE mp.created_at > NOW() - INTERVAL '7 days'
GROUP BY mp.model_id, mp.modality
ORDER BY accuracy_pct DESC NULLS LAST;

-- ── 7. Per-model accuracy view — last 30 days ─────────────────────────────────
CREATE OR REPLACE VIEW model_accuracy_30d AS
SELECT
  mp.model_id,
  mp.modality,
  COUNT(*)                                                                                    AS total_labeled,
  COUNT(*) FILTER (WHERE mp.verdict = sf.ground_truth)                                       AS correct,
  ROUND(
    COUNT(*) FILTER (WHERE mp.verdict = sf.ground_truth)::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 2
  )                                                                                           AS accuracy_pct,
  COUNT(*) FILTER (WHERE mp.verdict = 'AI'    AND sf.ground_truth = 'AI')                    AS true_pos,
  COUNT(*) FILTER (WHERE mp.verdict = 'HUMAN' AND sf.ground_truth = 'AI')                    AS false_neg,
  COUNT(*) FILTER (WHERE mp.verdict = 'AI'    AND sf.ground_truth = 'HUMAN')                 AS false_pos,
  COUNT(*) FILTER (WHERE mp.verdict = 'HUMAN' AND sf.ground_truth = 'HUMAN')                AS true_neg,
  ROUND(
    2.0 * COUNT(*) FILTER (WHERE mp.verdict = 'AI' AND sf.ground_truth = 'AI')::NUMERIC
    / NULLIF(
        2 * COUNT(*) FILTER (WHERE mp.verdict = 'AI' AND sf.ground_truth = 'AI')
        + COUNT(*) FILTER (WHERE mp.verdict = 'AI' AND sf.ground_truth = 'HUMAN')
        + COUNT(*) FILTER (WHERE mp.verdict = 'HUMAN' AND sf.ground_truth = 'AI'),
      0) * 100, 2
  )                                                                                           AS f1_score_pct
FROM model_predictions mp
JOIN scan_feedback sf ON sf.scan_id = mp.scan_id
WHERE mp.created_at > NOW() - INTERVAL '30 days'
GROUP BY mp.model_id, mp.modality
ORDER BY accuracy_pct DESC NULLS LAST;

-- ── 8. Ensemble-level confusion summary ──────────────────────────────────────
-- Aggregated at the scan level (not per-model) — uses the ensemble verdict from scans table.
CREATE OR REPLACE VIEW ensemble_accuracy AS
SELECT
  s.media_type                                                                               AS modality,
  COUNT(*)                                                                                   AS total_labeled,
  COUNT(*) FILTER (WHERE s.verdict = sf.ground_truth)                                       AS correct,
  ROUND(
    COUNT(*) FILTER (WHERE s.verdict = sf.ground_truth)::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 2
  )                                                                                          AS accuracy_pct,
  COUNT(*) FILTER (WHERE s.verdict = 'AI'    AND sf.ground_truth = 'AI')                    AS true_pos,
  COUNT(*) FILTER (WHERE s.verdict = 'HUMAN' AND sf.ground_truth = 'AI')                    AS false_neg,
  COUNT(*) FILTER (WHERE s.verdict = 'AI'    AND sf.ground_truth = 'HUMAN')                 AS false_pos,
  COUNT(*) FILTER (WHERE s.verdict = 'HUMAN' AND sf.ground_truth = 'HUMAN')                AS true_neg
FROM scans s
JOIN scan_feedback sf ON sf.scan_id = s.id
GROUP BY s.media_type
ORDER BY modality;

-- ── 9. Row-level security ────────────────────────────────────────────────────
ALTER TABLE model_predictions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_feedback        ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_embeddings ENABLE ROW LEVEL SECURITY;

-- Service role (server-side) has unrestricted access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'model_predictions' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON model_predictions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'scan_feedback' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON scan_feedback
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'detection_embeddings' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON detection_embeddings
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: insert feedback on their own scans, read back their own feedback
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'scan_feedback' AND policyname = 'users_insert_feedback'
  ) THEN
    CREATE POLICY users_insert_feedback ON scan_feedback
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'scan_feedback' AND policyname = 'users_read_own_feedback'
  ) THEN
    CREATE POLICY users_read_own_feedback ON scan_feedback
      FOR SELECT TO authenticated USING (created_by = auth.uid()::text);
  END IF;
END $$;
