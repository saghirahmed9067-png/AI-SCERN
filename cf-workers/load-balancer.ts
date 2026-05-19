/**
 * Aiscern — Cloudflare Worker Load Balancer v3.0
 *
 * Route Strategy:
 *  ┌─────────────────────────────────────┬──────────────────────────────────┐
 *  │ Pattern                             │ Origin                           │
 *  ├─────────────────────────────────────┼──────────────────────────────────┤
 *  │ /api/detect/*, /api/v2/forensic-*   │ Netlify (26s Pro timeout)        │
 *  │ /api/auth/*, /api/admin/*           │ Vercel  (Clerk session affinity) │
 *  │ /api/webhook/*                      │ Vercel  (fast HMAC verify)       │
 *  │ All other /api/*                    │ Vercel  (primary)                │
 *  │ /_next/static/*, /fonts/*           │ KV edge cache (immutable assets) │
 *  │ /* (pages)                          │ weighted round-robin all 3       │
 *  └─────────────────────────────────────┴──────────────────────────────────┘
 *
 * Deploy:  wrangler deploy --config wrangler-lb.toml
 * Monitor: GET /lb-status  (requires X-LB-Secret header)
 * Health:  GET /lb-health  (public)
 */

interface Env {
  HEALTH_KV:    KVNamespace
  VERCEL_URL:   string   // https://aiscern.vercel.app
  NETLIFY_URL:  string   // https://aiscern.netlify.app
  CF_PAGES_URL: string   // https://aiscern.pages.dev
  LB_SECRET:    string   // wrangler secret put LB_SECRET
}

