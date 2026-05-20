import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME, createAdminSession, verifyAdminPassword } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()
    if (!password) return NextResponse.json({ error: 'Missing password' }, { status: 400 })

    const valid = await verifyAdminPassword(password)
    if (!valid) return NextResponse.json({ error: 'Invalid password' }, { status: 401 })

    const ip        = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
    const userAgent = req.headers.get('user-agent') || 'unknown'
    const token     = await createAdminSession(ip, userAgent)

    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   60 * 60 * 24,
      path:     '/',
    })
    return res
  } catch {
    return NextResponse.json({ error: 'Auth error' }, { status: 500 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(COOKIE_NAME)
  return res
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_session')?.value
  const { verifyAdminSession } = await import('@/lib/auth')
  const valid = await verifyAdminSession(token)
  if (!valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true })
}
