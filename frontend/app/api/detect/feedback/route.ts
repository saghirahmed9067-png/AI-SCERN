/**
 * POST /api/detect/feedback
 *
 * Accepts a ground-truth label for a completed scan.
 * Writes to scan_feedback table and fires indexConfirmedScan (RAG indexing).
 *
 * Body: {
 *   scan_id:      string   (UUID)
 *   ground_truth: 'AI' | 'HUMAN'
 *   note?:        string   (optional free-text reason)
 *   content?:     string   (optional — text content to embed; image/audio omit this)
 * }
 *
 * Auth: any authenticated Clerk user. Admins can label any scan; users can
 *       only label their own scans.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth }                      from '@clerk/nextjs/server'
import { getSupabaseAdmin }          from '@/lib/supabase/admin'
import { indexConfirmedScan }        from '@/lib/rag/detection-rag'

export const dynamic = 'force-dynamic'

const ADMIN_IDS = new Set((process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean))

function isAdmin(userId: string): boolean {
  return ADMIN_IDS.has(userId)
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: {
    scan_id:      string
    ground_truth: string
    note?:        string
    content?:     string   // text content to embed for RAG — optional
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { scan_id, ground_truth, note, content } = body

  if (!scan_id || typeof scan_id !== 'string') {
    return NextResponse.json({ success: false, error: 'scan_id required' }, { status: 400 })
  }
  if (ground_truth !== 'AI' && ground_truth !== 'HUMAN') {
    return NextResponse.json({ success: false, error: 'ground_truth must be AI or HUMAN' }, { status: 400 })
  }

  const db = getSupabaseAdmin()

  // ── Verify scan ownership (non-admins can only label their own scans) ────────
  if (!isAdmin(userId)) {
    const { data: scan, error } = await db
      .from('scans')
      .select('id, user_id, media_type')
      .eq('id', scan_id)
      .single()

    if (error || !scan) {
      return NextResponse.json({ success: false, error: 'Scan not found' }, { status: 404 })
    }
    if (scan.user_id !== userId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
  }

  // ── Fetch scan metadata for RAG indexing ────────────────────────────────────
  const { data: scanRow } = await db
    .from('scans')
    .select('media_type, content_preview')
    .eq('id', scan_id)
    .single()

  const modality = (scanRow?.media_type ?? 'text') as 'text' | 'image' | 'audio' | 'video'

  // ── Upsert feedback (one row per scan) ──────────────────────────────────────
  const { error: upsertErr } = await db
    .from('scan_feedback')
    .upsert({
      scan_id,
      ground_truth,
      feedback_source: isAdmin(userId) ? 'admin' : 'user',
      note:            note ?? null,
      created_by:      userId,
    }, { onConflict: 'scan_id' })

  if (upsertErr) {
    console.error('[feedback] upsert error:', upsertErr.message)
    return NextResponse.json({ success: false, error: 'Database error' }, { status: 500 })
  }

  // ── RAG indexing (fire-and-forget) ──────────────────────────────────────────
  // Use submitted content if provided, fall back to content_preview from the scan row.
  // Image/audio scans pass a text description; for those callers can omit content
  // and we skip embedding (RAG only works for text modality until multi-modal embeddings land).
  const embedContent = content ?? scanRow?.content_preview ?? null
  if (embedContent && modality === 'text') {
    void indexConfirmedScan(scan_id, embedContent, ground_truth as 'AI' | 'HUMAN', modality)
  }

  return NextResponse.json({ success: true })
}