interface OriginConfig {
  name:      string
  url:       string
  weight:    number
  healthy:   boolean
  failCount: number
  lastCheck: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEALTH_TTL_MS  = 30_000  // re-probe every 30s via waitUntil
const MAX_FAIL_COUNT = 3       // mark unhealthy after 3 consecutive misses
const KV_ORIGINS_KEY = 'origins:v3'

/** Routes needing Netlify's 26-second Pro function timeout */
const NETLIFY_ROUTES: string[] = [
  '/api/detect/',
  '/api/v2/forensic-scan',
  '/api/forensic/',
  '/api/inference/',
]

/** Routes that must stay on Vercel (Clerk sessions, admin, billing) */
const VERCEL_ONLY_ROUTES: string[] = [
  '/api/auth/',
  '/api/admin/',
  '/api/user/',
  '/api/billing/',
  '/api/credits/',
  '/api/profiles/',
  '/api/inngest',
  '/api/webhook/',
]

/** Static asset prefixes cached at edge */
const STATIC_PREFIXES: string[] = [
  '/_next/static/',
  '/fonts/',
  '/favicon',
]

// ── Origin helpers ────────────────────────────────────────────────────────────

function defaultOrigins(env: Env): OriginConfig[] {
  return [
    { name: 'vercel',   url: env.VERCEL_URL,   weight: 4, healthy: true, failCount: 0, lastCheck: 0 },
    { name: 'netlify',  url: env.NETLIFY_URL,  weight: 3, healthy: true, failCount: 0, lastCheck: 0 },
    { name: 'cf-pages', url: env.CF_PAGES_URL, weight: 2, healthy: true, failCount: 0, lastCheck: 0 },
  ]
}

async function getOrigins(env: Env): Promise<OriginConfig[]> {
  try {
    const cached = await env.HEALTH_KV.get(KV_ORIGINS_KEY, 'json') as OriginConfig[] | null
    if (cached?.length) return cached
  } catch { /* KV miss */ }
  return defaultOrigins(env)
}

async function saveOrigins(env: Env, origins: OriginConfig[]): Promise<void> {
  try {
    await env.HEALTH_KV.put(KV_ORIGINS_KEY, JSON.stringify(origins), { expirationTtl: 300 })
  } catch { /* non-fatal */ }
}

async function probeHealth(origin: OriginConfig): Promise<boolean> {
  try {
    const res = await fetch(`${origin.url}/api/health`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok || res.status === 405
  } catch { return false }
}

// ── Route classification ──────────────────────────────────────────────────────

type RouteTarget = 'netlify' | 'vercel' | 'static' | 'page'

function classifyRoute(pathname: string): RouteTarget {
  if (STATIC_PREFIXES.some(p => pathname.startsWith(p))) return 'static'
  if (NETLIFY_ROUTES.some(p => pathname.startsWith(p)))   return 'netlify'
  if (VERCEL_ONLY_ROUTES.some(p => pathname.startsWith(p))) return 'vercel'
  if (pathname.startsWith('/api/')) return 'vercel'
  return 'page'
}

// ── Origin selection ──────────────────────────────────────────────────────────

function pickOrigin(origins: OriginConfig[], target: RouteTarget, request: Request): OriginConfig {
  const named   = (n: string) => origins.find(o => o.name === n && o.healthy)
  const healthy = origins.filter(o => o.healthy)

  switch (target) {
    case 'netlify':
      // Long-timeout detect routes → Netlify Pro; fallback to Vercel if Netlify is down
      return named('netlify') ?? named('vercel') ?? origins[0]

    case 'vercel':
      // Auth/admin/billing → Vercel; fallback CF Pages (not Netlify — free has 10s limit)
      return named('vercel') ?? named('cf-pages') ?? origins[0]

    case 'static':
    case 'page': {
      // Geographic preference: non-PK/US users get CF Pages edge for lower latency
      const cf      = (request as unknown as { cf?: { country?: string; connectingIp?: string } }).cf
      const country = cf?.country
      const isRemote = country && country !== 'PK' && country !== 'US'
      if (isRemote) return named('cf-pages') ?? named('vercel') ?? origins[0]

      // Sticky hash for PK/US users (consistent origin per IP)
      const pool     = healthy.length > 0 ? healthy : origins
      const weighted = pool.flatMap(o => Array(o.weight).fill(o))
      const ip       = cf?.connectingIp ?? request.headers.get('CF-Connecting-IP') ?? 'unknown'
      const hash     = [...ip].reduce((a, c) => a + c.charCodeAt(0), 0)
      return weighted[hash % weighted.length]
    }

    default:
      return healthy[0] ?? origins[0]
  }
}

// ── Proxy ─────────────────────────────────────────────────────────────────────

async function proxyTo(request: Request, origin: OriginConfig): Promise<Response> {
  const url    = new URL(request.url)
  const target = `${origin.url}${url.pathname}${url.search}`
  const hdrs   = new Headers(request.headers)
  hdrs.set('X-Forwarded-Host', url.hostname)
  hdrs.set('X-Origin-Name',    origin.name)
  hdrs.set('X-LB-Version',     '3.0')
  const body = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : request.body
  return fetch(target, { method: request.method, headers: hdrs, body, duplex: 'half' } as RequestInit)
}

// ── Static asset KV cache ─────────────────────────────────────────────────────

async function fromCache(url: URL, env: Env): Promise<Response | null> {
  try {
    const hit = await env.HEALTH_KV.getWithMetadata(`static:${url.pathname}`, 'arrayBuffer')
    if (hit.value) {
      const ct = (hit.metadata as Record<string, string> | null)?.ct ?? 'application/octet-stream'
      return new Response(hit.value, {
        headers: {
          'Content-Type':  ct,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Cache':       'HIT',
        },
      })
    }
  } catch { /* miss */ }
  return null
}

function cacheStatic(url: URL, response: Response, env: Env, ctx: ExecutionContext): Promise<Response> {
  const ct  = response.headers.get('Content-Type') ?? 'application/octet-stream'
  return response.arrayBuffer().then(buf => {
    ctx.waitUntil(
      env.HEALTH_KV.put(`static:${url.pathname}`, buf.slice(0), {
        expirationTtl: 86_400,   // 24h
        metadata: { ct },
      }),
    )
    return new Response(buf, {
      headers: {
        'Content-Type':  ct,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Cache':       'MISS',
      },
    })
  })
}

// ── Security headers ──────────────────────────────────────────────────────────

function withSecurity(res: Response): Response {
  const h = new Headers(res.headers)
  h.set('X-Frame-Options',           'DENY')
  h.set('X-Content-Type-Options',    'nosniff')
  h.set('Referrer-Policy',           'strict-origin-when-cross-origin')
  h.set('Permissions-Policy',        'camera=(), microphone=(), geolocation=()')
  h.set('X-LB-Version',              '3.0')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
}

// ── Main fetch ────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Internal status endpoints
    if (url.pathname === '/lb-health') {
      return Response.json({ status: 'ok', version: '3.0', ts: Date.now() })
    }
    if (url.pathname === '/lb-status') {
      if (request.headers.get('X-LB-Secret') !== env.LB_SECRET) {
        return new Response('Unauthorized', { status: 401 })
      }
      return Response.json({ origins: await getOrigins(env), ts: new Date().toISOString() })
    }

    const origins = await getOrigins(env)

    // Background health probe — runs after response is returned
    ctx.waitUntil((async () => {
      let dirty = false
      for (const o of origins) {
        if (Date.now() - o.lastCheck < HEALTH_TTL_MS) continue
        const ok    = await probeHealth(o)
        o.lastCheck = Date.now()
        if (ok) { o.failCount = 0; o.healthy = true }
        else    { o.failCount++; o.healthy = o.failCount < MAX_FAIL_COUNT }
        dirty = true
      }
      if (dirty) await saveOrigins(env, origins)
    })())

    const target = classifyRoute(url.pathname)

    // ── Static fast path ────────────────────────────────────────────────────
    if (target === 'static') {
      const hit = await fromCache(url, env)
      if (hit) return hit
      const o = pickOrigin(origins, 'static', request)
      try {
        const res = await proxyTo(request, o)
        return res.ok ? cacheStatic(url, res, env, ctx) : res
      } catch {
        return new Response('Static asset unavailable', { status: 503 })
      }
    }

    // ── API / page proxy ────────────────────────────────────────────────────
    const origin = pickOrigin(origins, target, request)

    try {
      const res = await proxyTo(request, origin)

      if (res.status >= 500) {
        origin.failCount++
        if (origin.failCount >= MAX_FAIL_COUNT) origin.healthy = false
        ctx.waitUntil(saveOrigins(env, origins))
      } else if (origin.failCount > 0) {
        origin.failCount = 0; origin.healthy = true
        ctx.waitUntil(saveOrigins(env, origins))
      }

      return withSecurity(res)

    } catch {
      origin.failCount++
      origin.healthy = origin.failCount < MAX_FAIL_COUNT
      ctx.waitUntil(saveOrigins(env, origins))

      // Single fallback attempt for API routes
      if (target !== 'page') {
        const fallbackName = target === 'netlify' ? 'vercel' : 'cf-pages'
        const fallback     = origins.find(o => o.name === fallbackName && o.healthy)
        if (fallback) {
          try { return withSecurity(await proxyTo(request, fallback)) } catch { /* fall through */ }
        }
        return new Response(
          JSON.stringify({ error: 'Service temporarily unavailable', retry_after: 30 }),
          { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } },
        )
      }

      // Page: try all remaining healthy origins
      for (const fb of origins.filter(o => o.healthy && o.name !== origin.name)) {
        try { return withSecurity(await proxyTo(request, fb)) } catch { /* next */ }
      }
      return new Response('Service unavailable', { status: 503 })
    }
  },
}
