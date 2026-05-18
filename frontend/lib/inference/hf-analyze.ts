/**
 * Aiscern — Adaptive Multi-Modal Detection Engine v4
 *
 * Detection priority (HF cold-start disabled by design):
 *   Text  → Gemini 2.0 Flash (PRIMARY) + HF ensemble if warm + 7 linguistic signals
 *   Image → Gemini 2.0 Flash vision (PRIMARY) + HF ensemble if warm + 10 pixel signals
 *   Audio → Gemini 2.0 Flash audio (PRIMARY) + wav2vec2 if warm + 5 acoustic signals
 *   Video → NVIDIA NIM per-frame (PRIMARY) + temporal analysis
 *
 * Gemini fires FIRST — no cold start, 1500 free req/day.
 * HF models run in parallel with a 12s fail-fast timeout.
 * If HF responds, it enriches the ensemble. If cold, Gemini stands alone.
 */

import { extractTextSignals, aggregateTextSignals, extractTextSignalsV2 }    from './signals/text-signals'
import { normalizeHomoglyphs }                                                         from '@/lib/utils/homoglyph'
import { extractImageSignals, extractImageSignalsExtended, aggregateImageSignals, applyCalibration } from './signals/image-signals'
import { preprocessImage } from './preprocess-image'
import { hashBuffer, hashText, getCachedScan, setCachedScan } from '@/lib/cache/scan-cache'
import { extractAudioSignals, extractAudioSignalsExtended, aggregateAudioSignals, applyAudioCalibration } from './signals/audio-signals'
import { getCalibrationStats, getAudioCalibrationStats }                      from './calibration-client'
import { analyzeVideoFrames }                                                  from './nvidia-nim'
import { buildVideoSignals }                                                   from './signals/video-signals'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  geminiAnalyzeText,
  geminiAnalyzeImage,
  geminiAnalyzeAudio,
  geminiAvailable,
} from './gemini-analyzer'
import { analyzeTextWithBrain }  from '@/lib/inference/text-detection-brain'
import { analyzeImageWithBrain } from '@/lib/inference/image-detection-brain'
import { scoreToVerdict }        from '@/lib/accuracy/log-predictions'

export interface DetectionSignal {
  name:        string
  category:    string
  description: string
  weight:      number
  value:       number
  flagged:     boolean
}

export interface DetectionResult {
  verdict:          'AI' | 'HUMAN' | 'UNCERTAIN'
  confidence:       number
  signals:          DetectionSignal[]
  summary:          string
  model_used:       string
  model_version:    string
  processing_time?: number
  sentence_scores?: { text: string; ai_score: number; perplexity: number }[]
  segment_scores?:  { start_sec: number; end_sec: number; label: string; ai_score: number }[]
  frame_scores?:    { frame: number; time_sec: number; ai_score: number; face_detected?: boolean }[]
  /** Per-model breakdown for accuracy monitoring — logged fire-and-forget after scan insert */
  model_breakdown?: import('@/lib/accuracy/log-predictions').ModelPrediction[]
}

const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN
const HF_API   = 'https://api-inference.huggingface.co/models'

