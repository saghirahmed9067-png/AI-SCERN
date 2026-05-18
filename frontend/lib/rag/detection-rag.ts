/**
 * Aiscern — Detection RAG
 *
 * Retrieval-Augmented Generation for the detection pipeline.
 * Completely separate from lib/rag/graph-rag.ts (that one is for the ARIA chat).
 *
 * Flow:
 *   Inference time: embed content → query pgvector → blend neighbour label
 *                   distribution into the ensemble score
 *   After feedback:  index confirmed scans into detection_embeddings so future
 *                   similar content gets the benefit of ground-truth data
 *
 * RAG is gated by DETECTION_RAG_ENABLED=true env var so you can A/B test.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const RAG_ENABLED      = process.env.DETECTION_RAG_ENABLED === 'true'
const TOP_K            = 10    // neighbours to retrieve
const MIN_SIMILARITY   = 0.72  // cosine threshold — below this, neighbours are noise
const MIN_NEIGHBOURS   = 5     // need at least this many to trust retrieval
const RAG_WEIGHT       = 0.20  // 20% RAG, 80% ensemble — conservative until data matures
const EMBEDDING_MODEL  = 'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2'
const HF_TOKEN         = process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Modality = 'text' | 'image' | 'audio' | 'video'

export interface RAGResult {
  /** Final blended score to use instead of pure ensembleScore */
  blended_score:        number
  /** Whether RAG contributed to this result */
  rag_applied:          boolean
  /** 0–1 average cosine similarity of retrieved neighbours */
  retrieval_confidence: number
  /** How many neighbours passed the similarity threshold */
  neighbour_count:      number
  /** Fraction of neighbours labelled AI (0–1) */
  ai_ratio:             number
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a 384-dim MiniLM embedding for a text string.
 * For image/audio/video we use a brief textual description rather than raw bytes
 * (the HF API returns 384-dim float array — matches the vector(384) column).
 */
async function embedText(text: string): Promise<number[] | null> {
  if (!HF_TOKEN) return null
  try {
    const res = await fetch(EMBEDDING_MODEL, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body:   JSON.stringify({ inputs: text.slice(0, 512) }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const data = await res.json()
    // HF returns [[...]] for batch, [...] for single
    const embedding = Array.isArray(data[0]) ? data[0] : data
    if (!Array.isArray(embedding) || embedding.length !== 384) return null
    return embedding as number[]
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inference-time retrieval
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query the detection_embeddings table for similar confirmed scans.
 * Returns a blended score that mixes ensemble + retrieval.
 *
 * Always returns a valid RAGResult — never throws.
 *
 * @param content        Text to embed. For image/audio pass a descriptive string.
 * @param modality       Filters retrieval to same modality
 * @param ensembleScore  Raw 0–1 score from the detection ensemble
 */
export async function queryDetectionRAG(
  content:       string,
  modality:      Modality,
  ensembleScore: number,
): Promise<RAGResult> {
  const noOp: RAGResult = {
    blended_score:        ensembleScore,
    rag_applied:          false,
    retrieval_confidence: 0,
    neighbour_count:      0,
    ai_ratio:             0.5,
  }

  if (!RAG_ENABLED) return noOp

  // 1. Embed the content
  const embedding = await embedText(content)
  if (!embedding) return noOp

  // 2. Query pgvector via RPC
  let neighbours: { scan_id: string; ground_truth: string; similarity: number }[]
  try {
    const { data, error } = await getSupabaseAdmin().rpc('match_detection_embeddings', {
      query_embedding: embedding,
      match_modality:  modality,
      match_count:     TOP_K,
      min_similarity:  MIN_SIMILARITY,
    })
    if (error || !data?.length) return noOp
    neighbours = data
  } catch {
    return noOp
  }

  if (neighbours.length < MIN_NEIGHBOURS) return noOp

  // 3. Compute retrieval statistics
  const aiCount  = neighbours.filter(n => n.ground_truth === 'AI').length
  const aiRatio  = aiCount / neighbours.length
  const avgSim   = neighbours.reduce((s, n) => s + n.similarity, 0) / neighbours.length

  // 4. Blend: (1 - RAG_WEIGHT) × ensemble + RAG_WEIGHT × aiRatio
  //    RAG contribution is weighted by similarity confidence
  const ragScore     = aiRatio
  const simWeight    = Math.min(1, avgSim)                           // 0–1 trust factor
  const effectiveW   = RAG_WEIGHT * simWeight
  const blendedScore = (1 - effectiveW) * ensembleScore + effectiveW * ragScore

  return {
    blended_score:        Math.max(0, Math.min(1, blendedScore)),
    rag_applied:          true,
    retrieval_confidence: Math.round(avgSim * 1000) / 1000,
    neighbour_count:      neighbours.length,
    ai_ratio:             Math.round(aiRatio * 1000) / 1000,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback-time indexing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called by /api/detect/feedback after a ground-truth label is confirmed.
 * Embeds the content and upserts into detection_embeddings.
 *
 * Fire-and-forget — callers should `void` this, never `await`.
 */
export async function indexConfirmedScan(
  scanId:      string,
  content:     string,
  groundTruth: 'AI' | 'HUMAN',
  modality:    Modality,
): Promise<void> {
  if (!RAG_ENABLED) return

  try {
    const embedding = await embedText(content)
    if (!embedding) return

    const { error } = await getSupabaseAdmin()
      .from('detection_embeddings')
      .upsert({
        scan_id:      scanId,
        embedding:    JSON.stringify(embedding),   // Supabase accepts JSON array for vector columns
        ground_truth: groundTruth,
        modality,
        indexed_at:   new Date().toISOString(),
      }, { onConflict: 'scan_id' })

    if (error) console.warn('[detection-rag] index failed:', error.message)
  } catch (err) {
    console.warn('[detection-rag] indexConfirmedScan threw:', err)
  }
}
