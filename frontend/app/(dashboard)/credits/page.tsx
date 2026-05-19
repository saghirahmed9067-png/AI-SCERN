/**
 * /dashboard/credits — Credit purchase UI
 * Shows plan cards priced in PKR, redirects to XPay hosted checkout on click.
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUser }  from '@clerk/nextjs'
import { toast }    from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Plan {
  id:           string
  name:         string
  pricePKR:     number
  priceUSD:     number
  credits:      number
  period:       string
  creditsLabel: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CreditsPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { user }     = useUser()

  const [plans,   setPlans]   = useState<Plan[]>([])
  const [loading, setLoading] = useState(false)
  const [buying,  setBuying]  = useState<string | null>(null)
  const [period,  setPeriod]  = useState<'monthly' | 'yearly'>('monthly')

  // Show toast on redirect back from XPay
  useEffect(() => {
    const status = searchParams.get('status')
    const order  = searchParams.get('order')
    if (status === 'success' && order) {
      toast.success('Payment successful! Your credits will appear within a minute.')
    } else if (status === 'failed') {
      toast.error('Payment was not completed. No charges were made.')
    }
  }, [searchParams])

  // Fetch plans from API
  useEffect(() => {
    fetch('/api/credits/purchase')
      .then(r => r.json())
      .then(d => setPlans(d.plans ?? []))
      .catch(() => toast.error('Failed to load plans'))
  }, [])

  const filteredPlans = plans.filter(p => p.period === period)

  const handlePurchase = useCallback(async (planId: string) => {
    if (!user) { router.push('/login'); return }
    setBuying(planId)
    try {
      const res = await fetch('/api/credits/purchase', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ planId }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Purchase failed'); return }
      // Redirect to XPay hosted payment page
      window.location.href = data.paymentUrl
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setBuying(null)
    }
  }, [user, router])

  return (
    <div className="min-h-screen bg-black text-white px-4 py-16">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3">Get Credits</h1>
          <p className="text-zinc-400 text-lg">
            Pay in PKR via card, JazzCash, or EasyPaisa. Instant crediting after payment.
          </p>

          {/* Period toggle */}
          <div className="inline-flex mt-8 p-1 bg-zinc-900 rounded-xl border border-zinc-800">
            {(['monthly', 'yearly'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${
                  period === p
                    ? 'bg-white text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {p === 'monthly' ? 'Monthly' : 'Yearly (save ~17%)'}
              </button>
            ))}
          </div>
        </div>

        {/* Plans grid */}
        {filteredPlans.length === 0 ? (
          <div className="text-center text-zinc-500 py-20">Loading plans…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {filteredPlans.map(plan => {
              const isEnterprise = plan.credits === -1
              const isPro        = plan.name.toLowerCase().includes('pro')
              const isBuying     = buying === plan.id

              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border p-8 flex flex-col gap-6 transition-all ${
                    isPro
                      ? 'border-white bg-white/5 ring-1 ring-white/20'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600'
                  }`}
                >
                  {isPro && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-black text-xs font-bold px-3 py-1 rounded-full">
                      MOST POPULAR
                    </span>
                  )}

                  <div>
                    <p className="text-zinc-400 text-sm mb-1">{plan.name}</p>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-bold">
                        PKR {plan.pricePKR.toLocaleString()}
                      </span>
                      <span className="text-zinc-500 text-sm mb-1">
                        /{plan.period === 'monthly' ? 'mo' : 'yr'}
                      </span>
                    </div>
                    <p className="text-zinc-500 text-xs mt-1">
                      ≈ USD {plan.priceUSD}
                    </p>
                  </div>

                  <div className="flex-1">
                    <div className="text-2xl font-semibold mb-1">
                      {isEnterprise ? '∞ Unlimited' : `${plan.credits} credits`}
                    </div>
                    <p className="text-zinc-400 text-sm">
                      {isEnterprise
                        ? 'Unlimited scans across all modalities'
                        : `${plan.credits} scans per ${plan.period === 'monthly' ? 'month' : 'year'}`}
                    </p>

                    <ul className="mt-6 space-y-2 text-sm text-zinc-300">
                      <li>✓ Text &amp; Image detection</li>
                      <li>✓ Audio &amp; Video detection</li>
                      <li>✓ Web page scanning</li>
                      {isPro || isEnterprise ? <li>✓ Batch processing</li> : null}
                      {isEnterprise ? <li>✓ Priority support &amp; SLA</li> : null}
                    </ul>
                  </div>

                  <button
                    onClick={() => handlePurchase(plan.id)}
                    disabled={isBuying || !!buying}
                    className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
                      isPro
                        ? 'bg-white text-black hover:bg-zinc-100 disabled:opacity-50'
                        : 'bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-40'
                    }`}
                  >
                    {isBuying ? 'Redirecting…' : `Get ${plan.name.split(' ')[0]}`}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Payment methods */}
        <div className="mt-12 text-center text-zinc-500 text-sm space-y-2">
          <p>Accepted: Visa · Mastercard · JazzCash · EasyPaisa · Google Pay</p>
          <p>Payments powered by XPay — PKR transactions, no international card fees.</p>
          <p className="text-zinc-600 text-xs">
            Credits are non-refundable. By purchasing you agree to our{' '}
            <a href="/terms" className="underline hover:text-zinc-400">Terms of Service</a>.
          </p>
        </div>
      </div>
    </div>
  )
}
