/**
 * Aiscern — Per-Model Prediction Logger
 *
 * Writes one row to model_predictions for every sub-model that ran during
 * a detection call.  Always fire-and-forget — callers must NEVER await this.
 *
 * Usage:
 *   void logModelPredictions(scanId, 'text', result.model_breakdown, result.verdict)
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors model_predictions DB columns)
// ─────────────────────────────────────────────────────────────────────────────

export type Modality = 'text' | 'image' | 'audio' | 'video'
export type ModelVerdict = 'AI' | 'HUMAN' | 'UNCERTAIN'

export interface ModelPrediction {
  /** Human-readable model identifier, e.g. 'gemini-2.0-flash', 'saghi776/aiscern-text-detector' */
  model_id:   string
  /** Raw 0–1 AI probability this model returned */
  raw_score:  number
  /** Per-model verdict derived from raw_score */
  verdict:    ModelVerdict
  /** Wall-clock time this model took, in milliseconds */
  latency_ms: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived-verdict helper — same thresholds as toVerdict() in hf-analyze.ts
// ─────────────────────────────────────────────────────────────────────────────

export function scoreToVerdict(score: number): ModelVerdict {
  if (score >= 0.62) return 'AI'
  if (score <= 0.38) return 'HUMAN'
  return 'UNCERTAIN'
}

// ─────────────────────────────────────────────────────────────────────────────
// Main logger
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget — call with `void`, never `await`.
 *
 * @param scanId          UUID of the row just inserted into `scans`
 * @param modality        Detection modality
 * @param predictions     Per-model breakdown produced by analyzeX()
 * @param ensembleVerdict Final verdict returned to the user
 */
export async function logModelPredictions(
  scanId:          string,
  modality:        Modality,
  predictions:     ModelPrediction[],
  ensembleVerdict: ModelVerdict,
): Promise<void> {
  if (!scanId || !predictions.length) return

  try {
    const rows = predictions.map(p => ({
      scan_id:              scanId,
      model_id:             p.model_id,
      modality,
      raw_score:            Math.round(p.raw_score * 10_000) / 10_000,
      verdict:              p.verdict,
      latency_ms:           p.latency_ms,
      agreed_with_ensemble: p.verdict === ensembleVerdict,
    }))

    const { error } = await getSupabaseAdmin()
      .from('model_predictions')
      .insert(rows)

    if (error) {
      // Non-fatal — log to console only; never throw
      console.warn('[accuracy] logModelPredictions failed:', error.message)
    }
  } catch (err) {
    console.warn('[accuracy] logModelPredictions threw:', err)
  }
}
