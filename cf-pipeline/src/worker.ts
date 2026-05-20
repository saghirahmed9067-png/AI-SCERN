/**
 * Aiscern Pipeline v8.2 — Universal Worker
 * WORKER_NUM (1–14): scraper only | WORKER_NUM 20: HF push + cleanup (only pusher)
 *
 * Security changes (v8.2):
 *   - /trigger/* endpoints require Authorization: Bearer <PIPELINE_SECRET>
 *   - CORS restricted to configured origins; wildcard "*" removed
 *   - /status and /health remain unauthenticated (read-only, no side effects)
 */
import {
  Env, ALL_SOURCES, getWorkerSources,
  scrapeSource, scrapeParallel, pushToHF, pushReadme, cleanupPushed, getStatus,
} from './core'

import { log } from './types'

// ── CORS helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the Access-Control-Allow-Origin header value for a given request.
 * Only origins explicitly listed in ALLOWED_ORIGINS are reflected back.
 * Falls back to the primary production domain if the env var is not set.
 */
function getAllowedOrigin(req: Request, env: Env): string {
  const requestOrigin = req.headers.get('Origin') ?? ''
  const allowedList = (env.ALLOWED_ORIGINS ?? 'https://aiscern.com')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)

  if (allowedList.includes(requestOrigin)) return requestOrigin

  // For same-origin requests (no Origin header), allow without CORS header
  return allowedList[0] // default to first listed origin for non-matching browsers
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  getAllowedOrigin(req, env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary':                         'Origin',
    'Content-Type':                 'application/json',
  }
}

// ── Authentication helper ─────────────────────────────────────────────────────

/**
 * Verifies the Authorization: Bearer <PIPELINE_SECRET> header.
 * All /trigger/* endpoints MUST call this.
 */
function authenticateTrigger(req: Request, env: Env): boolean {
  if (!env.PIPELINE_SECRET) {
    // No secret configured — deny all trigger requests to fail safe
    console.error('[worker] PIPELINE_SECRET is not set — all trigger requests denied')
    return false
  }
  const authHeader = req.headers.get('Authorization') ?? ''
  const match      = authHeader.match(/^Bearer\s+(.+)$/)
  if (!match) return false

  // Constant-time string comparison to prevent timing attacks
  const provided = match[1]
  const expected = env.PIPELINE_SECRET
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

// ── Worker ────────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url  = new URL(req.url)
    const wnum = parseInt(env.WORKER_NUM ?? '1')
    const wid  = `worker-${wnum}`
    const cors = corsHeaders(req, env)

    // Handle CORS pre-flight for all routes
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // ── /status — public, read-only ───────────────────────────────────────────
    if (url.pathname === '/status') {
      return Response.json(await getStatus(env.DB), { headers: cors })
    }

    // ── /health — public, read-only ───────────────────────────────────────────
    if (url.pathname === '/health') {
      const sources = wnum <= 14 ? getWorkerSources(wnum) : []
      return Response.json({
        ok:               true,
        version:          'v8.2',
        worker:           wid,
        role:             wnum === 20 ? 'hf-push + cleanup (exclusive)' : 'scraper-only',
        pipeline_enabled: env.PIPELINE_ENABLED !== 'false',
        sources:          sources.map(s => `${s.name} [${s.media_type}/${s.label}]`),
        ts:               new Date().toISOString(),
      }, { headers: cors })
    }

    // ── /trigger/* — authenticated POST endpoints ─────────────────────────────
    // All trigger routes require a valid PIPELINE_SECRET bearer token.
    if (url.pathname.startsWith('/trigger/')) {
      if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
      }

      if (!authenticateTrigger(req, env)) {
        return Response.json({ error: 'Unauthorized — valid Authorization: Bearer <PIPELINE_SECRET> header required' },
          { status: 401, headers: cors })
      }

      if (url.pathname === '/trigger/scrape') {
        if (env.PIPELINE_ENABLED === 'false') {
          return Response.json({ error: 'kill switch active' }, { status: 503, headers: cors })
        }
        if (wnum === 20) {
          return Response.json({ error: 'worker 20 is push-only' }, { status: 400, headers: cors })
        }
        const sources = getWorkerSources(wnum)
        const src     = sources[Math.floor(Math.random() * sources.length)]
        const result  = await scrapeSource(env.DB, src, env.HF_TOKEN, wid, 60)
        return Response.json({ ok: true, worker: wid, result }, { headers: cors })
      }

      if (url.pathname === '/trigger/push') {
        const result = await pushToHF(env.DB, env.HF_TOKEN, env, 5000, wid)
        return Response.json({ ok: true, worker: wid, push: result }, { headers: cors })
      }

      if (url.pathname === '/trigger/cleanup') {
        const deleted = await cleanupPushed(env.DB)
        return Response.json({ ok: true, worker: wid, deleted }, { headers: cors })
      }
    }

    // ── Default response ──────────────────────────────────────────────────────
    const sources = wnum <= 14 ? getWorkerSources(wnum) : []
    return Response.json({
      worker:            wid,
      version:           'v8.2',
      role:              wnum === 20 ? 'hf-push + cleanup (exclusive)' : 'scraper-only',
      hf_structure:      'data/{media_type}/{language}/part-NNNN.jsonl',
      sources:           sources.map(s => `${s.name} [${s.media_type}]`),
      all_sources_total: ALL_SOURCES.length,
    }, { headers: cors })
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (env.PIPELINE_ENABLED === 'false') {
      const wid = `worker-${env.WORKER_NUM ?? '1'}`
      log({ event: 'KILL_SWITCH', worker_id: wid, timestamp: new Date().toISOString() })
      return
    }

    const wnum = parseInt(env.WORKER_NUM ?? '1')
    const wid  = `worker-${wnum}`
    const tick = Math.floor(Date.now() / 60_000)

    // ── W20: push + cleanup ONLY ──────────────────────────────────────────────
    if (wnum === 20) {
      const push = await pushToHF(env.DB, env.HF_TOKEN, env, 5000, wid)
      if (push.pushed > 0) {
        console.log(`[W20] pushed ${push.pushed} → commit ${push.commitId} | files: ${push.files?.join(', ')}`)
      } else if ((push as any).skipped === 'push_locked') {
        console.log('[W20] push skipped — another worker holds the lock (should not happen)')
      } else if (push.error) {
        console.error(`[W20] push ERROR: ${push.error}`)
      } else {
        console.log('[W20] nothing pending to push')
      }

      if (tick % 50 === 0) {
        await pushReadme(env.DB, env.HF_TOKEN, env)
        console.log('[W20] README updated')
      }
      if (tick % 100 === 0) {
        const deleted = await cleanupPushed(env.DB)
        if (deleted > 0) console.log(`[W20] cleanup: removed ${deleted} orphaned records`)
      }
      return
    }

    // ── W1–W14: scrape ONLY ───────────────────────────────────────────────────
    const sources = getWorkerSources(wnum)
    if (!sources.length) return

    const results  = await scrapeParallel(env.DB, sources, env.HF_TOKEN, wid, wnum)
    const totalIns = results.reduce((s, r) => s + r.inserted, 0)
    const errors   = results.filter(r => r.error).map(r => `${r.source}: ${r.error}`).join('; ')

    console.log(`[W${wnum}] tick=${tick} sources=${results.length} inserted=${totalIns}${errors ? ` ERRORS: ${errors}` : ''}`)
  },
}
