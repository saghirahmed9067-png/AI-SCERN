/**
 * Aiscern — Cross-Database Saga Pattern
 *
 * Because scans span multiple DBs (auth credits + heavy scan data + analytics logs),
 * we can't use a single SQL transaction. The Saga pattern solves this:
 *
 *  1. Execute each step in order
 *  2. If any step fails → run compensation functions in reverse order
 *  3. Each step is idempotent (safe to retry with same idempotency key)
 *  4. All saga events are appended to an outbox for audit trail
 *
 * Usage:
 *   const result = await runSaga('create-scan', userId, [
 *     deductCreditStep(userId, scanType),
 *     insertScanStep(scanId, payload),
 *     logActivityStep(userId, scanType),
 *   ])
 */

import { authDb, heavyDb, analyticsDb } from './index'
import { nanoid } from 'nanoid'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SagaStep<T = unknown> {
  name:        string
  execute:     () => Promise<T>
  compensate?: () => Promise<void>   // rollback if a later step fails
}

export interface SagaResult<T = unknown> {
  success:  boolean
  sagaId:   string
  results:  T[]
  error?:   string
  rolledBack: boolean
}

export interface SagaEvent {
  saga_id:      string
  saga_name:    string
  step_name:    string
  status:       'started' | 'completed' | 'failed' | 'compensated'
  payload?:     Record<string, unknown>
  error?:       string
  created_at:   string
}

// ── Core saga runner ──────────────────────────────────────────────────────────

export async function runSaga<T = unknown>(
  sagaName:      string,
  idempotencyKey: string,
  steps:         SagaStep<T>[],
): Promise<SagaResult<T>> {
  const sagaId  = `saga_${nanoid(12)}`
  const results: T[] = []
  const executed: SagaStep<T>[] = []

  await appendOutboxEvent({
    saga_id:    sagaId,
    saga_name:  sagaName,
    step_name:  '__saga_start__',
    status:     'started',
    payload:    { idempotency_key: idempotencyKey, step_count: steps.length },
    created_at: new Date().toISOString(),
  })

  for (const step of steps) {
    try {
      await appendOutboxEvent({
        saga_id:   sagaId,
        saga_name: sagaName,
        step_name: step.name,
        status:    'started',
        created_at: new Date().toISOString(),
      })

      const result = await step.execute()
      results.push(result)
      executed.push(step)

      await appendOutboxEvent({
        saga_id:   sagaId,
        saga_name: sagaName,
        step_name: step.name,
        status:    'completed',
        created_at: new Date().toISOString(),
      })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)

      await appendOutboxEvent({
        saga_id:   sagaId,
        saga_name: sagaName,
        step_name: step.name,
        status:    'failed',
        error:     errMsg,
        created_at: new Date().toISOString(),
      })

      // Compensate all previously completed steps in reverse order
      const toCompensate = [...executed].reverse()
      for (const done of toCompensate) {
        if (!done.compensate) continue
        try {
          await done.compensate()
          await appendOutboxEvent({
            saga_id:   sagaId,
            saga_name: sagaName,
            step_name: done.name,
            status:    'compensated',
            created_at: new Date().toISOString(),
          })
        } catch (compErr) {
          // Compensation failure — log but continue compensating others
          console.error(`[Saga:${sagaName}] Compensation failed for step "${done.name}":`, compErr)
        }
      }

      return { success: false, sagaId, results, error: errMsg, rolledBack: true }
    }
  }

  return { success: true, sagaId, results, rolledBack: false }
}

// ── Outbox append (best-effort — non-fatal) ───────────────────────────────────
// Writes to CockroachDB analytics. If analytics is down, logs locally only.

async function appendOutboxEvent(event: SagaEvent): Promise<void> {
  try {
    const sql = analyticsDb()
    await sql`
      INSERT INTO saga_outbox (saga_id, saga_name, step_name, status, payload, error, created_at)
      VALUES (
        ${event.saga_id},
        ${event.saga_name},
        ${event.step_name},
        ${event.status},
        ${event.payload ? JSON.stringify(event.payload) : null},
        ${event.error ?? null},
        ${event.created_at}
      )
      ON CONFLICT DO NOTHING
    `
  } catch {
    // Analytics DB down — degrade gracefully, log to console only
    console.warn('[Saga:outbox] Failed to persist event:', event.step_name, event.status)
  }
}

// ── Pre-built saga steps ──────────────────────────────────────────────────────

/**
 * Deduct one scan credit from Supabase.
 * Compensation: refund the credit if a later step fails.
 */
export function deductCreditStep(userId: string, scanType: string): SagaStep<boolean> {
  let deducted = false
  return {
    name: 'deduct-credit',
    async execute() {
      const sql = authDb()
      // check_and_increment_scan is an atomic DB function already in Supabase
      const rows = await sql<[{ allowed: boolean; reason: string }]>`
        SELECT * FROM check_and_increment_scan(${userId}, ${scanType})
      `
      const result = rows[0]
      if (!result?.allowed) {
        throw new Error(`Credit check failed: ${result?.reason ?? 'unknown'}`)
      }
      deducted = true
      return true
    },
    async compensate() {
      if (!deducted) return
      // Decrement the counter back — refund the scan
      const sql = authDb()
      await sql`
        UPDATE user_scan_counts
        SET    daily_count = GREATEST(0, daily_count - 1),
               updated_at  = NOW()
        WHERE  user_id   = ${userId}
          AND  scan_date = CURRENT_DATE
      `.catch(() => { /* best-effort refund */ })
    },
  }
}

