/**
 * Credit Purchase Endpoint
 * POST /api/credits/purchase
 *
 * Creates an XPay hosted checkout session and returns the payment URL.
 * The user is redirected to XPay's payment page; on completion XPay calls
 * our webhook (/api/webhook/xpay) to credit their account.
 *
 * Body: { planId: XPayPlanId }
 * Returns: { paymentUrl: string, orderId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createXPayCheckout, XPAY_PLANS, type XPayPlanId } from '@/lib/xpay/client'
import { checkRateLimit } from '@/lib/ratelimit'
import { nanoid } from 'nanoid'
import { z } from 'zod'

const PurchaseSchema = z.object({
  planId: z.enum([
    'starter_monthly', 'starter_yearly',
    'pro_monthly',     'pro_yearly',
    'enterprise_monthly', 'enterprise_yearly',
  ]),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth check — must be signed in to purchase
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // 2. Rate limit: max 10 checkout attempts per user per hour
  const rl = await checkRateLimit('credit_purchase', userId)
  if (rl.limited) {
    return NextResponse.json({ error: 'Too many purchase attempts. Try again later.' }, { status: 429 })
  }

  // 3. Parse + validate body
  let body: z.infer<typeof PurchaseSchema>
  try {
    const raw = await req.json()
    body = PurchaseSchema.parse(raw)
  } catch (err) {
    return NextResponse.json({ error: 'Invalid request body', details: String(err) }, { status: 400 })
  }

  const { planId } = body
  const plan       = XPAY_PLANS[planId as XPayPlanId]
  if (!plan) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  // 4. Get user details from Clerk
  const user = await currentUser()
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const customerName  = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Aiscern User'
  const customerEmail = user.emailAddresses[0]?.emailAddress ?? ''
  const customerPhone = user.phoneNumbers[0]?.phoneNumber ?? ''

  if (!customerEmail) {
    return NextResponse.json({ error: 'Account email is required for payments' }, { status: 400 })
  }

  // 5. Generate idempotent order ID
  const orderId = `asc_${userId.slice(0, 8)}_${nanoid(10)}`

  const baseUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://aiscern.com'
  const webhookUrl = `${baseUrl}/api/webhook/xpay`

  // 6. Create XPay hosted checkout
  const checkout = await createXPayCheckout({
    amount:        plan.pricePKR,
    orderId,
    description:   `Aiscern ${plan.name} — ${plan.credits === -1 ? 'Unlimited' : plan.credits} credits`,
    customerName,
    customerEmail,
    customerPhone,
    successUrl:    `${baseUrl}/dashboard/credits?status=success&order=${orderId}`,
    failureUrl:    `${baseUrl}/dashboard/credits?status=failed&order=${orderId}`,
    webhookUrl,
    currency:      'PKR',
    // metadata is passed back in the webhook — used to resolve user + plan
    metadata: {
      user_id:  userId,
      plan_id:  planId,
      credits:  String(plan.credits),
    },
  })

  if (!checkout.success) {
    console.error('[credits:purchase] XPay error:', checkout.error)
    return NextResponse.json(
      { error: 'Payment gateway error. Please try again.', details: checkout.error },
      { status: 502 },
    )
  }

  return NextResponse.json({
    success:    true,
    paymentUrl: checkout.paymentUrl,
    orderId:    checkout.orderId,
    plan: {
      id:      planId,
      name:    plan.name,
      pricePKR: plan.pricePKR,
      priceUSD: plan.priceUSD,
      credits:  plan.credits,
      period:   plan.period,
    },
  })
}

// GET: return available plans (used by credits page UI)
export async function GET(): Promise<NextResponse> {
  const plans = Object.entries(XPAY_PLANS).map(([id, plan]) => ({
    id,
    ...plan,
    creditsLabel: plan.credits === -1 ? 'Unlimited' : `${plan.credits} credits`,
  }))
  return NextResponse.json({ plans })
}
