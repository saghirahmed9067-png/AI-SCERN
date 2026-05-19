-- =============================================================================
-- Aiscern v11 — HEAVY DB Schema (Neon PostgreSQL)
-- Run against NEON_DIRECT_URL (not the pooler — migrations need DDL locks)
-- Command: psql $NEON_DIRECT_URL -f v11_neon_heavy_schema.sql
-- =============================================================================

-- ── 1. Scans table (moved from Supabase to Neon for scale) ─────────────────
CREATE TABLE IF NOT EXISTS scans (
  id            TEXT         PRIMARY KEY,
  user_id       TEXT         NOT NULL,
  scan_type     TEXT         NOT NULL CHECK(scan_type IN ('text','image','audio','video','url','batch')),
  status        TEXT         NOT NULL DEFAULT 'processing'
                             CHECK(status IN ('queued','processing','completed','failed','cancelled')),
  verdict       TEXT         CHECK(verdict IN ('ai','human','uncertain')),
  confidence    NUMERIC(5,4),                             -- 0.0000 – 1.0000
  score         NUMERIC(5,4),
  file_url      TEXT,                                     -- R2 storage URL
  file_size     BIGINT,
  file_hash     TEXT,                                     -- SHA-256 for dedup
  input_text    TEXT,                                     -- for text scans
  page_url      TEXT,                                     -- for url scans
  batch_id      TEXT,                                     -- parent batch job if applicable
  metadata      JSONB        NOT NULL DEFAULT '{}',
  error_message TEXT,
  processing_ms INTEGER,                                  -- inference latency
  deleted_at    TIMESTAMPTZ,                              -- soft delete
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_user_id    ON scans(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_status     ON scans(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scans_type       ON scans(scan_type);
CREATE INDEX IF NOT EXISTS idx_scans_batch_id   ON scans(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scans_file_hash  ON scans(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scans_verdict    ON scans(verdict) WHERE deleted_at IS NULL;

-- ── 2. Forensic layers table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forensic_layers (
  id           BIGSERIAL    PRIMARY KEY,
  scan_id      TEXT         NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  layer_name   TEXT         NOT NULL,  -- e.g. 'provenance','compression','diffusion','semantic','ensemble'
  layer_order  INTEGER      NOT NULL,
  score        NUMERIC(5,4),
  verdict      TEXT         CHECK(verdict IN ('ai','human','uncertain')),
  confidence   NUMERIC(5,4),
  raw_output   JSONB        DEFAULT '{}',
  model_id     TEXT,                   -- which HF/Gemini/NIM model ran this layer
  latency_ms   INTEGER,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forensic_scan_id ON forensic_layers(scan_id);
CREATE INDEX IF NOT EXISTS idx_forensic_layer   ON forensic_layers(layer_name);

-- ── 3. File metadata table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_metadata (
  id              BIGSERIAL   PRIMARY KEY,
  scan_id         TEXT        NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  original_name   TEXT,
  mime_type       TEXT,
  file_size       BIGINT,
  r2_key          TEXT,       -- Cloudflare R2 object key
  r2_url          TEXT,
  sha256          TEXT,
  width           INTEGER,    -- images/video
  height          INTEGER,
  duration_secs   NUMERIC(10,3),  -- audio/video
  sample_rate     INTEGER,        -- audio
  frame_rate      NUMERIC(6,3),   -- video
  codec           TEXT,
  exif_data       JSONB       DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_meta_scan_id ON file_metadata(scan_id);
CREATE INDEX IF NOT EXISTS idx_file_meta_sha256  ON file_metadata(sha256) WHERE sha256 IS NOT NULL;

-- ── 4. Batch jobs table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_jobs (
  id              TEXT        PRIMARY KEY,
  user_id         TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK(status IN ('queued','processing','completed','failed','cancelled')),
  total_items     INTEGER     NOT NULL DEFAULT 0,
  completed_items INTEGER     NOT NULL DEFAULT 0,
  failed_items    INTEGER     NOT NULL DEFAULT 0,
  scan_type       TEXT        NOT NULL,
  options         JSONB       DEFAULT '{}',
  result_summary  JSONB       DEFAULT '{}',
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_user_id   ON batch_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_status    ON batch_jobs(status);

-- ── 5. Scraper sessions table (migrated from Supabase) ─────────────────────
CREATE TABLE IF NOT EXISTS scraper_sessions (
  id              TEXT        PRIMARY KEY,
  source_url      TEXT        NOT NULL,
  scan_id         TEXT        REFERENCES scans(id),
  status          TEXT        NOT NULL DEFAULT 'running'
                              CHECK(status IN ('running','completed','failed','timeout')),
  pages_crawled   INTEGER     DEFAULT 0,
  depth           INTEGER     DEFAULT 1,
  sub_pages       JSONB       DEFAULT '[]',
  aggregate_score NUMERIC(5,4),
  metadata        JSONB       DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scraper_sessions_scan_id ON scraper_sessions(scan_id);
CREATE INDEX IF NOT EXISTS idx_scraper_sessions_status  ON scraper_sessions(status);

-- ── 6. Updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE TRIGGER trg_scans_updated_at
  BEFORE UPDATE ON scans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_batch_updated_at
  BEFORE UPDATE ON batch_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
