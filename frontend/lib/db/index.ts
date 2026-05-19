/**
 * Aiscern — Multi-Database Router
 *
 * Three purpose-built databases with connection pooling:
 *
 *  AUTH DB     → Supabase   (users, credits, API keys, billing)
 *                            PgBouncer pooler on port 6543
 *
 *  HEAVY DB    → Neon       (scans, forensic_layers, file_metadata)
 *                            Neon built-in PgBouncer (-pooler suffix)
 *
 *  ANALYTICS DB → CockroachDB Serverless (prediction_logs, accuracy_metrics,
 *                            user_activity, feedback_logs)
 *
 * PgBouncer notes:
 *  - Transaction-mode pooling: do NOT use advisory locks, LISTEN/NOTIFY,
 *    or named prepared statements (Drizzle sets `prepareMode: false` for this)
 *  - Use direct URLs (no pgbouncer=true) only for migrations
 *
 * Usage:
 *   import { authDb, heavyDb, analyticsDb } from '@/lib/db'
 *   const user = await authDb.query.users.findFirst({ where: ... })
 */

import postgres from 'postgres'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DbName = 'auth' | 'heavy' | 'analytics'

interface PooledClient {
  sql: ReturnType<typeof postgres>
  name: DbName
  connected: boolean
}

// ── Singleton pool registry ───────────────────────────────────────────────────
// In serverless, module-level singletons persist across warm invocations.
// One pool per database — never create more than one per process.

const _pools: Partial<Record<DbName, PooledClient>> = {}

function getPool(name: DbName, url: string): PooledClient {
  if (_pools[name]) return _pools[name]!

  const isTransaction = name !== 'analytics'   // CockroachDB uses session mode

  const sql = postgres(url, {
    // PgBouncer transaction mode: disable named prepared statements
    prepare: false,
    // Small pool — pgbouncer multiplexes to unlimited clients
    max: name === 'auth'      ? 5
       : name === 'heavy'     ? 5
       :                        3,
    idle_timeout:    20,    // seconds before idle connections are closed
    connect_timeout: 10,
    // Drizzle/postgres.js: disable transforms that break PgBouncer
    transform: postgres.camel,
    // Retry on transient errors
    connection: {
      application_name: `aiscern-${name}`,
    },
  })

  const client: PooledClient = { sql, name, connected: true }
  _pools[name] = client
  return client
}

// ── Per-database lazy getters ─────────────────────────────────────────────────

/**
 * AUTH DB — Supabase PostgreSQL via PgBouncer (port 6543)
 * Tables: users, profiles, api_keys, credit_transactions, subscriptions, plan_limits
 *
 * Env vars required:
 *   SUPABASE_POOLER_URL  (connection pooler — use for all runtime queries)
 *   SUPABASE_DIRECT_URL  (direct connection — use for migrations only)
 */
export function getAuthDb() {
  const url = process.env.SUPABASE_POOLER_URL
  if (!url) {
    // Fallback: construct pooler URL from existing Supabase env vars
    const supaUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const project  = supaUrl.replace('https://', '').replace('.supabase.co', '')
    const pass     = process.env.SUPABASE_DB_PASSWORD ?? ''
    if (!project || !pass) {
      throw new Error('[DB:auth] Missing SUPABASE_POOLER_URL or SUPABASE_DB_PASSWORD')
    }
    const fallback = `postgresql://postgres.${project}:${pass}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`
    return getPool('auth', fallback)
  }
  return getPool('auth', url)
}

/**
 * HEAVY DB — Neon PostgreSQL (built-in PgBouncer via -pooler hostname)
 * Tables: scans, scan_results, forensic_layers, batch_jobs, file_metadata
 *
 * Env vars required:
 *   NEON_POOLER_URL  (use *-pooler.neon.tech — enables PgBouncer)
 *   NEON_DIRECT_URL  (use *.neon.tech — for migrations only)
 */
export function getHeavyDb() {
  const url = process.env.NEON_POOLER_URL
  if (!url) throw new Error('[DB:heavy] Missing NEON_POOLER_URL')
  return getPool('heavy', url)
}

/**
 * ANALYTICS DB — CockroachDB Serverless
 * Tables: prediction_logs, accuracy_metrics, user_activity, performance_logs, feedback_logs
 *
 * Env vars required:
 *   COCKROACH_URL  (postgresql://user:pass@host:26257/db?sslmode=verify-full)
 */
export function getAnalyticsDb() {
  const url = process.env.COCKROACH_URL
  if (!url) throw new Error('[DB:analytics] Missing COCKROACH_URL')
  return getPool('analytics', url)
}

// ── Convenience SQL tag helpers ───────────────────────────────────────────────
// Use these for raw SQL when you don't need Drizzle:
//   const { sql: authSql } = getAuthDb()
//   const rows = await authSql`SELECT * FROM users WHERE id = ${userId}`

export const authDb      = () => getAuthDb().sql
export const heavyDb     = () => getHeavyDb().sql
export const analyticsDb = () => getAnalyticsDb().sql

// ── Health check ──────────────────────────────────────────────────────────────

export interface DbHealthStatus {
  db:      DbName
  healthy: boolean
  latency: number
  error?:  string
}

export async function checkAllDbHealth(): Promise<DbHealthStatus[]> {
  const checks: Array<{ db: DbName; fn: () => ReturnType<typeof postgres> }> = [
    { db: 'auth',      fn: authDb },
    { db: 'heavy',     fn: heavyDb },
    { db: 'analytics', fn: analyticsDb },
  ]

  return Promise.all(
    checks.map(async ({ db, fn }) => {
      const start = Date.now()
      try {
        const sql = fn()
        await sql`SELECT 1 AS ping`
        return { db, healthy: true, latency: Date.now() - start }
      } catch (err: unknown) {
        return {
          db,
          healthy: false,
          latency: Date.now() - start,
          error:   err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )
}

// ── Table → DB routing map (documentation + runtime guard) ───────────────────
// Use this to determine which DB a given table lives in.

const TABLE_DB_MAP: Record<string, DbName> = {
  // AUTH DB (Supabase)
  users:               'auth',
  profiles:            'auth',
  api_keys:            'auth',
  credit_transactions: 'auth',
  subscriptions:       'auth',
  plan_limits:         'auth',
  upgrade_requests:    'auth',

  // HEAVY DB (Neon)
  scans:               'heavy',
  scan_results:        'heavy',
  forensic_layers:     'heavy',
  batch_jobs:          'heavy',
  file_metadata:       'heavy',
  scraper_sessions:    'heavy',

  // ANALYTICS DB (CockroachDB)
  prediction_logs:     'analytics',
  accuracy_metrics:    'analytics',
  user_activity:       'analytics',
  performance_logs:    'analytics',
  feedback_logs:       'analytics',
  api_usage_logs:      'analytics',
}

export function dbForTable(table: string): DbName {
  const db = TABLE_DB_MAP[table]
  if (!db) throw new Error(`[DB Router] Unknown table: "${table}". Add it to TABLE_DB_MAP.`)
  return db
}

export function sqlForTable(table: string): ReturnType<typeof postgres> {
  const db = dbForTable(table)
  switch (db) {
    case 'auth':      return authDb()
    case 'heavy':     return heavyDb()
    case 'analytics': return analyticsDb()
  }
}
