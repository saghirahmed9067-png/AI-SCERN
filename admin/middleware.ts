import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from './lib/auth'

// Public paths that do NOT require a session.
// The root "/" is the login page; "/api/auth" handles login/logout POST.
const PUBLIC_PREFIXES = ['/', '/api/auth']

// Every other path (including /dashboard, /api/*, and any future admin pages)
// requires a valid admin session. The catch-all matcher below ensures no route
// is accidentally left unprotected.
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  // Skip Next.js internals
  if (path.startsWith('/_next') || path === '/favicon.ico') {
    return NextResponse.next()
  }

  // Allow the login page and the auth API through without a session check
  const isPublic = PUBLIC_PREFIXES.some(p => path === p || path.startsWith(`${p}/`))
  // "/api/auth" itself must be accessible, but no deeper sub-paths should be public
  const isAuthApi = path === '/api/auth'

  if (isPublic && (path === '/' || isAuthApi)) {
    return NextResponse.next()
  }

  // Everything else requires a verified admin session
  const token = req.cookies.get('admin_session')?.value
  const valid  = await verifyAdminSession(token)
  if (!valid) {
    // API routes → 401 JSON; page routes → redirect to login
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
