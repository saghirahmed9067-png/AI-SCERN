import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const COOKIE_NAME = 'admin_session'

// ── Secret resolution ─────────────────────────────────────────────────────────
// ADMIN_SESSION_SECRET MUST be set in production. It must be a cryptographically
// random string (≥32 chars). Falling back to ADMIN_PASSWORD or a hardcoded value
// would allow session forgery — both fallbacks are removed.
function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET env var is missing or too short (need ≥32 chars). ' +
      'Generate one with: openssl rand -hex 32'
    )
  }
  return secret
}

// ── HMAC helpers (Web Crypto — edge-compatible) ───────────────────────────────
async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return Buffer.from(sig).toString('hex')
}

async function hmacVerify(data: string, sig: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(data, secret)
  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(sig.padEnd(expected.length, '0'), 'hex')
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// ── Session management ────────────────────────────────────────────────────────
const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours (was mislabelled "2h" but set to 24h)

export async function createAdminSession(ip: string, userAgent: string): Promise<string> {
  const secret  = getSessionSecret()
  const payload = `admin:${ip}:${Date.now()}`
  const sig     = await hmacSign(payload, secret)
  const token   = `${payload}:${sig}`

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
    await sb.from('admin_sessions').insert({
      session_token: token,
      ip_address:    ip,
      user_agent:    userAgent,
      expires_at:    new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    })
    await sb.from('admin_audit_log').insert({
      action:   'login_success',
      admin_ip: ip,
      metadata: { user_agent: userAgent },
    })
  } catch { /* non-fatal — session still works via HMAC */ }

  return token
}

export async function verifyAdminSession(token: string | undefined): Promise<boolean> {
  if (!token) return false

  let secret: string
  try {
    secret = getSessionSecret()
  } catch {
    return false // misconfigured — deny all
  }

  const parts = token.split(':')
  if (parts.length < 4) return false

  const sig  = parts.pop()!
  const data = parts.join(':')

  // 1. Verify HMAC signature
  const valid = await hmacVerify(data, sig, secret)
  if (!valid) return false

  // 2. Verify expiry
  const ts = parseInt(parts[parts.length - 1])
  if (isNaN(ts) || Date.now() - ts > SESSION_TTL_MS) return false

  // 3. Check Supabase revocation table — revoked or expired rows must be rejected
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
    const { data: row, error } = await sb
      .from('admin_sessions')
      .select('revoked_at, expires_at')
      .eq('session_token', token)
      .maybeSingle()

    if (error) {
      // If Supabase is unreachable, fail closed for safety
      console.error('[auth] Supabase revocation check failed:', error.message)
      return false
    }
    if (!row) return false                                         // token not in DB
    if (row.revoked_at)  return false                             // explicitly revoked
    if (new Date(row.expires_at) < new Date()) return false       // DB-side expiry
  } catch {
    return false
  }

  return true
}

export async function revokeAdminSession(token: string): Promise<void> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
    await sb
      .from('admin_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('session_token', token)
  } catch {}
}

// ── Password verification ─────────────────────────────────────────────────────
// PRODUCTION: ADMIN_PASSWORD must be the SHA-256 hex hash of the real password.
//   Generate: echo -n 'yourpassword' | sha256sum
// PLAINTEXT passwords are rejected in production (NODE_ENV=production).
export async function verifyAdminPassword(password: string): Promise<boolean> {
  const stored = process.env.ADMIN_PASSWORD
  if (!stored) return false

  const isHash = stored.length === 64 && /^[0-9a-f]{64}$/.test(stored)

  if (!isHash) {
    // Reject plaintext passwords in production environments
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[auth] ADMIN_PASSWORD must be a 64-char SHA-256 hex hash in production. ' +
        'Plaintext passwords are not accepted. Generate: echo -n "pw" | sha256sum'
      )
      return false
    }
    // Dev only: constant-time plaintext compare
    const enc = new TextEncoder()
    const a   = enc.encode(password)
    const b   = enc.encode(stored)
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    return diff === 0
  }

  // Production: hash the supplied password and compare
  const enc     = new TextEncoder()
  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(password))
  const hashHex = Buffer.from(hashBuf).toString('hex')

  const a = enc.encode(hashHex)
  const b = enc.encode(stored)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// ── Utilities ─────────────────────────────────────────────────────────────────
export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}
