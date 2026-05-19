/**
 * Aiscern — Credit Guard Middleware v2
 *
 * Guards every /api/detect/* route. In order:
 *  1. Clerk auth → identifies user (or anon IP)
 *  2. Calls check_and_increment_scan() — atomic credit + daily-limit check in Supabase
 *  3. For anon users → Redis rate limit (5/day)
 *
 * The DB function handles:
 *  - Modality access (free tier = text+image only)
 *  - Daily scan limit per plan
 *  - Credit balance deduction for paid plans
 *  - Overage: if daily limit hit but credits remain → deduct from balance
 *
 * Usage in any /api/detect/* route:
 *   const guard = await creditGuard(req, 'image')  // throws HTTPError on failure
 *   // guard.userId, guard.plan, guard.creditsRemaining available
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth }             from '@clerk/nextjs/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { checkRateLimit }   from '@/lib/ratelimit'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreditGuardResult {
  userId:           string
  creditsRemaining: number
  plan:             string
  dailyScans:       number
  dailyLimit:       number
  unlimited?:       boolean
  overage?:         boolean     // true if scan came from credit balance overage
}

export class HTTPError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HTTPError'
  }
}

// Modalities available per plan — mirrors plan_limits table
// Used as a fast local check before hitting the DB
const PLAN_MODALITIES: Record<string, string[]> = {
  free:       ['text', 'image'],
  starter:    ['text', 'image', 'audio', 'video', 'url'],
  pro:        ['text', 'image', 'audio', 'video', 'url', 'batch'],
  enterprise: ['text', 'image', 'audio', 'video', 'url', 'batch'],
  anon:       ['text', 'image'],
}

// ── Main guard ────────────────────────────────────────────────────────────────

export async function creditGuard(
  req:      NextRequest,
  scanType: string,
): Promise<CreditGuardResult> {

  // ── Authenticated user path ──────────────────────────────────────────────
  let userId: string | null = null
  try {
    const session = await auth()
    userId = session?.userId ?? null
  } catch {
    // Clerk unavailable → fall through to anon path
  }

  if (userId) {
    const db = getSupabaseAdmin()

    // check_and_increment_scan is atomic (uses SELECT FOR UPDATE internally)
    // Safe against concurrent requests from the same user
    const { data, error } = await db.rpc('check_and_increment_scan', {
      p_user_id:    userId,
      p_media_type: scanType,
    })

    if (error) {
      // DB error — fail open (don't block user on our infrastructure error)
      console.error('[creditGuard] DB RPC error:', error.message)
      return {
        userId,
        creditsRemaining: 1,
        plan:             'free',
        dailyScans:       0,
        dailyLimit:       10,
      }
    }

    // RPC returns jsonb — Supabase client parses it into a plain object
    const result = data as {
      allowed:          boolean
      reason:           string
      plan:             string
      daily_scans:      number
      daily_limit:      number
      upgrade_required: boolean
      credits_remaining?: number
    }

    if (!result.allowed) {
      throw new HTTPError(402, buildDenyMessage(result.reason, result.plan, scanType), {
        code:             mapDenyCode(result.reason),
        plan:             result.plan,
        daily_scans:      result.daily_scans,
        daily_limit:      result.daily_limit,
        upgrade_required: true,
        upgrade_url:      '/dashboard/credits',
      })
    }

    const unlimited = result.daily_limit === -1
    return {
      userId,
      plan:             result.plan,
      dailyScans:       result.daily_scans,
      dailyLimit:       result.daily_limit,
      // Use credits_remaining from RPC response (real profile column name)
      creditsRemaining: result.credits_remaining ?? (unlimited ? 999_999 : Math.max(0, result.daily_limit - result.daily_scans)),
      unlimited,
      overage:          result.reason === 'credit_overage',
    }
  }

  // ── Anonymous user path ──────────────────────────────────────────────────

  // Anon only gets text + image
  if (!['text', 'image'].includes(scanType)) {
    throw new HTTPError(401, `Sign in to use ${scanType} detection.`, {
      code:        'AUTH_REQUIRED',
      upgrade_url: '/sign-up',
    })
  }

  // IP-based rate limit: 5 anonymous scans per day via Redis
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          ?? req.headers.get('cf-connecting-ip')
          ?? 'unknown'

  const rl = await checkRateLimit('anon_scan', ip)
  if (rl.limited) {
    throw new HTTPError(429, 'Anonymous scan limit reached. Sign in for 10 free scans per day.', {
      code:        'ANON_LIMIT_REACHED',
      upgrade_url: '/sign-up',
      reset_at:    rl.reset,
    })
  }

  return {
    userId:           `anon_${ip}`,
    plan:             'anon',
    dailyScans:       rl.current ?? 0,
    dailyLimit:       5,
    creditsRemaining: Math.max(0, 5 - (rl.current ?? 0)),
  }
}

// ── Response helpers ──────────────────────────────────────────────────────────

export function httpErrorResponse(err: HTTPError): NextResponse {
  return NextResponse.json(
    { success: false, error: { message: err.message, ...err.body } },
    { status: err.status },
  )
}

// Adds guard metadata to response headers (for debugging / client toasts)
export function injectGuardHeaders(response: NextResponse, guard: CreditGuardResult): NextResponse {
  response.headers.set('X-Credits-Remaining', String(guard.creditsRemaining))
  response.headers.set('X-Daily-Scans',       String(guard.dailyScans))
  response.headers.set('X-Plan',              guard.plan)
  if (guard.unlimited) response.headers.set('X-Plan-Unlimited', 'true')
  if (guard.overage)   response.headers.set('X-Credit-Overage', 'true')
  return response
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildDenyMessage(reason: string, plan: string, scanType: string): string {
  switch (reason) {
    case 'modality_not_included':
      return `Your ${plan} plan does not include ${scanType} detection. Upgrade to unlock all scan types.`
    case 'modality_credits_exhausted':
      return `You've used all your ${plan} credits. Purchase more to continue scanning.`
    case 'daily_limit_reached':
      return `Daily scan limit reached on your ${plan} plan. Resets at midnight PKT, or purchase more credits.`
    case 'user_not_found':
      return 'Account not found. Please sign out and sign in again.'
    default:
      return 'Scan limit reached. Upgrade your plan or purchase more credits.'
  }
}

function mapDenyCode(reason: string): string {
  const map: Record<string, string> = {
    modality_not_included:    'MODALITY_LOCKED',
    modality_credits_exhausted: 'CREDITS_EXHAUSTED',
    daily_limit_reached:      'DAILY_LIMIT_REACHED',
    user_not_found:           'USER_NOT_FOUND',
  }
  return map[reason] ?? 'LIMIT_REACHED'
}
