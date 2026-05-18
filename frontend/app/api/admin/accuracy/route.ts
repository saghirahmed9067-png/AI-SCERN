/**
 * GET /api/admin/accuracy
 *
 * Returns per-model accuracy metrics for the admin dashboard.
 * Pulls from the model_accuracy_7d, model_accuracy_30d, and ensemble_accuracy views
 * that are populated by scan_feedback + model_predictions.
 *
 * Response shape:
 * {
 *   by_model_7d:   ModelAccuracyRow[]    // per-model, last 7 days
 *   by_model_30d:  ModelAccuracyRow[]    // per-model, last 30 days
 *   ensemble:      EnsembleAccuracyRow[] // ensemble-level per modality
 *   total_labeled: number                // total scans with ground-truth
 *   rag_stats:     RAGStats              // detection-rag hit rate
 * }
 */

import { NextResponse }  from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { verifyAdmin, isAdminError } from '@/lib/auth/verify-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = await verifyAdmin()
  if (isAdminError(admin)) return admin

  const db = getSupabaseAdmin()

  try {
    const [
      { data: byModel7d,   error: e1 },
      { data: byModel30d,  error: e2 },
      { data: ensemble,    error: e3 },
      { data: ragStats,    error: e4 },
      { data: labeledCount, error: e5 },
    ] = await Promise.all([
      // Per-model, 7-day window
      db.from('model_accuracy_7d').select('*'),

      // Per-model, 30-day window
      db.from('model_accuracy_30d').select('*'),

      // Ensemble-level per modality
      db.from('ensemble_accuracy').select('*'),

      // RAG hit stats — count how many scans in last 7d had a neighbour returned
      db.from('model_predictions')
        .select('model_id, agreed_with_ensemble, created_at')
        .gte('created_at', new Date(Date.now() - 7 * 86400_000).toISOString())
        .limit(5000),

      // Total ground-truth labelled scans
      db.from('scan_feedback')
        .select('*', { count: 'exact', head: true }),
    ])

    if (e1) console.warn('[accuracy] model_accuracy_7d error:', e1.message)
    if (e2) console.warn('[accuracy] model_accuracy_30d error:', e2.message)
    if (e3) console.warn('[accuracy] ensemble_accuracy error:', e3.message)
    if (e4) console.warn('[accuracy] rag_stats error:', e4.message)
    if (e5) console.warn('[accuracy] labeledCount error:', e5.message)

    // Agreement rate — fraction of model predictions that agreed with the ensemble
    const predictions  = ragStats ?? []
    const totalPred    = predictions.length
    const agreedCount  = predictions.filter((r: any) => r.agreed_with_ensemble).length
    const disagreedCount = totalPred - agreedCount

    // Find the most disagreeable model (potential weak link)
    const disagreementByModel: Record<string, { total: number; disagreed: number }> = {}
    for (const p of predictions as any[]) {
      if (!disagreementByModel[p.model_id]) {
        disagreementByModel[p.model_id] = { total: 0, disagreed: 0 }
      }
      disagreementByModel[p.model_id].total++
      if (!p.agreed_with_ensemble) disagreementByModel[p.model_id].disagreed++
    }

    const modelDisagreement = Object.entries(disagreementByModel)
      .map(([model_id, stats]) => ({
        model_id,
        disagreement_rate: stats.total > 0
          ? Math.round((stats.disagreed / stats.total) * 1000) / 10
          : 0,
        total: stats.total,
      }))
      .sort((a, b) => b.disagreement_rate - a.disagreement_rate)

    return NextResponse.json({
      by_model_7d:  byModel7d  ?? [],
      by_model_30d: byModel30d ?? [],
      ensemble:     ensemble   ?? [],
      total_labeled: labeledCount ?? 0,
      model_disagreement_7d: modelDisagreement,
      summary_7d: {
        total_predictions:   totalPred,
        ensemble_agreement:  totalPred > 0
          ? Math.round((agreedCount / totalPred) * 1000) / 10
          : null,
        models_tracked:      Object.keys(disagreementByModel).length,
        most_disagreeable:   modelDisagreement[0]?.model_id ?? null,
      },
    })
  } catch (err: any) {
    console.error('[accuracy] GET threw:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
