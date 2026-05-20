import { NextRequest, NextResponse } from 'next/server'
import { analyzeText }               from '@/lib/inference/hf-analyze'
import { checkRateLimit } from '@/lib/ratelimit'
import { getCachedDetection, setCachedDetection, contentHash } from '@/lib/cache/detection-cache'
import { creditGuard, httpErrorResponse, HTTPError } from '@/lib/middleware/credit-guard'
import { fireScanCompleted }                           from '@/lib/inngest/send-scan-event'
import { sanitizeText } from '@/lib/utils/sanitize'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { logModelPredictions } from '@/lib/accuracy/log-predictions'
import { queryDetectionRAG } from '@/lib/rag/detection-rag'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'

  // BUG-06 FIX: Removed duplicate checkRateLimitDB('text') call. creditGuard already handles
  // per-user rate limiting for both auth and anon users. We only keep a lightweight DOS guard
  // at a high threshold (30/min shared) to prevent total IP saturation.
  const dosRl = await checkRateLimit('upload', ip) // 30/min — shared DOS protection only
  if (dosRl.limited) {
    return NextResponse.json(
      { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again in a minute.' } },
      { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(dosRl.reset) } }
    )
  }

  const internalSecret = req.headers.get('X-Internal-Secret')
  const isInternal     = internalSecret && internalSecret === process.env.INTERNAL_API_SECRET

  let userId: string
  if (isInternal) {
    userId = 'internal'
  } else {
    try {
      const guard = await creditGuard(req, 'text')
      userId      = guard.userId
    } catch (err) {
      if (err instanceof HTTPError) return httpErrorResponse(err)
      return NextResponse.json({ success: false, error: { code: 'ERROR', message: 'Request failed' } }, { status: 500 })
    }
  }

  const start = Date.now()
  try {
    const body = await req.json().catch(() => ({}))
    const { text } = body

    if (!text || typeof text !== 'string')
      return NextResponse.json({ success: false, error: { code: 'NO_TEXT', message: 'No text provided' } }, { status: 400 })
    if (text.length < 50)
      return NextResponse.json({ success: false, error: { code: 'TOO_SHORT', message: 'Text must be at least 50 characters' } }, { status: 400 })
    // Increased to 50,000 chars — supports full PDFs and long documents
    if (text.length > 50000)
      return NextResponse.json({ success: false, error: { code: 'TOO_LONG', message: 'Text must be under 50,000 characters (about 35 pages)' } }, { status: 400 })

    const sanitized = sanitizeText(text)
    const hash   = contentHash(sanitized)
    const cached = await getCachedDetection('text', hash)
    if (cached) {
      return NextResponse.json({
        success: true, scan_id: null, cached: true,
        result:  { ...cached, processing_time: Date.now() - start },
      })
    }

    const result         = await analyzeText(sanitized)
    const processingTime = Date.now() - start

    // ── RAG blending (gated by DETECTION_RAG_ENABLED) ─────────────────────────
    let finalVerdict   = result.verdict
    let finalConfidence = result.confidence
    let ragResult: any = null
    
    if (process.env.DETECTION_RAG_ENABLED === 'true') {
      try {
        ragResult = await queryDetectionRAG(sanitized, 'text', result.confidence)
        if (ragResult?.rag_applied) {
          finalConfidence = ragResult.blended_score
          // Re-determine verdict based on blended score
          if (finalConfidence >= 0.62)      finalVerdict = 'AI'
          else if (finalConfidence <= 0.38) finalVerdict = 'HUMAN'
          else                               finalVerdict = 'UNCERTAIN'
        }
      } catch (e) {
        console.warn('[detect/text] RAG query error (non-blocking):', e)
        // Continue with original result on RAG failure
      }
    }

    await setCachedDetection('text', hash, result)

    let scanId: string | null = null
    if (userId !== 'internal' && !userId.startsWith('anon_')) {
      try {
        const { data: scanRow, error: insertErr } = await getSupabaseAdmin().from('scans').insert({
          user_id:          userId,
          media_type:       'text',
          content_preview:  sanitized.substring(0, 500),
          verdict:          finalVerdict,
          confidence_score: finalConfidence,
          signals:          result.signals,
          processing_time:  processingTime,
          model_used:       result.model_used,
          model_version:    result.model_version,
          status:           'complete',
          metadata:         { 
            char_count: sanitized.length, 
            word_count: sanitized.split(/\s+/).length,
            rag_applied: ragResult?.rag_applied ?? false,
            rag_confidence: ragResult?.retrieval_confidence,
          },
        }).select('id').single()
        if (insertErr) console.error('[detect/text] scan insert error:', insertErr.message, insertErr.code)
        scanId = scanRow?.id ?? null
      } catch (e) { console.error('[detect/text] scan insert threw:', e) }
    } else if (userId.startsWith('anon_')) {
      // Save anonymous scans for analytics (anon_id column now exists)
      try {
        await getSupabaseAdmin().from('scans').insert({
          user_id:          null,
          anon_id:          userId,
          media_type:       'text',
          content_preview:  sanitized.substring(0, 200),
          verdict:          finalVerdict,
          confidence_score: finalConfidence,
          processing_time:  processingTime,
          model_used:       result.model_used,
          status:           'complete',
          metadata:         { rag_applied: ragResult?.rag_applied ?? false },
        })
      } catch { /* non-fatal */ }
    }

    // Fire Inngest background job (fire-and-forget, non-blocking)
    if (scanId) fireScanCompleted({ scan_id: scanId, user_id: userId, media_type: 'text', verdict: finalVerdict, confidence: finalConfidence, model_used: result.model_used })

    // Accuracy monitoring — fire-and-forget, never blocks response (uses final verdict from RAG blending)
    if (scanId && result.model_breakdown?.length) {
      void logModelPredictions(scanId, 'text', result.model_breakdown, finalVerdict)
    }

    return NextResponse.json({
      success: true,
      scan_id: scanId,
      result:  { 
        ...result, 
        verdict: finalVerdict,
        confidence: finalConfidence,
        processing_time: processingTime,
        rag_stats: ragResult ? {
          rag_applied: ragResult.rag_applied,
          retrieval_confidence: ragResult.retrieval_confidence,
          neighbour_count: ragResult.neighbour_count,
          ai_ratio: ragResult.ai_ratio,
        } : undefined,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'ANALYSIS_FAILED', message: err instanceof Error ? err.message : 'Analysis failed' } },
      { status: 500 }
    )
  }
}