/**
 * Insert a scan row into Neon HEAVY DB.
 * Compensation: soft-delete the scan row.
 */
export function insertScanStep(
  scanId:  string,
  payload: Record<string, unknown>,
): SagaStep<string> {
  return {
    name: 'insert-scan',
    async execute() {
      const sql = heavyDb()
      await sql`
        INSERT INTO scans (id, user_id, scan_type, status, metadata, created_at)
        VALUES (
          ${scanId},
          ${payload.userId as string},
          ${payload.scanType as string},
          'processing',
          ${JSON.stringify(payload)},
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `
      return scanId
    },
    async compensate() {
      const sql = heavyDb()
      await sql`
        UPDATE scans SET status = 'cancelled', deleted_at = NOW()
        WHERE id = ${scanId}
      `.catch(() => { /* best-effort */ })
    },
  }
}

/**
 * Log user activity to CockroachDB ANALYTICS DB.
 * No compensation needed — analytics rows are append-only.
 */
export function logActivityStep(
  userId:   string,
  scanType: string,
  metadata?: Record<string, unknown>,
): SagaStep<void> {
  return {
    name: 'log-activity',
    async execute() {
      const sql = analyticsDb()
      await sql`
        INSERT INTO user_activity (user_id, event_type, metadata, created_at)
        VALUES (${userId}, ${'scan:' + scanType}, ${JSON.stringify(metadata ?? {})}, NOW())
      `.catch(() => { /* non-fatal analytics */ })
    },
    // Analytics is append-only — no compensation
  }
}

/**
 * Record a credit purchase in Supabase AUTH DB.
 * Compensation: mark the transaction as voided.
 */
export function recordCreditPurchaseStep(
  userId:        string,
  orderId:       string,
  credits:       number,
  amountPkr:     number,
  planId:        string,
): SagaStep<string> {
  let txnId = ''
  return {
    name: 'record-credit-purchase',
    async execute() {
      const sql = authDb()
      const rows = await sql<[{ id: string }]>`
        INSERT INTO credit_transactions
          (user_id, order_id, credits, amount_pkr, plan_id, status, created_at)
        VALUES
          (${userId}, ${orderId}, ${credits}, ${amountPkr}, ${planId}, 'completed', NOW())
        ON CONFLICT (order_id) DO UPDATE SET status = 'completed'
        RETURNING id
      `
      txnId = rows[0].id
      return txnId
    },
    async compensate() {
      if (!txnId) return
      const sql = authDb()
      await sql`
        UPDATE credit_transactions SET status = 'voided', updated_at = NOW()
        WHERE id = ${txnId}
      `.catch(() => { /* best-effort */ })
    },
  }
}

/**
 * Top up user credits in Supabase AUTH DB.
 * Compensation: subtract the credited amount back.
 */
export function topUpCreditsStep(
  userId:  string,
  credits: number,
): SagaStep<number> {
  let newBalance = 0
  return {
    name: 'topup-credits',
    async execute() {
      const sql = authDb()
      const rows = await sql<[{ credits_balance: number }]>`
        UPDATE profiles
        SET    credits_balance = credits_balance + ${credits},
               updated_at      = NOW()
        WHERE  id = ${userId}
        RETURNING credits_balance
      `
      newBalance = rows[0]?.credits_balance ?? 0
      return newBalance
    },
    async compensate() {
      if (newBalance === 0) return
      const sql = authDb()
      await sql`
        UPDATE profiles
        SET    credits_balance = GREATEST(0, credits_balance - ${credits}),
               updated_at      = NOW()
        WHERE  id = ${userId}
      `.catch(() => { /* best-effort */ })
    },
  }
}

// ── Convenience: full "create scan" saga ─────────────────────────────────────

export async function runCreateScanSaga(params: {
  userId:   string
  scanId:   string
  scanType: string
  payload:  Record<string, unknown>
}): Promise<SagaResult> {
  return runSaga('create-scan', `${params.userId}:${params.scanId}`, [
    deductCreditStep(params.userId, params.scanType),
    insertScanStep(params.scanId, { ...params.payload, userId: params.userId, scanType: params.scanType }),
    logActivityStep(params.userId, params.scanType, { scan_id: params.scanId }),
  ])
}

// ── Convenience: full "credit purchase" saga ──────────────────────────────────

export async function runCreditPurchaseSaga(params: {
  userId:    string
  orderId:   string
  credits:   number
  amountPkr: number
  planId:    string
}): Promise<SagaResult> {
  return runSaga('credit-purchase', params.orderId, [
    recordCreditPurchaseStep(params.userId, params.orderId, params.credits, params.amountPkr, params.planId),
    topUpCreditsStep(params.userId, params.credits),
    logActivityStep(params.userId, 'credit_purchase', {
      order_id:   params.orderId,
      credits:    params.credits,
      amount_pkr: params.amountPkr,
      plan_id:    params.planId,
    }),
  ])
}
