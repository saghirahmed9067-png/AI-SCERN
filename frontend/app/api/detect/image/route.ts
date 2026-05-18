import { NextRequest, NextResponse } from 'next/server'
import { analyzeImage }              from '@/lib/inference/hf-analyze'
import { checkRateLimitDB } from '@/lib/ratelimit-db'
import { getCachedDetection, setCachedDetection, contentHash } from '@/lib/cache/detection-cache'
import { creditGuard, httpErrorResponse, HTTPError } from '@/lib/middleware/credit-guard'
import { fireScanCompleted }             from '@/lib/inngest/send-scan-event'
import { getSupabaseAdmin }          from '@/lib/supabase/admin'
import { getR2Buffer, r2Available }  from '@/lib/storage/r2'
import { logModelPredictions }       from '@/lib/accuracy/log-predictions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
  const rl = await checkRateLimitDB('image', ip)
  if (rl.limited) return NextResponse.json(
    { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again in a minute.' } },
    { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(rl.reset) } }
  )

  let userId: string
  try {
    const guard = await creditGuard(req, 'image')
    userId      = guard.userId
  } catch (err) {
    if (err instanceof HTTPError) return httpErrorResponse(err)
    return NextResponse.json({ success: false, error: { code: 'ERROR', message: 'Request failed' } }, { status: 500 })
  }

  const start       = Date.now()
  const contentType = req.headers.get('content-type') ?? ''

  try {
    let buffer:   Buffer
    let mimeType: string
    let fileName: string
    let fileSize: number
    let r2Key:    string | null = null

    if (contentType.includes('application/json')) {
      const body = await req.json()
      const { r2Key: key, fileName: fn, fileSize: fs, mimeType: mt } = body

      if (!key || typeof key !== 'string')
        return NextResponse.json({ success: false, error: { code: 'NO_KEY', message: 'r2Key required' } }, { status: 400 })
      if (!r2Available())
        return NextResponse.json({ success: false, error: { code: 'R2_UNAVAILABLE', message: 'Storage not configured' } }, { status: 503 })

      const r2 = await getR2Buffer(key)
      buffer   = r2.buffer
      mimeType = mt || r2.contentType
      fileName = fn || key.split('/').pop() || 'image'
      fileSize = fs || buffer.length
      r2Key    = key
    } else {
      const form = await req.formData()
      const file = form.get('file') as File | null
      if (!file)
        return NextResponse.json({ success: false, error: { code: 'NO_FILE', message: 'No file provided' } }, { status: 400 })
      if (!file.type.startsWith('image/'))
        return NextResponse.json({ success: false, error: { code: 'INVALID_TYPE', message: 'File must be an image' } }, { status: 400 })
      if (file.size > 10 * 1024 * 1024)
        return NextResponse.json({ success: false, error: { code: 'TOO_LARGE', message: 'Image must be under 10MB' } }, { status: 400 })

      const bytes = await file.arrayBuffer()
      buffer   = Buffer.from(bytes)
      mimeType = file.type
      fileName = file.name
      fileSize = file.size
    }

    if (!mimeType.startsWith('image/'))
      return NextResponse.json({ success: false, error: { code: 'INVALID_TYPE', message: 'File must be an image' } }, { status: 400 })
    if (fileSize > 10 * 1024 * 1024)
      return NextResponse.json({ success: false, error: { code: 'TOO_LARGE', message: 'Image must be under 10MB' } }, { status: 400 })

    const hash   = contentHash(buffer.subarray(0, 65536))
    const cached = await getCachedDetection('image', hash)
    if (cached) {
      // Save scan to DB even on cache hit (user still did a scan)
      let scanId: string | null = null
      if (userId && !userId.startsWith('anon_')) {
        try {
          const { data: sr } = await getSupabaseAdmin().from('scans').insert({
            user_id:          userId,
            media_type:       'image',
            file_name:        fileName,
            file_size:        fileSize,
            r2_key:           r2Key,
            verdict:          cached.verdict,
            confidence_score: cached.confidence,
            signals:          cached.signals,
            processing_time:  Date.now() - start,
            model_used:       cached.model_used,
            status:           'complete',
            metadata:         { format: mimeType, size_kb: Math.round(fileSize / 1024), cached: true },
          }).select('id').single()
          scanId = sr?.id ?? null
        } catch { /* non-fatal */ }
      }
      return NextResponse.json({
        success: true, scan_id: scanId, cached: true,
        result:  { ...cached, processing_time: Date.now() - start, file_name: fileName, file_size: fileSize },
      })
    }

    const result         = await analyzeImage(buffer, mimeType, fileName)
    const processingTime = Date.now() - start

    await setCachedDetection('image', hash, result)

    let scanId: string | null = null
    if (userId && !userId.startsWith('anon_')) {
      try {
        const { data: sr } = await getSupabaseAdmin().from('scans').insert({
          user_id:          userId,
          media_type:       'image',
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
          metadata:         { format: mimeType, size_kb: Math.round(fileSize / 1024), r2: !!r2Key },
        }).select('id').single()
        scanId = sr?.id ?? null
      } catch { /* non-fatal */ }
    }

    // Fire Inngest background job (fire-and-forget, non-blocking)
    if (scanId) fireScanCompleted({ scan_id: scanId, user_id: userId, media_type: 'image', verdict: result.verdict, confidence: result.confidence, model_used: result.model_used })

    // Accuracy monitoring — fire-and-forget
    if (scanId && result.model_breakdown?.length) {
      void logModelPredictions(scanId, 'image', result.model_breakdown, result.verdict)
    }

    // ── Fire forensic cascade (non-blocking, parallel to response) ────────────
    // Runs the 6-layer pipeline in the background. User gets instant result now,
    // forensic deep-analysis is ready ~10s later at /forensic/[forensicScanId].
    let forensicScanId: string | null = null
    if (r2Key) {
      try {
        const { inngest }    = await import('@/lib/inngest/client')
        const { getR2PublicUrl } = await import('@/lib/storage/r2')
        forensicScanId = crypto.randomUUID()
        const imageUrl = getR2PublicUrl(r2Key)

        // Insert forensic_scans pending row so the UI can poll immediately
        // IMPORTANT: Supabase .insert() returns {data,error} — it does NOT throw.
        // Must check error explicitly or the row is silently missing and the user
        // gets "Scan not found" when they click the Deep Forensic Analysis button.
        const { error: insertErr } = await getSupabaseAdmin().from('forensic_scans').insert({
          id:                       forensicScanId,
          image_url:                imageUrl,
          r2_key:                   r2Key,
          user_id:                  userId && !userId.startsWith('anon_') ? userId : null,
          status:                   'pending',
          layers:                   [],
          semantic_agents:          [],
          provenance:               null,
          final_verdict:            null,
          existing_ensemble_result: {
            confidence: result.confidence / 100,
            label:      result.verdict === 'AI' ? 'ai' : result.verdict === 'HUMAN' ? 'human' : 'uncertain',
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        if (insertErr) {
          console.error('[detect/image] forensic_scans insert failed:', insertErr.message, insertErr.code)
          throw new Error('forensic_scans insert failed: ' + insertErr.message)
        }

        // Fire Inngest cascade — runs in background, never blocks this response
        await inngest.send({
          name: 'scan/image.forensic-cascade' as any,
          data: {
            scanId:   forensicScanId,
            imageUrl,
            r2Key,
            existingEnsembleResult: {
              confidence: result.confidence / 100,
              label:      result.verdict === 'AI' ? 'ai' : result.verdict === 'HUMAN' ? 'human' : 'uncertain',
            },
          },
        })
      } catch (e) {
        // Never block the response — forensic cascade is best-effort
        console.warn('[detect/image] forensic cascade fire failed:', e)
        forensicScanId = null
      }
    }

    return NextResponse.json({
      success: true, scan_id: scanId,
      forensic_scan_id: forensicScanId,
      result:  { ...result, processing_time: processingTime, file_name: fileName, file_size: fileSize },
    })
  } catch (err) {
    console.error('[detect/image]', err)
    return NextResponse.json(
      { success: false, error: { code: 'ANALYSIS_FAILED', message: err instanceof Error ? err.message : 'Analysis failed' } },
      { status: 500 }
    )
  }
}
