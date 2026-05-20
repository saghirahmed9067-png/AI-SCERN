/**
 * Aiscern Pipeline v6 — Shared Types
 * Central type definitions for all pipeline modules.
 */

export interface Env {
  DB:               D1Database
  HF_TOKEN:         string
  HF_REPO?:         string   // text dataset (default: saghi776/detectai-dataset)
  HF_IMAGE_REPO?:   string   // image dataset (default: saghi776/aiscern-image-dataset)
  HF_AUDIO_REPO?:   string   // audio dataset (default: saghi776/aiscern-audio-dataset)
  HF_VIDEO_REPO?:   string   // video dataset (default: saghi776/aiscern-video-dataset)
  WORKER_NUM?:      string   // "1"–"15" scraper | "20" push+cleanup
  PIPELINE_ENABLED?: string  // "false" to kill all workers
  PIPELINE_SECRET:  string   // Shared secret (Bearer token) for /trigger/* endpoint auth
  ALLOWED_ORIGINS?: string   // Comma-separated CORS origin allowlist (default: https://aiscern.com)
}

export type MediaType = 'text' | 'image' | 'audio' | 'video'
export type Label     = 'ai'   | 'human' | 'mixed'

export interface Source {
  name:         string
  id:           string
  config?:      string
  split?:       string
  media_type:   MediaType
  label:        Label
  text_fields?: string[]
  label_field?: string
  label_map?:   Record<string, 'ai' | 'human'>
  url_field?:   string
  audio_field?: string
  image_field?: string
  meta_fields?: string[]
  language?:    string    // override auto-detect; default 'en'
}

export interface Extracted {
  label:             'ai' | 'human'
  content_text?:     string
  content_url?:      string
  content_preview?:  string
  content_hash:      string
  quality_score:     number
  word_count?:       number
  char_count?:       number
  sentence_count?:   number
  language?:         string
  duration_seconds?: number
  sample_rate?:      number
  has_speech?:       boolean
  resolution_w?:     number
  resolution_h?:     number
  file_format?:      string
  has_face?:         boolean
  metadata?:         Record<string, any>
}

export interface ScrapeResult {
  source:   string
  inserted: number
  skipped:  number
  error?:   string
}

export interface PushResult {
  pushed:    number
  commitId?: string
  error?:    string
  files?:    string[]
  skipped?:  string   // reason push was skipped (e.g. 'push_locked')
}

export interface ShardMeta {
  shard_id:           string
  media_type:         MediaType
  language:           string
  sample_count:       number
  size_bytes:         number
  sha256_hash:        string
  created_at:         string
  schema_version:     string
  source_distribution: Record<string, number>
  hf_path:            string
}

export interface StructuredLog {
  event:         'SCRAPE_COMPLETE' | 'LABEL_COMPLETE' | 'SHARD_PUSH' | 'ERROR' | 'RATE_LIMIT_HIT' | 'WORKER_TIMEOUT' | 'KILL_SWITCH' | 'SKIP'
  worker_id:     string
  source_id?:    string
  sample_count?: number
  duration_ms?:  number
  error_message?: string
  reason?:       string
  timestamp:     string
  extra?:        Record<string, any>
}

export function log(entry: StructuredLog): void {
  console.log(JSON.stringify(entry))
}
