/**
 * XPay Webhook Handler
 * POST /api/webhook/xpay
 *
 * XPay calls this endpoint after every payment event.
 * Verifies HMAC-SHA256 signature, then runs the credit-purchase saga.
 *
 * Security:
 *  - Timing-safe HMAC-SHA256 verification
 *  - Idempotency: order_id unique constraint in DB (ON CONFLICT DO NOTHING)
 *  - Body size capped at 64 KB
 *  - No sensitive fields logged
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyXPayWebhook, XPAY_PLANS, type XPayWebhookPayload, type XPayPlanId } from '@/lib/xpay/client'
import { runCreditPurchaseSaga } from '@/lib/db/saga'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

const MAX_BODY_BYTES = 64 * 1024

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Body size guard
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  // 2. Raw body (required for HMAC)
  let rawBody: string
  try { rawBody = await req.text() }
  catch { return NextResponse.json({ error: 'Failed to read body' }, { status: 400 }) }

  // 3. Parse JSON
  let payload: XPayWebhookPayload
  try { payload = JSON.parse(rawBody) as XPayWebhookPayload }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // 4. HMAC signature verification (timing-safe)
  if (!verifyXPayWebhook(payload, rawBody)) {
    console.warn('[webhook:xpay] Bad signature, order:', payload?.order_id)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { order_id, transaction_id, status, amount, customer_email, metadata } = payload

  // 5. Only process SUCCESS events — return 200 for others to stop retries
  if (status !== 'SUCCESS') {
    return NextResponse.json({ received: true, action: 'ignored', status })
  }

  // 6. Resolve user — prefer metadata.user_id, fallback to email lookup
  const userId = metadata?.user_id ?? await resolveUserByEmail(customer_email)
  if (!userId) {
    console.error('[webhook:xpay] Cannot resolve user for order:', order_id)
    return NextResponse.json({ received: true, error: 'User not found', action: 'skipped' })
  }

  // 7. Resolve plan
  const planId = (metadata?.plan_id ?? 'starter_monthly') as XPayPlanId
  const plan   = XPAY_PLANS[planId]
  if (!plan) {
    return NextResponse.json({ received: true, error: 'Unknown plan', action: 'skipped' })
  }

  const amountPkr = Math.round(parseFloat(amount))
  const credits   = plan.credits === -1 ? 999_999 : plan.credits

  // 8. Run idempotent saga (order_id unique constraint prevents double-crediting)
  const saga = await runCreditPurchaseSaga({ userId, orderId: order_id, credits, amountPkr, planId })

  if (!saga.success) {
    console.error('[webhook:xpay] Saga failed:', order_id, saga.error)
    return NextResponse.json({ error: 'Credit processing failed', saga_id: saga.sagaId }, { status: 500 })
  }

  // 9. Update plan tier in Supabase profile (best-effort — credits already applied)
  try {
    const admin = getSupabaseAdmin()
    const tier  = planId.includes('enterprise') ? 'enterprise' : planId.includes('pro') ? 'pro' : 'starter'
    await admin
      .from('profiles')
      .update({ plan: tier, plan_period: plan.period, plan_updated_at: new Date().toISOString() })
      .eq('id', userId)
  } catch (err) {
    console.error('[webhook:xpay] Plan update failed (non-fatal):', err)
  }

  console.log(`[webhook:xpay] ✓ +${credits} credits → user ${userId} (order ${order_id})`)

  return NextResponse.json({
    received:      true,
    action:        'credited',
    saga_id:       saga.sagaId,
    credits_added: credits,
    order_id,
    transaction_id,
  })
}

async function resolveUserByEmail(email: string): Promise<string | null> {
  try {
    const { data } = await getSupabaseAdmin()
      .from('profiles').select('id').eq('email', email).limit(1).single()
    return data?.id ?? null
  } catch { return null }
}
