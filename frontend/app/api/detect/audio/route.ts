import { NextRequest, NextResponse } from 'next/server'
import { analyzeAudio }              from '@/lib/inference/hf-analyze'
import { checkRateLimitDB } from '@/lib/ratelimit-db'
import { getCachedDetection, setCachedDetection, contentHash } from '@/lib/cache/detection-cache'
import { creditGuard, httpErrorResponse, HTTPError } from '@/lib/middleware/credit-guard'
import { fireScanCompleted }             from '@/lib/inngest/send-scan-event'
import { getSupabaseAdmin }          from '@/lib/supabase/admin'
import { getR2Buffer, r2Available }  from '@/lib/storage/r2'
import { analyzeAudio as runForensicPipeline } from '@/lib/forensic/audio/pipeline'
import { logModelPredictions }       from '@/lib/accuracy/log-predictions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
  const rl = await checkRateLimitDB('audio', ip)
  if (rl.limited) return NextResponse.json(
    { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again in a minute.' } },
    { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(rl.reset) } }
  )

  let userId: string
  try {
    const guard = await creditGuard(req, 'audio')
    userId      = guard.userId
  } catch (err) {
    if (err instanceof HTTPError) return httpErrorResponse(err)
    return NextResponse.json({ success: false, error: { code: 'ERROR', message: 'Request failed' } }, { status: 500 })
  }

  const start       = Date.now()
  const contentType = req.headers.get('content-type') ?? ''

  try {
    let buffer:   Buffer | undefined
    let fileName: string
    let fileSize: number
    let format:   string
    let r2Key:    string | null = null

    if (contentType.includes('application/json')) {
      const body = await req.json()
      const { r2Key: key, fileName: fn, fileSize: fs, format: fmt } = body

      if (!key || typeof key !== 'string')
        return NextResponse.json({ success: false, error: { code: 'NO_KEY', message: 'r2Key required' } }, { status: 400 })
      if (!r2Available())
        return NextResponse.json({ success: false, error: { code: 'R2_UNAVAILABLE', message: 'Storage not configured' } }, { status: 503 })

      const r2 = await getR2Buffer(key)
      buffer   = r2.buffer
      fileName = fn || key.split('/').pop() || 'audio'
      fileSize = fs || buffer.length
      format   = fmt || fileName.split('.').pop()?.toLowerCase() || 'mp3'
      r2Key    = key
    } else {
      const form = await req.formData()
      const file = form.get('file') as File | null
      if (!file)
        return NextResponse.json({ success: false, error: { code: 'NO_FILE', message: 'No file provided' } }, { status: 400 })
      if (file.size > 25 * 1024 * 1024)
        return NextResponse.json({ success: false, error: { code: 'TOO_LARGE', message: 'Audio must be under 25MB' } }, { status: 400 })

      const bytes = await file.arrayBuffer()
      buffer   = Buffer.from(bytes)
      fileName = file.name
      fileSize = file.size
      format   = file.name.split('.').pop()?.toLowerCase() || 'mp3'
    }

    // Cache check
    const hashInput = buffer ?? Buffer.alloc(0)
    const hash   = contentHash(hashInput.subarray(0, 65536))
    const cached = buffer && buffer.length > 0 ? await getCachedDetection('audio', hash) : null
    if (cached) {
      let scanId: string | null = null
      if (userId && !userId.startsWith('anon_')) {
        try {
          const { data: sr } = await getSupabaseAdmin().from('scans').insert({
            user_id:          userId,
            media_type:       'audio',
            file_name:        fileName,
            file_size:        fileSize,
            r2_key:           r2Key,
            verdict:          cached.verdict,
            confidence_score: cached.confidence,
            signals:          cached.signals,
            processing_time:  Date.now() - start,
            model_used:       cached.model_used,
            status:           'complete',
            metadata:         { format, cached: true, r2: !!r2Key },
          }).select('id').single()
          scanId = sr?.id ?? null
        } catch { /* non-fatal */ }
      }
      return NextResponse.json({
        success: true, scan_id: scanId, cached: true,
        result:  { ...cached, processing_time: Date.now() - start, file_name: fileName },
      })
    }

    // ── Run HF model pipeline and forensic pipeline in parallel ───────────────
    const estimatedDurationSec = Math.round(fileSize / (128 * 1024 / 8))
    const transcription = '' // populated by STT service (Whisper) when integrated

    const [hfSettled, forensicSettled] = await Promise.allSettled([
      analyzeAudio(fileName, fileSize, format, buffer),
      runForensicPipeline({
        transcription,
        durationSeconds:     estimatedDurationSec,
        precomputedFeatures: {},
      }),
    ])

    const hfResult = hfSettled.status === 'fulfilled' ? hfSettled.value : null
    if (!hfResult) throw new Error('HF audio analysis failed')

    const forensicData = forensicSettled.status === 'fulfilled' ? forensicSettled.value : null
    if (forensicSettled.status === 'rejected') {
      console.warn('[detect/audio] Forensic pipeline non-fatal error:', forensicSettled.reason)
    }

    // Blend HF + forensic when forensic data is available
    let blendedConfidence = hfResult.confidence
    let blendedVerdict    = hfResult.verdict
    let forensicSummary:  Record<string, unknown> | null = null

    if (forensicData) {
      const forensicAIScore = forensicData.overallScore
      const hfAIScore       = hfResult.verdict === 'AI'    ? hfResult.confidence
                            : hfResult.verdict === 'HUMAN' ? 1 - hfResult.confidence
                            : 0.5
      const blendedScore = 0.60 * hfAIScore + 0.40 * forensicAIScore
      blendedVerdict     = blendedScore > 0.65 ? 'AI' : blendedScore < 0.35 ? 'HUMAN' : 'UNCERTAIN'
      blendedConfidence  = blendedVerdict === 'AI'    ? blendedScore
                         : blendedVerdict === 'HUMAN' ? 1 - blendedScore
                         : 0.5
      forensicSummary = {
        l1Score:              forensicData.l1Score,
        l2Score:              forensicData.l2Score,
        l3Score:              forensicData.l3Score,
        overallScore:         forensicData.overallScore,
        confidence:           forensicData.confidence,
        confidenceInterval:   forensicData.confidenceInterval,
        generatorAttribution: forensicData.generatorAttribution,
        primaryEvidence:      forensicData.primaryEvidence,
        layerScores:          forensicData.layerScores,
      }
    }

    const result         = { ...hfResult, confidence: blendedConfidence, verdict: blendedVerdict }
    const processingTime = Date.now() - start

    if (buffer && buffer.length > 0) await setCachedDetection('audio', hash, result)

    let scanId: string | null = null
    if (userId && !userId.startsWith('anon_')) {
      try {
        const { data: sr } = await getSupabaseAdmin().from('scans').insert({
          user_id:          userId,
          media_type:       'audio',
          file_name:        fileName,
          file_size:        fileSize,
          r2_key:           r2Key,
          verdict:          result.verdict,
          confidence_score: result.confidence,
          signals:          result.signals,
          processing_time:  processingTime,
          model_used:       result.model_used,
          model_version:    result.model_version,
          status:           'complete',
          metadata: {
            format,
            estimated_duration_sec: estimatedDurationSec,
            r2: !!r2Key,
            forensic: forensicSummary ?? undefined,
          },
        }).select('id').single()
        scanId = sr?.id ?? null
      } catch { /* non-fatal */ }
    }

    // Fire Inngest background job (fire-and-forget, non-blocking)
    if (scanId) fireScanCompleted({ scan_id: scanId, user_id: userId, media_type: 'audio', verdict: result.verdict, confidence: result.confidence, model_used: result.model_used })

    // Accuracy monitoring — fire-and-forget
    if (scanId && result.model_breakdown?.length) {
      void logModelPredictions(scanId, 'audio', result.model_breakdown, result.verdict)
    }

    return NextResponse.json({
      success: true, scan_id: scanId,
      result:  { ...result, processing_time: processingTime, file_name: fileName, forensic: forensicSummary },
    })
  } catch (err) {
    console.error('[detect/audio]', err)
    return NextResponse.json(
      { success: false, error: { code: 'ANALYSIS_FAILED', message: err instanceof Error ? err.message : 'Analysis failed' } },
      { status: 500 }
    )
  }
}
