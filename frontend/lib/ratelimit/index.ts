/**
 * Aiscern — Distributed Rate Limiting via Upstash Redis
 *
 * Replaces the broken in-memory Map (resets on every Vercel cold start).
 * Falls back to in-memory if Redis env vars are not configured.
 *
 * Required env vars:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis }     from '@upstash/redis'

// ── In-memory fallback ────────────────────────────────────────────────────────
const _localMap = new Map<string, { count: number; resetAt: number }>()

function localCheckRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const e   = _localMap.get(key)
  if (!e || now > e.resetAt) { _localMap.set(key, { count: 1, resetAt: now + windowMs }); return true }
  if (e.count >= limit) return false
  e.count++
  return true
}

// ── Redis client singleton ────────────────────────────────────────────────────
let _redis: Redis | null = null

function getRedis(): Redis | null {
  if (_redis) return _redis
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try { _redis = new Redis({ url, token }); return _redis }
  catch { return null }
}

// ── Rate limiter config ───────────────────────────────────────────────────────
type LimiterKey = 'text' | 'image' | 'audio' | 'video' | 'scraper' | 'upload' | 'batch' | 'anon_scan' | 'chat' | 'admin' | 'credit_purchase'

const LIMITS: Record<LimiterKey, { requests: number; window: `${number} ${'s' | 'm' | 'h'}` }> = {
  text:    { requests: 30, window: '1 m' },
  image:   { requests: 20, window: '1 m' },
  audio:   { requests: 15, window: '1 m' },
  video:   { requests: 10, window: '1 m' },
  scraper: { requests:  5, window: '1 m' },
  upload:  { requests: 30, window: '1 m' },
  batch:     { requests:  3, window: '1 m' },
  anon_scan: { requests:  5, window: '24 h' },
  chat:      { requests: 20, window: '1 m' },
  credit_purchase: { requests: 10, window: '1 h' },
  admin:     { requests: 10, window: '1 m' },
}

const _limiters = new Map<LimiterKey, Ratelimit>()

function getLimiter(key: LimiterKey): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null
  if (_limiters.has(key)) return _limiters.get(key)!
  const cfg = LIMITS[key]
  const rl  = new Ratelimit({
    redis,
    limiter:   Ratelimit.slidingWindow(cfg.requests, cfg.window),
    prefix:    `rl:aiscern:${key}`,
    analytics: false,
  })
  _limiters.set(key, rl)
  return rl
}

// ── Public API ────────────────────────────────────────────────────────────────
export interface RateLimitResult {
  success:   boolean
  remaining: number
  reset:     number
  limited:   boolean
  // Number of requests used in the current window (0..requests)
  current:   number
}

export async function checkRateLimit(
  type:       LimiterKey,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = getLimiter(type)

  if (limiter) {
    try {
      const result = await limiter.limit(identifier)
      const cfg = LIMITS[type]
      const current = cfg.requests - (result.remaining ?? 0)
      return {
        success:   result.success,
        remaining: result.remaining,
        reset:     result.reset,
        limited:   !result.success,
        current:   current,
      }
    } catch {
      console.warn('[ratelimit] Redis error, failing open for', type, identifier)
    }
  }

  // Fallback to in-memory
  const cfg      = LIMITS[type]
  const parts    = cfg.window.split(' ')
  const num      = parseInt(parts[0])
  const unit     = parts[1]
  const windowMs = num * (unit === 'h' ? 3600000 : unit === 'm' ? 60000 : 1000)
  const allowed  = localCheckRateLimit(`${type}:${identifier}`, cfg.requests, windowMs)
  const mapEntry = _localMap.get(`${type}:${identifier}`)
  const current = mapEntry?.count ?? (allowed ? 1 : cfg.requests)
  return {
    success:   allowed,
    remaining: allowed ? Math.max(0, cfg.requests - current) : 0,
    reset:     Date.now() + windowMs,
    limited:   !allowed,
    current,
  }
}

export function rateLimitResponse() {
  return {
    success: false,
    error:   { code: 'RATE_LIMIT', message: 'Too many requests. Please wait and try again.' },
  }
}