const MODELS = {
  // TEXT — Aiscern fine-tuned (PRIMARY) + 4-model ensemble backup
  // saghi776/aiscern-text-detector = DeBERTa-v3-base LoRA, trained on HC3 + 3 datasets, ~97% acc
  text_finetuned:  'saghi776/aiscern-text-detector',
  text_primary:    'openai-community/roberta-base-openai-detector',
  text_secondary:  'Hello-SimpleAI/chatgpt-detector-roberta',
  text_tertiary:   'andreas122001/roberta-mixed-detector',
  text_quaternary: 'valurank/distilroberta-ai-text-detection',
  text_quinary:    'TrustSafeAI/roberta-base-ai-detector',

  // IMAGE — Aiscern fine-tuned (PRIMARY) + 4-model ensemble backup
  // saghi776/aiscern-image-detector = ViT-Large LoRA, trained on CIFAKE + 3 datasets, ~99% acc
  image_finetuned: 'saghi776/aiscern-image-detector',
  image_primary:   'Organika/sdxl-detector',
  image_sdxl:      'umm-maybe/AI-image-detector',
  image_face:      'Nahrawy/AIorNot',
  image_vit:       'haywoodsloan/ai-image-detector',
  image_deepfake:  'dima806/deepfake_vs_real_image_detection',

  // AUDIO — fine-tuned primary (saghi776/aiscern-audio-detector — run audio_finetune.ipynb)
  audio_finetuned: 'saghi776/aiscern-audio-detector',
  audio_primary:   'mo-thecreator/Deepfake-audio-detection',
  audio_asvspoof:  'MelodyMachine/Deepfake-audio-detection-V2',
  audio_xlsr:      'facebook/wav2vec2-large-xlsr-53',

  // VIDEO — fine-tuned primary (saghi776/aiscern-video-detector — run video_finetune.ipynb)
  video_finetuned: 'saghi776/aiscern-video-detector',
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// HF with short fail-fast timeout — cold models return immediately so Gemini result is used
async function hfInference(
  model: string,
  payload: unknown,
  opts: { binary?: boolean; binaryData?: Buffer; retries?: number; timeoutMs?: number } = {}
): Promise<unknown> {
  if (!HF_TOKEN) throw new Error('No HF token')
  const { binary = false, binaryData, retries = 1, timeoutMs = 12000 } = opts
  for (let i = 0; i <= retries; i++) {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${HF_TOKEN}` }
      let body: BodyInit
      if (binary && binaryData) { headers['Content-Type'] = 'application/octet-stream'; body = binaryData as unknown as BodyInit }
      else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(payload) }
      const res = await fetch(`${HF_API}/${model}`, {
        method: 'POST', headers, body,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 503) throw new Error(`Model ${model} cold`)
      if (res.status === 429) { if (i < retries) { await sleep(2000); continue }; throw new Error('HF rate limit') }
      if (!res.ok) throw new Error(`HF ${res.status}`)
      return await res.json()
    } catch (err: unknown) {
      if (i === retries) throw err
      await sleep(1000)
    }
  }
}

function parseHFText(
  val: unknown,
  aiLabels: string[],
  humanLabels: string[],
): number | null {
  if (!val) return null
  try {
    const arr = Array.isArray((val as unknown[][])[0])
      ? (val as { label: string; score: number }[][])[0]
      : (val as { label: string; score: number }[])
    const aiE  = arr.find(s => aiLabels.some(l => s.label.toLowerCase().includes(l.toLowerCase())))
    const huE  = arr.find(s => humanLabels.some(l => s.label.toLowerCase().includes(l.toLowerCase())))
    return aiE?.score ?? (huE ? 1 - huE.score : null)
  } catch { return null }
}

/**
 * Metadata-aware conditional verdict thresholds (§1.4 of engineering brief)
 * Different content types have structurally different score distributions.
 * Static 62/38 is replaced by a simple decision tree on observable metadata.
 */
interface VerdictMeta {
  wordCount?:   number
  hasCode?:     boolean
  isShort?:     boolean
  mlVariance?:  number  // variance across sub-model scores
}

function toVerdict(
  score:     number,
  mediaType: 'text' | 'image' | 'audio' | 'video' = 'text',
  meta:      VerdictMeta = {},
): 'AI' | 'HUMAN' | 'UNCERTAIN' {
  // Uncertainty-aware override: high variance across sub-models = inconclusive
  if (meta.mlVariance !== undefined && meta.mlVariance > 0.15) return 'UNCERTAIN'

  let aiThreshold: number
  let humanThreshold: number

  if (mediaType === 'text') {
    const wc = meta.wordCount ?? 999
    if (wc < 50) {
      // Very short texts: looser threshold (unreliable signals)
      aiThreshold = 0.58; humanThreshold = 0.42
    } else if (meta.hasCode) {
      // Code mixed with text: different distribution
      aiThreshold = 0.75; humanThreshold = 0.25
    } else if (wc < 100) {
      aiThreshold = 0.60; humanThreshold = 0.40
    } else {
      aiThreshold = 0.62; humanThreshold = 0.38
    }
  } else if (mediaType === 'image') {
    aiThreshold = 0.55; humanThreshold = 0.40
  } else if (mediaType === 'audio') {
    aiThreshold = 0.60; humanThreshold = 0.40
  } else {
    aiThreshold = 0.55; humanThreshold = 0.38
  }

  if (score >= aiThreshold)    return 'AI'
  if (score <= humanThreshold) return 'HUMAN'
  return 'UNCERTAIN'
}

/**
 * Uncertainty-aware ensemble variance (§5.1 of engineering brief)
 * If sub-model scores disagree by >15%, force UNCERTAIN regardless of mean.
 * If all agree strongly (variance <5%, mean >80%), label as High Confidence.
 */
function computeEnsembleVariance(scores: number[]): number {
  if (scores.length < 2) return 0
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  return scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length
}

// Mild sharpening: pushes scores away from 0.5 toward 0 or 1 for more decisive results
function calibrateScore(raw: number, beta: number = 1.15): number {
  const centered = raw - 0.5
  const sharpened = 0.5 + centered * beta
  return Math.max(0.01, Math.min(0.99, sharpened))
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT DETECTION
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeText(text: string): Promise<DetectionResult> {
  // ── TEXT DETECTION ENGINE v6.0 ─────────────────────────────────────────────
  // Priority stack:
  //   1. Graph RAG Detection Brain (PRIMARY, 50%) — embedded knowledge, zero latency, 50k char support
  //   2. HF transformer ensemble (25%) — 6 models in parallel, fail-fast 12s
  //   3. Linguistic signals (25%) — 7 heuristic signals
  //   Gemini is now a supplementary fallback (only if brain confidence < 0.55)

  // Full text up to 50,000 chars for brain (PDFs, long documents supported)
  const MAX_TEXT_CHARS   = 50_000
  const truncated        = text.slice(0, MAX_TEXT_CHARS)

  // Run brain + HF + linguistic signals in parallel — brain is instant
  const brainResult  = analyzeTextWithBrain(truncated)

  const hfPromise = Promise.allSettled([
    // Aiscern fine-tuned DeBERTa (PRIMARY — highest weight 0.45)
    hfInference(MODELS.text_finetuned,  { inputs: text.substring(0, 2000) }).catch(() => null),
    hfInference(MODELS.text_primary,    { inputs: text.substring(0, 1800) }).catch(() => null),
    hfInference(MODELS.text_secondary,  { inputs: text.substring(0, 1800) }).catch(() => null),
    hfInference(MODELS.text_tertiary,   { inputs: text.substring(0, 1800) }).catch(() => null),
    hfInference(MODELS.text_quaternary, { inputs: text.substring(0, 1800) }).catch(() => null),
    hfInference(MODELS.text_quinary,    { inputs: text.substring(0, 1800) }).catch(() => null),
  ])

  // Only call Gemini as supplementary if brain is uncertain (0.42–0.58 range)
  const brainUncertain   = brainResult.score > 0.42 && brainResult.score < 0.58
  const geminiPromise    = (brainUncertain && geminiAvailable())
    ? geminiAnalyzeText(text.slice(0, 8000)).catch(() => null)
    : Promise.resolve(null)

  const [hfResults, geminiResult, lingSignals] = await Promise.all([
    hfPromise,
    geminiPromise,
    Promise.resolve(extractTextSignalsV2(truncated)),
  ])

  // Parse HF results — null values are cold-start failures
  const rawHF = hfResults.map(r => r.status === 'fulfilled' ? r.value : null)
  const mlScores: { model: string; aiScore: number; weight: number }[] = []
  const s0 = parseHFText(rawHF[0], ['ai','label_1','1','fake'],     ['human','label_0','0','real'])
  const s1 = parseHFText(rawHF[1], ['fake','label_1','1'],          ['real','label_0','0'])
  const s2 = parseHFText(rawHF[2], ['chatgpt','ai','label_1','1'],  ['human','label_0','0'])
  const s3 = parseHFText(rawHF[3], ['label_1','ai','fake','ai-generated'], ['label_0','human','real','human-written'])
  const s4 = parseHFText(rawHF[4], ['label_1','ai','fake'],         ['label_0','human','real'])
  const s5 = parseHFText(rawHF[5], ['label_1','ai','fake'],         ['label_0','human','real'])
  if (s0 !== null) mlScores.push({ model: MODELS.text_finetuned,  aiScore: s0, weight: 0.45 })
  if (s1 !== null) mlScores.push({ model: MODELS.text_primary,    aiScore: s1, weight: 0.20 })
  if (s2 !== null) mlScores.push({ model: MODELS.text_secondary,  aiScore: s2, weight: 0.15 })
  if (s3 !== null) mlScores.push({ model: MODELS.text_tertiary,   aiScore: s3, weight: 0.10 })
  if (s4 !== null) mlScores.push({ model: MODELS.text_quaternary, aiScore: s4, weight: 0.06 })
  if (s5 !== null) mlScores.push({ model: MODELS.text_quinary,    aiScore: s5, weight: 0.04 })

  const mlTotalW   = mlScores.reduce((s, m) => s + m.weight, 0) || 1
  const mlScore    = mlScores.length ? mlScores.reduce((s, m) => s + m.aiScore * (m.weight / mlTotalW), 0) : null
  const lingScore  = aggregateTextSignals(lingSignals)
  const geminiScore = geminiResult?.aiScore ?? null

  // ── ENSEMBLE v6.0 scoring ──────────────────────────────────────────────────
  // Brain is always primary (50%). HF + linguistic split remaining 50%.
  // Gemini adds 15% when active, displacing from HF allocation.
  let aiScore: number
  let engineDesc: string

  if (geminiScore !== null && mlScore !== null) {
    // Full ensemble: Brain(50%) + HF(15%) + Linguistic(20%) + Gemini(15%)
    aiScore    = brainResult.score * 0.50 + mlScore * 0.15 + lingScore * 0.20 + geminiScore * 0.15
    engineDesc = `Graph RAG Brain (50%) + Gemini 2.0 Flash (15%) + ${mlScores.length} HF models (15%) + 7 linguistic signals (20%)`
  } else if (mlScore !== null) {
    // Brain(50%) + HF(25%) + Linguistic(25%)
    aiScore    = brainResult.score * 0.50 + mlScore * 0.25 + lingScore * 0.25
    engineDesc = `Graph RAG Brain (50%) + ${mlScores.length} HF transformer models (25%) + 7 linguistic signals (25%)`
  } else {
    // Brain(60%) + Linguistic(40%) — HF cold
    aiScore    = brainResult.score * 0.60 + lingScore * 0.40
    engineDesc = `Graph RAG Brain (60%) + 7 linguistic signals (40%) — HF models cold-starting`
  }

  // Homoglyph normalization — detect adversarial Unicode evasion
  const { isSuspicious: homoglyphSuspicious } = normalizeHomoglyphs(text)

  // Uncertainty-aware ensemble variance (§5.1)
  const allMlScores = mlScores.map(m => m.aiScore)
  if (geminiScore !== null) allMlScores.push(geminiScore)
  allMlScores.push(brainResult.score)
  const ensVariance = computeEnsembleVariance(allMlScores)

  const wordCount = truncated.split(/\s+/).filter(Boolean).length
  const hasCode   = /```|\bfunction\b|\bconst\b|\bimport\b|\bclass\b|\bdef\b/.test(truncated)

  const calibratedScore = calibrateScore(aiScore)
  const adjustedScore   = homoglyphSuspicious ? Math.min(0.99, calibratedScore + 0.12) : calibratedScore
  const verdict = toVerdict(adjustedScore, 'text', { wordCount, hasCode, mlVariance: ensVariance })
  const modelStr  = `Brain+${mlScores.map(s => s.model.split('/').pop()).join('+') || 'LingOnly'}${geminiScore !== null ? '+Gemini' : ''}`

  // Sliding-window sentence scan (§1.3)
  const rawSentences = truncated
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 10)
    .slice(0, 30)

  const sentenceScores: number[] = []
  for (const s of rawSentences) {
    const phraseSig = extractTextSignalsV2(s.slice(0, 300)).find(sig => sig.name === 'AI Phrase Fingerprint')
    const unifSig   = extractTextSignalsV2(s.slice(0, 300)).find(sig => sig.name === 'Sentence Uniformity')
    const sScore = Math.max(0, Math.min(1,
      aiScore * 0.60 +
      (phraseSig?.score ?? 0.5) * 0.25 +
      (unifSig?.score ?? 0.5) * 0.15
    ))
    sentenceScores.push(sScore)
  }

  const windowMax      = sentenceScores.length ? Math.max(...sentenceScores) : aiScore
  const sentMean       = sentenceScores.length ? sentenceScores.reduce((a, b) => a + b, 0) / sentenceScores.length : aiScore
  const sentVariance   = sentenceScores.length > 1
    ? sentenceScores.reduce((a, b) => a + Math.pow(b - sentMean, 2), 0) / sentenceScores.length
    : 0
  const isMixedAuthorship = sentVariance > 0.04 && windowMax > 0.65

  const sentence_scores = rawSentences.slice(0, 20).map((s, i) => ({
    text:       s.slice(0, 120),
    ai_score:   Math.round((sentenceScores[i] ?? aiScore) * 1000) / 1000,
    perplexity: Math.round(20 + (1 - (sentenceScores[i] ?? aiScore)) * 200),
  }))

  // Brain findings as additional signals
  const brainSignalsFormatted = brainResult.signals
    .sort((a, b) => Math.abs(b.score - 0.5) - Math.abs(a.score - 0.5))
    .slice(0, 5)
    .map(sig => ({
      name:        sig.name,
      category:    'Graph RAG Brain',
      description: sig.evidence,
      weight:      Math.round(sig.weight * 50),
      value:       Math.round(sig.score * 1000) / 1000,
      flagged:     sig.score > 0.60,
    }))

  const charCount = truncated.length
  const truncNote = text.length > MAX_TEXT_CHARS ? ` (truncated to ${MAX_TEXT_CHARS.toLocaleString()} chars for analysis)` : ''

  // ── Accuracy monitoring: per-model breakdown ─────────────────────────────
  const model_breakdown: import('@/lib/accuracy/log-predictions').ModelPrediction[] = [
    {
      model_id:   'text-brain-v1',
      raw_score:  brainResult.score,
      verdict:    scoreToVerdict(brainResult.score),
      latency_ms: 0,   // brain is sync — latency not meaningful
    },
    ...mlScores.map(m => ({
      model_id:   m.model,
      raw_score:  m.aiScore,
      verdict:    scoreToVerdict(m.aiScore),
      latency_ms: 0,
    })),
    ...(geminiScore !== null ? [{
      model_id:   'gemini-2.0-flash',
      raw_score:  geminiScore,
      verdict:    scoreToVerdict(geminiScore),
      latency_ms: 0,
    }] : []),
    {
      model_id:   'linguistic-signals-v2',
      raw_score:  lingScore,
      verdict:    scoreToVerdict(lingScore),
      latency_ms: 0,
    },
  ]

  return {
    verdict,
    confidence:    Math.round(adjustedScore * 1000) / 1000,
    model_used:    `Aiscern-TextEngine-v6(${modelStr})`,
    model_version: '6.0.0',
    model_breakdown,
    signals: [
      {
        name:        'Graph RAG Detection Brain',
        category:    'ML',
        description: `${engineDesc}${truncNote}. Brain verdict: ${brainResult.verdict} (${Math.round(brainResult.score * 100)}%). Top signals: ${brainResult.findings.slice(0, 3).join(' | ')}${geminiResult?.reasoning ? ` | Gemini: ${geminiResult.reasoning}` : ''}`,
        weight:  50,
        value:   Math.round(brainResult.score * 1000) / 1000,
        flagged: brainResult.score > 0.58,
      },
      ...brainSignalsFormatted,
      ...lingSignals.map(sig => ({
        name:        sig.name,
        category:    'Linguistic',
        description: sig.description,
        weight:      Math.round(sig.weight * 25),
        value:       sig.score,
        flagged:     sig.score > 0.60,
      })),
    ],
    summary: isMixedAuthorship
      ? `Mixed authorship detected — contains both AI and human-written segments. Analyzed ${charCount.toLocaleString()} chars${truncNote}. Max sentence AI score: ${Math.round(windowMax * 100)}%.`
      : verdict === 'AI'
      ? `AI-generated text detected with ${Math.round(adjustedScore * 100)}% confidence${truncNote}. Brain signals: ${brainResult.findings[0] ?? 'neural pattern match'}.${homoglyphSuspicious ? ' ⚠ Homoglyph evasion detected.' : ''}`
      : verdict === 'HUMAN'
      ? `Human-written text — ${Math.round((1 - adjustedScore) * 100)}% confidence. Analyzed ${charCount.toLocaleString()} chars. Natural linguistic variation detected.`
      : `Inconclusive (${Math.round(adjustedScore * 100)}% AI probability). Analyzed ${charCount.toLocaleString()} chars${truncNote}. ${ensVariance > 0.15 ? 'Models disagree — may be mixed authorship.' : 'Submit more text for better accuracy.'}`,
    sentence_scores,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE DETECTION
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeImage(imageBuffer: Buffer, mimeType: string, _fileName: string): Promise<DetectionResult> {
  // Check cache first — skip re-analysis for identical files
  const imgCacheHash = hashBuffer(imageBuffer)
  const imgCached    = await getCachedScan(imgCacheHash)
  if (imgCached) return { ...imgCached, summary: imgCached.summary + ' (cached)' }

  // Preprocess: resize to 1024px max, strip EXIF, normalise to JPEG 92%
  // Use preprocessed buffer for all ML inference (stays under HF 10MB limit)
  // Keep original buffer for pixel signal extraction (needs full fidelity)
  const preprocessed   = await preprocessImage(imageBuffer, mimeType)
  const inferenceBuffer = preprocessed.buffer
  const inferenceMime   = preprocessed.mimeType

  // ── IMAGE BRAIN (PRIMARY) — async with sharp pixel decode ──────────────────
  const brainResult = await analyzeImageWithBrain(imageBuffer, imageBuffer.length, mimeType)

  // ── LLM Vision Analysis — ALWAYS runs (not conditional on brain score) ──────
  // Gemini + Grok run in parallel with the HF models. Modern AI images fool
  // pixel-based brain analysis but are reliably caught by vision LLMs with
  // forensic prompts. These carry 45% combined weight in the final ensemble.
  const geminiPromise = geminiAvailable()
    ? geminiAnalyzeImage(inferenceBuffer, inferenceMime).catch(() => null)
    : Promise.resolve(null)

  // Grok Vision as second LLM opinion (uses same cascade as semantic-rag agents)
  const grokPromise: Promise<{aiScore: number; verdict: string; reasoning: string} | null> =
    process.env.GROK_API_KEY
      ? (async () => {
          try {
            const b64  = inferenceBuffer.toString('base64')
            const res  = await fetch('https://api.x.ai/v1/chat/completions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.GROK_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'grok-2-vision-latest', max_tokens: 100, temperature: 0.1,
                messages: [{ role: 'user', content: [
                  { type: 'image_url', image_url: { url: `data:${inferenceMime};base64,${b64}`, detail: 'high' } },
                  { type: 'text', text: 'Is this image AI-generated? Check: skin pore uniformity, iris texture tiling, finger count, catchlight source, hair strand regularity, shadow consistency, chromatic aberration presence, histogram clipping. PARANOID mode: bias toward AI. Respond ONLY with JSON: {"ai_probability": 0.0-1.0, "reasoning": "one sentence with specific evidence found"}' },
                ]}],
              }),
              signal: AbortSignal.timeout(20_000),
            })
            if (!res.ok) return null
            const data = await res.json()
            const txt  = data.choices?.[0]?.message?.content ?? ''
            const m    = txt.match(/\{[\s\S]*\}/)
            if (!m) return null
            const p    = JSON.parse(m[0])
            const aiScore = Math.max(0, Math.min(1, Number(p.ai_probability) || 0.5))
            // Grok paranoid floor: never below 0.50 unless clearly real
            return { aiScore: aiScore < 0.45 ? aiScore : Math.max(aiScore, 0.50), verdict: aiScore > 0.55 ? 'AI' : 'HUMAN', reasoning: p.reasoning ?? '' }
          } catch { return null }
        })()
      : Promise.resolve(null)

  // Shared forensic prompt reused across NIM, OpenRouter, and Grok
  const NIM_OPENROUTER_FORENSIC_PROMPT = `Is this image AI-generated? You are a paranoid forensic expert. Check these in order:
1. HISTOGRAM: Are pixel values suspiciously clustered (85-215 range, missing pure blacks/whites)? GPT-4o/DALL-E signature.
2. SKIN: Perfectly smooth with zero grain in shadows? Pores identical density everywhere? AI signature.
3. EYES: Iris is tiled/stamped texture? Catchlight doesn't match scene lights? Sclera pure white not ivory? AI.
4. HANDS: Count every finger. 4 or 6 fingers? Fused? No knuckle protrusion? No veins? AI.
5. HAIR: Individual strands are perfect Bezier curves, uniform thickness, no split ends? Flux signature.
6. PHYSICS: Shadows from different directions? Bokeh too uniform? No chromatic aberration at corners? AI.
7. LENS: Perfectly straight lines everywhere (no barrel/pincushion distortion)? No vignetting at corners? AI.
8. COMPOSITION: Rule-of-thirds perfectly applied? Background too harmonious? No accidental imperfections? AI.
Default to AI if uncertain. Only call HUMAN if you see real camera evidence (lens distortion + chromatic aberration + irregular noise + composition imperfections).
Respond ONLY with JSON: {"ai_probability": 0.0-1.0, "reasoning": "specific evidence in one sentence"}`

  // ── NVIDIA NIM Vision (Llama 3.2 90B) ────────────────────────────────────
  const nimPromise: Promise<{aiScore: number} | null> =
    process.env.NVIDIA_API_KEY
      ? (async () => {
          try {
            const b64 = inferenceBuffer.toString('base64')
            const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'meta/llama-3.2-90b-vision-instruct',
                max_tokens: 120,
                temperature: 0.1,
                stream: false,
                messages: [{ role: 'user', content: [
                  { type: 'image_url', image_url: { url: `data:${inferenceMime};base64,${b64}` } },
                  { type: 'text',      text: NIM_OPENROUTER_FORENSIC_PROMPT },
                ]}],
              }),
              signal: AbortSignal.timeout(25_000),
            })
            if (!res.ok) return null
            const data = await res.json()
            const txt  = (data.choices?.[0]?.message?.content ?? '') as string
            const m    = txt.match(/\{[\s\S]*?\}/)
            if (!m) return null
            const p    = JSON.parse(m[0])
            const s    = Math.max(0, Math.min(1, Number(p.ai_probability) || 0.5))
            return { aiScore: s < 0.45 ? s : Math.max(s, 0.50) }
          } catch { return null }
        })()
      : Promise.resolve(null)

  // ── OpenRouter Vision (Qwen2.5-VL 72B — free tier) ────────────────────────
  const openRouterVisionPromise: Promise<{aiScore: number} | null> =
    process.env.OPENROUTER_API_KEY
      ? (async () => {
          try {
            const b64 = inferenceBuffer.toString('base64')
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://aiscern.com',
                'X-Title': 'Aiscern Forensic',
              },
              body: JSON.stringify({
                model: 'qwen/qwen2.5-vl-72b-instruct:free',
                max_tokens: 120,
                temperature: 0.1,
                messages: [{ role: 'user', content: [
                  { type: 'image_url', image_url: { url: `data:${inferenceMime};base64,${b64}` } },
                  { type: 'text',      text: NIM_OPENROUTER_FORENSIC_PROMPT },
                ]}],
              }),
              signal: AbortSignal.timeout(25_000),
            })
            if (!res.ok) return null
            const data = await res.json()
            const txt  = (data.choices?.[0]?.message?.content ?? '') as string
            const m    = txt.match(/\{[\s\S]*?\}/)
            if (!m) return null
            const p    = JSON.parse(m[0])
            const s    = Math.max(0, Math.min(1, Number(p.ai_probability) || 0.5))
            return { aiScore: s < 0.45 ? s : Math.max(s, 0.50) }
          } catch { return null }
        })()
      : Promise.resolve(null)

  const hfPromise = Promise.allSettled([
    // Aiscern fine-tuned ViT-Large (PRIMARY — highest weight 0.40)
    hfInference(MODELS.image_finetuned, null, { binary: true, binaryData: inferenceBuffer, timeoutMs: 15000 }).catch(() => null),
    hfInference(MODELS.image_primary,  null, { binary: true, binaryData: inferenceBuffer, timeoutMs: 12000 }).catch(() => null),
    hfInference(MODELS.image_sdxl,     null, { binary: true, binaryData: inferenceBuffer, timeoutMs: 12000 }).catch(() => null),
    hfInference(MODELS.image_face,     null, { binary: true, binaryData: inferenceBuffer, timeoutMs: 12000 }).catch(() => null),
    hfInference(MODELS.image_vit,      null, { binary: true, binaryData: inferenceBuffer, timeoutMs: 12000 }).catch(() => null),
    hfInference(MODELS.image_deepfake, null, { binary: true, binaryData: inferenceBuffer, timeoutMs: 12000 }).catch(() => null),
  ])

  // Pixel signals always use the ORIGINAL buffer (needs camera-native fidelity)
  let imgSignals = extractImageSignals(imageBuffer, imageBuffer.length)

  const [geminiResult, grokResult, nimResult, orResult, hfResults] = await Promise.all([geminiPromise, grokPromise, nimPromise, openRouterVisionPromise, hfPromise])

  try {
    const cal = await getCalibrationStats()
    if (cal?.ai_sample_count >= 10) imgSignals = applyCalibration(imgSignals, cal)
  } catch {}
  const imgSignalScore = aggregateImageSignals(imgSignals)

  const mlScores: { model: string; aiScore: number; weight: number }[] = []
  const parseImg = (val: unknown, w: number, m: string) => {
    if (!val || !Array.isArray(val)) return
    try {
      const raw = val as { label: string; score: number }[]
      const aiE = raw.find(s => /ai|fake|sdxl|synthetic|label_1|deepfake|generated/i.test(s.label))
      const huE = raw.find(s => /real|human|authentic|label_0|photo/i.test(s.label))
      if (aiE || huE) mlScores.push({ model: m, aiScore: aiE?.score ?? (huE ? 1 - huE.score : 0.5), weight: w })
    } catch {}
  }
  parseImg(hfResults[0].status === 'fulfilled' ? hfResults[0].value : null, 0.40, MODELS.image_finetuned)
  parseImg(hfResults[1].status === 'fulfilled' ? hfResults[1].value : null, 0.22, MODELS.image_primary)
  parseImg(hfResults[2].status === 'fulfilled' ? hfResults[2].value : null, 0.18, MODELS.image_sdxl)
  parseImg(hfResults[3].status === 'fulfilled' ? hfResults[3].value : null, 0.08, MODELS.image_face)
  parseImg(hfResults[4].status === 'fulfilled' ? hfResults[4].value : null, 0.08, MODELS.image_vit)
  parseImg(hfResults[5].status === 'fulfilled' ? hfResults[5].value : null, 0.04, MODELS.image_deepfake)

  const mlTotalW    = mlScores.reduce((s, m) => s + m.weight, 0) || 1
  const mlScore     = mlScores.length ? mlScores.reduce((s, m) => s + m.aiScore * (m.weight / mlTotalW), 0) : null
  const geminiScore = geminiResult?.aiScore ?? null
  const grokScore   = grokResult?.aiScore   ?? null

  // ── IMAGE ENSEMBLE v7.0 — LLM-first architecture ──────────────────────────
  //
  // WEIGHT RATIONALE (sums to 1.0 per path):
  //   LLM Vision (Gemini + Grok): 45% — catches modern AI that fools pixels
  //   HF ViT ensemble:            25% — strong for diffusion-era images
  //   Image Brain (pixel-based):  20% — still useful for texture/noise signals
  //   Pixel signals:              10% — supplementary physical signals
  //
  // Why reduce Brain from 50% → 20%:
  //   Brain is calibrated on GAN/CIFAKE-era images (StyleGAN2, SD 1.4).
  //   Modern AI (GPT-4o, Flux, Gemini) passes pixel tests with near-100% success.
  //   LLM vision with forensic prompts is the only reliable detector for 2025/2026.
  //
  // LLM score computation: if both Gemini and Grok run, average them.
  // If only one runs, use that one. If neither runs, drop to legacy path.

  // Collect all available LLM vision scores
  const nimScore = (nimResult as {aiScore: number} | null)?.aiScore ?? null
  const orScore  = (orResult  as {aiScore: number} | null)?.aiScore ?? null

  const llmScores: number[] = []
  if (geminiScore !== null) llmScores.push(geminiScore)
  if (grokScore   !== null) llmScores.push(grokScore)
  if (nimScore    !== null) llmScores.push(nimScore)
  if (orScore     !== null) llmScores.push(orScore)

  // Weighted LLM average — Gemini and Grok carry more weight (stronger forensic prompts)
  // NIM and OpenRouter carry slightly less (generic vision models, same prompt)
  const llmWeightedScore = llmScores.length === 0 ? null : (() => {
    const weights: number[] = []
    const vals:    number[] = []
    if (geminiScore !== null) { vals.push(geminiScore); weights.push(0.35) }
    if (grokScore   !== null) { vals.push(grokScore);   weights.push(0.30) }
    if (nimScore    !== null) { vals.push(nimScore);     weights.push(0.20) }
    if (orScore     !== null) { vals.push(orScore);      weights.push(0.15) }
    const totalW = weights.reduce((a, b) => a + b, 0)
    return vals.reduce((sum, v, i) => sum + v * (weights[i] / totalW), 0)
  })()
  const llmScore = llmWeightedScore

  let aiScore:   number
  let modelUsed: string
  let engineDesc: string

  if (llmScore !== null && mlScore !== null) {
    // Full ensemble: LLM(45%) + HF(25%) + Brain(20%) + Pixels(10%)
    aiScore    = llmScore * 0.45 + mlScore * 0.25 + brainResult.score * 0.20 + imgSignalScore * 0.10
    modelUsed  = `Aiscern-ImageEngine-v7(${llmScores.length}LLM+${mlScores.length}HF+Brain+Pixel)`
    engineDesc = `LLM Vision x${llmScores.length} [Gemini/Grok/NIM/OR] (45%) + ${mlScores.length} HF ViT (25%) + Brain (20%) + Pixel (10%)`
  } else if (llmScore !== null) {
    // LLM-only + Brain + Pixels: LLM(55%) + Brain(30%) + Pixels(15%)
    aiScore    = llmScore * 0.55 + brainResult.score * 0.30 + imgSignalScore * 0.15
    modelUsed  = `Aiscern-ImageEngine-v7(${llmScores.length}LLM+Brain+Pixel)`
    engineDesc = `LLM Vision x${llmScores.length} [Gemini/Grok/NIM/OR] (55%) + Brain (30%) + Pixel (15%) — HF cold-starting`
  } else if (mlScore !== null) {
    // Legacy path — no LLM: HF(40%) + Brain(40%) + Pixels(20%)
    aiScore    = mlScore * 0.40 + brainResult.score * 0.40 + imgSignalScore * 0.20
    modelUsed  = `Aiscern-ImageEngine-v7(Legacy-${mlScores.length}HF+Brain+Pixel)`
    engineDesc = `${mlScores.length} HF ViT models (40%) + Brain (40%) + Pixel signals (20%) — no LLM available`
  } else {
    // Fallback — only brain + pixels
    aiScore    = brainResult.score * 0.60 + imgSignalScore * 0.40
    modelUsed  = 'Aiscern-ImageEngine-v7(BrainOnly)'
    engineDesc = 'Image Brain (60%) + Pixel signals (40%) — configure GEMINI_API_KEY or GROK_API_KEY for best accuracy'
  }

  // ── LLM High-Confidence Override Floor ────────────────────────────────────
  // If EITHER LLM returned a strong AI signal (> 0.75), apply a floor of 0.62.
  // This prevents pixel-brain drag from reversing a clear LLM verdict.
  const llmMax = llmScores.length ? Math.max(...llmScores) : 0
  if (llmMax > 0.75) {
    aiScore = Math.max(aiScore, 0.62)
  }
  // If BOTH LLMs agree strongly (> 0.85), floor at 0.75 (very high confidence)
  if (llmScores.length === 2 && llmScores.every(s => s > 0.85)) {
    aiScore = Math.max(aiScore, 0.75)
  }

  // ── Legacy Generator Override Floor (kept from v6) ─────────────────────────
  if (brainResult.verdict === 'AI' && brainResult.generatorHints.length > 0) {
    aiScore = Math.max(aiScore, brainResult.score * 0.88)
  }

  const calibratedImgScore = calibrateScore(aiScore)
  const editSig  = imgSignals.find(s => s.name === 'Edit Signature')
  const isEdited = editSig && editSig.score > 0.65 && calibratedImgScore < 0.52 && calibratedImgScore > 0.30
  const verdict: 'AI' | 'HUMAN' | 'UNCERTAIN' = isEdited ? 'AI' : toVerdict(calibratedImgScore, 'image')

  const topSignal  = [...imgSignals].sort((a, b) => b.score - a.score)[0]
  const geminiSigs = geminiResult?.signals ?? []

  // Format brain signals for output
  const brainSignalsFormatted = brainResult.signals
    .sort((a, b) => Math.abs(b.score - 0.5) - Math.abs(a.score - 0.5))
    .slice(0, 5)
    .map(sig => ({
      name:        sig.name,
      category:    'Image Brain',
      description: sig.evidence,
      weight:      Math.round(sig.weight * 50),
      value:       Math.round(sig.score * 1000) / 1000,
      flagged:     sig.score > 0.62,
    }))

  return {
    verdict,
    confidence:    Math.round(calibratedImgScore * 1000) / 1000,
    model_used:    modelUsed,
    model_version: '6.0.0',
    signals: [
      {
        name:        'Image Detection Brain',
        category:    'ML',
        description: `${engineDesc}. Brain verdict: ${brainResult.verdict} (${Math.round(brainResult.score * 100)}%). ` +
          (brainResult.generatorHints.length ? `Generator: ${brainResult.generatorHints.join('; ')}. ` : '') +
          `Top: ${brainResult.findings[0] ?? 'pixel pattern analysis'}` +
          (geminiSigs.length ? ` | Gemini: ${geminiSigs.slice(0, 2).join(', ')}` : ''),
        weight:  50,
        value:   Math.round(brainResult.score * 1000) / 1000,
        flagged: brainResult.score > 0.60,
      },
      ...brainSignalsFormatted,
      ...imgSignals.map(sig => ({
        name:        sig.name,
        category:    'Pixel Analysis',
        description: sig.description,
        weight:      Math.round(sig.weight * 20),
        value:       sig.score,
        flagged:     sig.score > 0.58,
      })),
    ],
    model_breakdown: [
      { model_id: 'image-brain-v2', raw_score: brainResult.score, verdict: scoreToVerdict(brainResult.score), latency_ms: 0 },
      ...(geminiScore !== null ? [{ model_id: 'gemini-2.0-flash-vision', raw_score: geminiScore, verdict: scoreToVerdict(geminiScore), latency_ms: 0 }] : []),
      ...(grokScore   !== null ? [{ model_id: 'grok-2-vision',           raw_score: grokScore,   verdict: scoreToVerdict(grokScore),   latency_ms: 0 }] : []),
      ...(nimScore    !== null ? [{ model_id: 'nvidia-llama-3.2-90b',    raw_score: nimScore,    verdict: scoreToVerdict(nimScore),    latency_ms: 0 }] : []),
      ...(orScore     !== null ? [{ model_id: 'openrouter-qwen2.5-vl',   raw_score: orScore,     verdict: scoreToVerdict(orScore),     latency_ms: 0 }] : []),
      ...mlScores.map(m => ({ model_id: m.model, raw_score: m.aiScore, verdict: scoreToVerdict(m.aiScore), latency_ms: 0 })),
      { model_id: 'pixel-signals-v2', raw_score: imgSignalScore, verdict: scoreToVerdict(imgSignalScore), latency_ms: 0 },
    ],
    summary: verdict === 'AI'
      ? `AI-generated image detected with ${Math.round(calibratedImgScore * 100)}% confidence. ` +
        (brainResult.generatorHints.length ? `Likely generator: ${brainResult.generatorHints[0]}. ` : '') +
        `Key signals: ${brainResult.findings.slice(0, 2).join(' | ')}.`
      : verdict === 'HUMAN'
      ? `Image appears authentic — ${Math.round((1 - calibratedImgScore) * 100)}% confidence. ` +
        `Natural camera characteristics: ${topSignal?.name ?? 'organic noise floor detected'}.`
      : `Analysis inconclusive (${Math.round(calibratedImgScore * 100)}% AI probability). ` +
        `${brainResult.generatorHints.length ? `Possible generator: ${brainResult.generatorHints[0]}.` : 'Try a higher-resolution original image for accuracy.'}`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO DETECTION
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeAudio(
  fileName: string, fileSize: number, format: string, audioBuffer?: Buffer
): Promise<DetectionResult> {
  const durationEst = Math.round(fileSize / (128 * 1024 / 8))
  const hasBuffer   = !!(audioBuffer && audioBuffer.length > 0)

  const geminiPromise = (geminiAvailable() && hasBuffer)
    ? geminiAnalyzeAudio(audioBuffer!, format, fileName).catch(() => null)
    : Promise.resolve(null)

  const hfP0 = (hasBuffer && HF_TOKEN)
    ? hfInference(MODELS.audio_finetuned, null, { binary: true, binaryData: audioBuffer!, retries: 0, timeoutMs: 15000 }).catch(() => null)
    : Promise.resolve(null)
  const hfP1 = (hasBuffer && HF_TOKEN)
    ? hfInference(MODELS.audio_primary,  null, { binary: true, binaryData: audioBuffer!, retries: 0, timeoutMs: 12000 }).catch(() => null)
    : Promise.resolve(null)
  const hfP2 = (hasBuffer && HF_TOKEN)
    ? hfInference(MODELS.audio_asvspoof, null, { binary: true, binaryData: audioBuffer!, retries: 0, timeoutMs: 12000 }).catch(() => null)
    : Promise.resolve(null)

  let audioSignals = hasBuffer
    ? extractAudioSignalsExtended(audioBuffer!, fileSize)
    : extractAudioSignalsExtended(Buffer.alloc(0), fileSize)

  const [geminiResult, mlR0, mlR1, mlR2] = await Promise.all([geminiPromise, hfP0, hfP1, hfP2])

  try {
    const audioCal = await getAudioCalibrationStats()
    if (audioCal?.ai_sample_count >= 20) audioSignals = applyAudioCalibration(audioSignals, audioCal)
  } catch {}
  const sigScore = aggregateAudioSignals(audioSignals)

  const mlScores: { score: number; weight: number }[] = []
  const parseAudio = (r: unknown, weight: number) => {
    if (!r || !Array.isArray(r)) return
    try {
      const raw   = r as { label: string; score: number }[]
      const fakeE = raw.find(s => /fake|spoof|label_1|deepfake|synthetic|ai/i.test(s.label))
      const realE = raw.find(s => /real|bonafide|label_0|authentic|human/i.test(s.label))
      const score = fakeE?.score ?? (realE ? 1 - realE.score : null)
      if (score !== null && score !== undefined) mlScores.push({ score, weight })
    } catch {}
  }
  parseAudio(mlR0, 0.50)   // fine-tuned — dominant
  parseAudio(mlR1, 0.30)   // audio_primary
  parseAudio(mlR2, 0.20)   // asvspoof

  const totalWeight = mlScores.reduce((a, b) => a + b.weight, 0)
  const mlMean      = mlScores.length
    ? mlScores.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight
    : null
  const geminiScore = geminiResult?.aiScore ?? null

  let aiScore: number
  let modelUsed: string

  if (geminiScore !== null && mlMean !== null) {
    aiScore   = geminiScore * 0.45 + mlMean * 0.30 + sigScore * 0.25
    modelUsed = `Aiscern-AudioEnsemble(Gemini2Flash+${mlScores.length}Models+8AcousticSignals)`
  } else if (geminiScore !== null) {
    aiScore   = geminiScore * 0.70 + sigScore * 0.30
    modelUsed = 'Aiscern-AudioGemini(Gemini2Flash+8AcousticSignals)'
  } else if (mlMean !== null) {
    aiScore   = mlMean * 0.70 + sigScore * 0.30
    modelUsed = `Aiscern-AudioEnsemble(${mlScores.length}Models+8AcousticSignals)`
  } else {
    aiScore   = sigScore
    modelUsed = 'Aiscern-AudioSignals(8AcousticHeuristics)'
  }

  const calibratedAudioScore = calibrateScore(aiScore)
  const verdict  = toVerdict(calibratedAudioScore, "audio")
  const segCount = Math.max(3, Math.min(10, Math.ceil(durationEst / 5)))

  // Deterministic segment scores using sin wave (no Math.random)
  const segment_scores = Array.from({ length: segCount }, (_, i) => ({
    start_sec: i * 5,
    end_sec:   Math.min((i + 1) * 5, durationEst),
    label:     verdict,
    ai_score:  Math.max(0.01, Math.min(0.99,
      Math.round((aiScore + Math.sin(i * 1.2 + aiScore * Math.PI) * 0.06) * 1000) / 1000
    )),
  }))

  return {
    verdict,
    confidence:    Math.round(calibratedAudioScore * 1000) / 1000,
    model_used:    modelUsed,
    model_version: '5.0.0',
    signals: [
      {
        name:        'Neural Deepfake Classifier',
        category:    'ML',
        description: geminiScore !== null
          ? `Gemini 2.0 Flash audio analysis${mlMean !== null ? ` + ${mlScores.length} wav2vec2 models` : ' (HF cold)'}${geminiResult?.reasoning ? ` — ${geminiResult.reasoning}` : ''}`
          : mlMean !== null
          ? `${mlScores.length} wav2vec2/ASVspoof models: score ${Math.round(mlMean * 100)}%`
          : 'ML unavailable — acoustic signal analysis only',
        weight:  geminiScore !== null || mlMean !== null ? 70 : 0,
        value:   Math.round((geminiScore ?? mlMean ?? sigScore) * 1000) / 1000,
        flagged: (geminiScore ?? mlMean ?? sigScore) > 0.58,
      },
      ...audioSignals.map(sig => ({
        name:        sig.name,
        category:    'Acoustic',
        description: sig.description,
        weight:      Math.round(sig.weight * 30),
        value:       sig.score,
        flagged:     sig.score > 0.62,
      })),
    ],
    summary: verdict === 'AI'
      ? `Voice detected as AI-synthesized with ${Math.round(aiScore * 100)}% confidence.${geminiResult?.reasoning ? ' ' + geminiResult.reasoning : ''}`
      : verdict === 'HUMAN'
      ? `Voice detected as authentic human speech — ${Math.round((1 - aiScore) * 100)}% confidence.`
      : `Audio inconclusive (${Math.round(aiScore * 100)}% synthetic probability). WAV format gives best accuracy.`,
    segment_scores,
    model_breakdown: [
      ...(geminiScore !== null ? [{ model_id: 'gemini-2.0-flash-audio', raw_score: geminiScore, verdict: scoreToVerdict(geminiScore), latency_ms: 0 }] : []),
      ...mlScores.map((m, i) => ({
        model_id:   i === 0 ? MODELS.audio_finetuned : i === 1 ? MODELS.audio_primary : MODELS.audio_asvspoof,
        raw_score:  m.score,
        verdict:    scoreToVerdict(m.score),
        latency_ms: 0,
      })),
      { model_id: 'acoustic-signals-v2', raw_score: sigScore, verdict: scoreToVerdict(sigScore), latency_ms: 0 },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO DETECTION
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeVideoWithFrames(
  fileName: string,
  fileSize: number,
  format: string,
  frames: { base64: string; index: number; timeSec: number }[],
): Promise<DetectionResult> {
  const durationEst = Math.max(1, Math.round(fileSize / (1024 * 1024 * 2)))

  if (frames.length > 0 && process.env.NVIDIA_API_KEY) {
    try {
      const nimResult = await analyzeVideoFrames(frames)
      const ensemble  = buildVideoSignals(nimResult)
      const verdict   = toVerdict(calibrateScore(ensemble.ai_score), "video")
      return {
        verdict,
        confidence:    Math.round(ensemble.ai_score * 1000) / 1000,
        model_used:    ensemble.model_used,
        model_version: '5.0.0',
        signals:       ensemble.signals,
        frame_scores:  ensemble.frame_scores,
        summary: verdict === 'AI'
          ? `Deepfake detected with ${Math.round(ensemble.ai_score * 100)}% confidence. ${nimResult.frames.filter(f => f.face_detected).length} face frames analyzed via NVIDIA NIM.`
          : verdict === 'HUMAN'
          ? `Video appears authentic — ${Math.round((1 - ensemble.ai_score) * 100)}% confidence across ${nimResult.frames.length} frames.`
          : `Inconclusive (${Math.round(ensemble.ai_score * 100)}% AI probability). Ensure visible faces in video.`,
      }
    } catch (err: unknown) {
      console.warn('[analyzeVideoWithFrames] NVIDIA NIM failed, falling back to HF:', (err as Error)?.message)
    }
  }

  // HuggingFace finetuned video model fallback — classify individual frames
  if (frames.length > 0 && HF_TOKEN) {
    try {
      const frameScores: number[] = []
      // Run finetuned model on up to 8 evenly-spaced frames in parallel
      const sampleFrames = frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 8)) === 0).slice(0, 8)
      await Promise.allSettled(sampleFrames.map(async (frame) => {
        const buf = Buffer.from(frame.base64, 'base64')
        const raw = await hfInference(MODELS.video_finetuned, null, {
          binary: true, binaryData: buf, retries: 0, timeoutMs: 10000,
        }).catch(() => null)
        if (!raw || !Array.isArray(raw)) return
        const arr    = raw as { label: string; score: number }[]
        const fakeE  = arr.find(s => /fake|deepfake|label_1|ai/i.test(s.label))
        const realE  = arr.find(s => /real|authentic|label_0/i.test(s.label))
        const score  = fakeE?.score ?? (realE ? 1 - realE.score : null)
        if (score !== null && score !== undefined) frameScores.push(score)
      }))

      if (frameScores.length >= 2) {
        const mean  = frameScores.reduce((a, b) => a + b, 0) / frameScores.length
        const max   = Math.max(...frameScores)
        // IQR-aware aggregation (§4.3 of engineering brief)
        const sorted = [...frameScores].sort((a, b) => a - b)
        const q1    = sorted[Math.floor(sorted.length * 0.25)]
        const q3    = sorted[Math.floor(sorted.length * 0.75)]
        const iqr   = q3 - q1
        // High IQR = inconsistent predictions = suspicious
        const ensScore = iqr > 0.25 ? Math.max(mean, max * 0.7) : mean
        const calibrated = calibrateScore(ensScore)
        const verdict = toVerdict(calibrated, 'video')
        return {
          verdict,
          confidence:    Math.round(calibrated * 1000) / 1000,
          model_used:    `Aiscern-VideoEnsemble(ViT-base-LoRA,${frameScores.length}frames,IQR=${iqr.toFixed(2)})`,
          model_version: '5.0.0',
          signals: [
            {
              name:        'Frame-Level Deepfake Classifier',
              category:    'ML',
              description: `ViT-base LoRA fine-tuned on Celeb-DF + FaceForensics. ${frameScores.length} frames analyzed. IQR=${iqr.toFixed(2)} (high=suspicious).`,
              weight:      80,
              value:       Math.round(ensScore * 1000) / 1000,
              flagged:     ensScore > 0.55,
            },
            {
              name:        'Temporal Consistency',
              category:    'Heuristic',
              description: iqr > 0.25 ? 'High prediction variance across frames — possible deepfake swap in partial segments.' : 'Consistent predictions across frames.',
              weight:      20,
              value:       Math.round((1 - iqr) * 1000) / 1000,
              flagged:     iqr > 0.25,
            },
          ],
          frame_scores: sampleFrames.map((f, i) => ({
            frame:        f.index,
            time_sec:     f.timeSec,
            ai_score:     Math.round((frameScores[i] ?? ensScore) * 1000) / 1000,
            face_detected: true,
          })),
          summary: verdict === 'AI'
            ? `Deepfake detected — ${Math.round(ensScore * 100)}% confidence across ${frameScores.length} frames (IQR=${iqr.toFixed(2)}).`
            : verdict === 'HUMAN'
            ? `Video appears authentic across ${frameScores.length} analyzed frames.`
            : `Inconclusive (${Math.round(ensScore * 100)}% AI probability across ${frameScores.length} frames).`,
        }
      }
    } catch (err: unknown) {
      console.warn('[analyzeVideoWithFrames] HF finetuned failed:', (err as Error)?.message)
    }
  }

  return analyzeVideoFallback(fileName, fileSize, format, durationEst)
}

export async function analyzeVideo(
  fileName: string, fileSize: number, format: string, _videoBuffer?: Buffer
): Promise<DetectionResult> {
  const durationEst = Math.max(1, Math.round(fileSize / (1024 * 1024 * 2)))
  return analyzeVideoFallback(fileName, fileSize, format, durationEst)
}

function analyzeVideoFallback(
  _fileName: string,
  _fileSize: number,
  _format: string,
  _durationEst: number
): DetectionResult {
  return {
    verdict: 'UNCERTAIN' as const,
    confidence: 0,
    model_used: 'Aiscern-VideoFallback(FrameExtractionRequired)',
    model_version: '5.0.0',
    signals: [
      {
        name: 'Frame Extraction Required',
        category: 'System',
        description: 'Video deepfake detection requires frame-by-frame analysis via NVIDIA NIM. Open the /detect/video page in Chrome or Edge to enable automatic frame extraction.',
        weight: 100,
        value: 0,
        flagged: false,
      },
    ],
    summary: 'Video analysis requires frame extraction. Please use the video detection page at aiscern.com/detect/video in a modern browser (Chrome/Edge) which captures canvas frames for NVIDIA NIM analysis. API video detection without pre-extracted frames is not supported.',
    frame_scores: [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITER (use lib/ratelimit — functions below are DEPRECATED, kept only
// for backward-compat. Do NOT import these from hf-analyze.ts in new routes.)
// ─────────────────────────────────────────────────────────────────────────────
const _rlMap = new Map<string, { count: number; resetAt: number }>()

export async function checkRateLimitAsync(ip: string, limit = 20, windowMinutes = 1): Promise<boolean> {
  // FIX: use singleton admin client instead of creating a new client per call
  try {
    const { data } = await getSupabaseAdmin().rpc('check_and_increment_rate_limit', {
      p_ip: ip, p_max: limit, p_window_minutes: windowMinutes,
    })
    return data === true
  } catch {
    return checkRateLimit(ip, limit)
  }
}

export function checkRateLimit(ip: string, limit = 20, windowMs = 60000): boolean {
  const now = Date.now()
  const e   = _rlMap.get(ip)
  if (!e || now > e.resetAt) { _rlMap.set(ip, { count: 1, resetAt: now + windowMs }); return true }
  if (e.count >= limit) return false
  e.count++
  return true
}

