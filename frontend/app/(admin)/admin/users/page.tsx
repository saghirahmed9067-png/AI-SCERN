'use client'
import { useEffect, useState, useCallback } from 'react'
import { RoleGuard } from '@/components/dashboard/RoleGuard'
import {
  Search, Ban, CheckCircle, ShieldOff, ShieldCheck,
  RefreshCw, ChevronLeft, ChevronRight, Crown, UserX,
  RotateCcw, ChevronDown, Star, ArrowUpCircle, Clock,
  XCircle, CheckCircle2, Users, Inbox,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type User = {
  id: string; email: string; display_name: string | null; plan: string
  created_at: string; is_banned: boolean; dashboard_access: boolean
  access_revoked_at: string | null; scan_count: number; credits_remaining: number
  daily_scans: number; daily_reset_at: string | null
  plan_granted_by: string | null; plan_granted_at: string | null; plan_expires_at: string | null
}

type UpgradeRequest = {
  id: string
  user_id: string
  user_email: string | null
  user_display_name: string | null
  current_plan: string
  requested_plan: string
  status: 'pending' | 'approved' | 'rejected'
  user_message: string | null
  admin_note: string | null
  reviewed_by: string | null
  requested_at: string
  reviewed_at: string | null
}

type ModalAction = { userId: string; action: string; email: string; currentPlan?: string }
type ReviewModal = { request: UpgradeRequest; action: 'approve' | 'reject' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLAN_COLOR: Record<string, string> = {
  free:       'bg-slate/10 text-slate-400 border-slate/20',
  pro:        'bg-primary/10 text-primary border-primary/30',
  team:       'bg-violet/10 text-violet-400 border-violet/30',
  enterprise: 'bg-amber/10 text-amber border-amber/30',
}

function PlanBadge({ plan, grantedBy }: { plan: string; grantedBy?: string | null }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${PLAN_COLOR[plan] || PLAN_COLOR.free}`}>
      {(plan === 'pro' || plan === 'team' || plan === 'enterprise') && <Crown className="w-2.5 h-2.5" />}
      {plan.toUpperCase()}
      {grantedBy && <span className="opacity-60 ml-0.5">★</span>}
    </span>
  )
}

function StatusBadge({ user }: { user: User }) {
  if (user.is_banned)         return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose/10 text-rose border border-rose/20">Banned</span>
  if (!user.dashboard_access) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber/10 text-amber border border-amber/20">Revoked</span>
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald/10 text-emerald border border-emerald/20">Active</span>
}

function RequestStatusBadge({ status }: { status: string }) {
  if (status === 'pending')  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber/10 text-amber border border-amber/20"><Clock className="w-2.5 h-2.5" />Pending</span>
  if (status === 'approved') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald/10 text-emerald border border-emerald/20"><CheckCircle2 className="w-2.5 h-2.5" />Approved</span>
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose/10 text-rose border border-rose/20"><XCircle className="w-2.5 h-2.5" />Rejected</span>
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UsersAdmin() {
  // Tab
  const [tab, setTab] = useState<'users' | 'requests'>('users')

  // Users tab state
  const [users, setUsers]                 = useState<User[]>([])
  const [total, setTotal]                 = useState(0)
  const [page, setPage]                   = useState(1)
  const [search, setSearch]               = useState('')
  const [filter, setFilter]               = useState('all')
  const [loading, setLoading]             = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [modal, setModal]                 = useState<ModalAction | null>(null)
  const [reason, setReason]               = useState('')
  const [planChoice, setPlanChoice]       = useState('pro')
  const [expiryDays, setExpiryDays]       = useState('')

  // Requests tab state
  const [requests, setRequests]           = useState<UpgradeRequest[]>([])
  const [reqTotal, setReqTotal]           = useState(0)
  const [reqPage, setReqPage]             = useState(1)
  const [reqFilter, setReqFilter]         = useState('pending')
  const [reqLoading, setReqLoading]       = useState(false)
  const [pendingCount, setPendingCount]   = useState(0)
  const [reviewModal, setReviewModal]     = useState<ReviewModal | null>(null)
  const [reviewNote, setReviewNote]       = useState('')
  const [reviewExpiry, setReviewExpiry]   = useState('')
  const [reviewLoading, setReviewLoading] = useState(false)

  // ── Fetch users ────────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), filter })
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/users?${params}`)
      if (res.ok) { const d = await res.json(); setUsers(d.users || []); setTotal(d.total || 0) }
    } catch {}
    setLoading(false)
  }, [page, search, filter])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  // ── Fetch upgrade requests ─────────────────────────────────────────────────
  const fetchRequests = useCallback(async () => {
    setReqLoading(true)
    try {
      const params = new URLSearchParams({ status: reqFilter, page: String(reqPage) })
      const res = await fetch(`/api/admin/upgrade-requests?${params}`)
      if (res.ok) { const d = await res.json(); setRequests(d.requests || []); setReqTotal(d.total || 0) }
    } catch {}
    setReqLoading(false)
  }, [reqFilter, reqPage])

  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/upgrade-requests?status=pending&page=1')
      if (res.ok) { const d = await res.json(); setPendingCount(d.total || 0) }
    } catch {}
  }, [])

  useEffect(() => { fetchRequests() }, [fetchRequests])
  useEffect(() => { fetchPendingCount() }, [fetchPendingCount])

  // ── User actions (existing) ────────────────────────────────────────────────
  const doAction = async () => {
    if (!modal) return
    setActionLoading(modal.userId + modal.action)
    try {
      const body: Record<string, any> = { userId: modal.userId, action: modal.action, reason }
      if (modal.action === 'set_plan')  body.plan = planChoice
      if (modal.action === 'grant_pro') body.plan = 'pro'
      if (expiryDays && parseInt(expiryDays) > 0) body.expiresInDays = parseInt(expiryDays)
      const res = await fetch('/api/admin/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) { setModal(null); setReason(''); setExpiryDays(''); await fetchUsers() }
    } catch {}
    setActionLoading(null)
  }

  // ── Review upgrade request ─────────────────────────────────────────────────
  const doReview = async () => {
    if (!reviewModal) return
    setReviewLoading(true)
    try {
      const body: Record<string, any> = {
        requestId: reviewModal.request.id,
        action:    reviewModal.action,
        adminNote: reviewNote || undefined,
      }
      if (reviewModal.action === 'approve' && reviewExpiry && parseInt(reviewExpiry) > 0) {
        body.expiresInDays = parseInt(reviewExpiry)
      }
      const res = await fetch('/api/admin/upgrade-requests', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setReviewModal(null); setReviewNote(''); setReviewExpiry('')
        await Promise.all([fetchRequests(), fetchPendingCount()])
      }
    } catch {}
    setReviewLoading(false)
  }

  const isPro        = (u: User) => ['pro', 'team', 'enterprise'].includes(u.plan)
  const totalPages    = Math.ceil(total / 25)
  const reqTotalPages = Math.ceil(reqTotal / 20)

  return (
    <RoleGuard required="SUPPORT">
      <div className="p-6 max-w-7xl mx-auto">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-black text-text-primary">User Management</h1>
            <p className="text-xs text-text-muted mt-0.5">{total.toLocaleString()} total users</p>
          </div>
          <button
            onClick={tab === 'users' ? fetchUsers : fetchRequests}
            className="flex items-center gap-2 text-xs text-text-muted hover:text-text-primary px-3 py-1.5 rounded-lg border border-border hover:border-border/80 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-5 p-1 bg-surface border border-border rounded-xl w-fit">
          <button
            onClick={() => setTab('users')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'users'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            All Users
          </button>
          <button
            onClick={() => setTab('requests')}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'requests'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            Upgrade Requests
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-amber text-black text-[9px] font-black rounded-full flex items-center justify-center">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        </div>

        {/* ════════════════════════════════════════════════════════════════════
            TAB: ALL USERS
        ════════════════════════════════════════════════════════════════════ */}
        {tab === 'users' && (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="flex-1 min-w-48 relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
                  placeholder="Search by email…"
                  className="w-full pl-8 pr-3 py-2 text-xs bg-surface border border-border rounded-lg focus:outline-none focus:border-primary/50 text-text-primary placeholder:text-text-muted"
                />
              </div>
              {['all', 'active', 'free', 'pro', 'banned', 'revoked'].map(f => (
                <button key={f}
                  onClick={() => { setFilter(f); setPage(1) }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${filter === f ? 'bg-primary/10 border-primary/40 text-primary' : 'border-border text-text-muted hover:text-text-primary hover:border-border/80'}`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[600px]">
                <thead className="border-b border-border bg-surface/80">
                  <tr>
                    {['User', 'Plan', 'Status', 'Daily Scans', 'Joined', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-text-muted font-semibold uppercase tracking-wide text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="text-center py-12 text-text-muted">Loading…</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-text-muted">No users found</td></tr>
                  ) : users.map((u, i) => (
                    <tr key={u.id} className={`border-b border-border/40 hover:bg-white/2 transition-colors ${i % 2 === 0 ? '' : 'bg-surface/40'}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary truncate max-w-48">{u.email}</div>
                        {u.display_name && <div className="text-text-muted text-[10px]">{u.display_name}</div>}
                        {u.plan_granted_by && <div className="text-[9px] text-primary/60 mt-0.5">Pro granted by admin</div>}
                        {u.plan_expires_at && <div className="text-[9px] text-amber/70">Expires {new Date(u.plan_expires_at).toLocaleDateString()}</div>}
                      </td>
                      <td className="px-4 py-3"><PlanBadge plan={u.plan || 'free'} grantedBy={u.plan_granted_by} /></td>
                      <td className="px-4 py-3"><StatusBadge user={u} /></td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-text-secondary">{u.daily_scans ?? 0}</span>
                        <span className="text-text-muted"> / {u.plan === 'enterprise' ? '∞' : u.plan === 'team' ? '500' : u.plan === 'pro' ? '100' : '10'}</span>
                      </td>
                      <td className="px-4 py-3 text-text-muted whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          {!isPro(u) ? (
                            <button
                              onClick={() => { setModal({ userId: u.id, action: 'grant_pro', email: u.email, currentPlan: u.plan }); setExpiryDays('') }}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                            >
                              <Crown className="w-2.5 h-2.5" /> Grant Pro
                            </button>
                          ) : (
                            <>
                              {u.plan_granted_by && (
                                <button
                                  onClick={() => setModal({ userId: u.id, action: 'revoke_pro', email: u.email })}
                                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-rose/10 text-rose border border-rose/20 hover:bg-rose/20 transition-colors"
                                >
                                  <UserX className="w-2.5 h-2.5" /> Revoke Pro
                                </button>
                              )}
                              <button
                                onClick={() => setModal({ userId: u.id, action: 'set_plan', email: u.email, currentPlan: u.plan })}
                                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-violet/10 text-violet-400 border border-violet/20 hover:bg-violet/20 transition-colors"
                              >
                                <ChevronDown className="w-2.5 h-2.5" /> Change Plan
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setModal({ userId: u.id, action: 'reset_daily', email: u.email })}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-slate/10 text-slate-400 border border-slate/20 hover:bg-slate/20 transition-colors"
                          >
                            <RotateCcw className="w-2.5 h-2.5" /> Reset
                          </button>
                          {!u.is_banned ? (
                            <button
                              onClick={() => setModal({ userId: u.id, action: 'ban', email: u.email })}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-rose/10 text-rose border border-rose/20 hover:bg-rose/20 transition-colors"
                            >
                              <Ban className="w-2.5 h-2.5" /> Ban
                            </button>
                          ) : (
                            <button
                              onClick={() => setModal({ userId: u.id, action: 'unban', email: u.email })}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-emerald/10 text-emerald border border-emerald/20 hover:bg-emerald/20 transition-colors"
                            >
                              <CheckCircle className="w-2.5 h-2.5" /> Unban
                            </button>
                          )}
                          {u.dashboard_access ? (
                            <button
                              onClick={() => setModal({ userId: u.id, action: 'revoke', email: u.email })}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-amber/10 text-amber border border-amber/20 hover:bg-amber/20 transition-colors"
                            >
                              <ShieldOff className="w-2.5 h-2.5" /> Revoke
                            </button>
                          ) : (
                            <button
                              onClick={() => setModal({ userId: u.id, action: 'restore', email: u.email })}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-emerald/10 text-emerald border border-emerald/20 hover:bg-emerald/20 transition-colors"
                            >
                              <ShieldCheck className="w-2.5 h-2.5" /> Restore
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>{/* end overflow-x-auto */}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-text-muted">
                  Showing {((page - 1) * 25) + 1}–{Math.min(page * 25, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="p-1.5 rounded-lg border border-border text-text-muted disabled:opacity-30 transition-colors">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-text-muted px-2 py-1">{page} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="p-1.5 rounded-lg border border-border text-text-muted disabled:opacity-30 transition-colors">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB: UPGRADE REQUESTS
        ════════════════════════════════════════════════════════════════════ */}
        {tab === 'requests' && (
          <>
            <div className="flex items-start gap-3 p-4 mb-4 rounded-xl bg-amber/5 border border-amber/20">
              <ArrowUpCircle className="w-4 h-4 text-amber mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber">Manual Upgrade Approval Queue</p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Free users (10 credits/day) can request a Pro upgrade. Review and approve or reject each request.
                  Approved users are immediately upgraded to Pro with 100 scans/day across all 4 modalities.
                </p>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              {['pending', 'approved', 'rejected', 'all'].map(s => (
                <button key={s}
                  onClick={() => { setReqFilter(s); setReqPage(1) }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${reqFilter === s ? 'bg-primary/10 border-primary/40 text-primary' : 'border-border text-text-muted hover:text-text-primary'}`}
                >
                  {s === 'pending'  && <Clock className="w-3 h-3" />}
                  {s === 'approved' && <CheckCircle2 className="w-3 h-3" />}
                  {s === 'rejected' && <XCircle className="w-3 h-3" />}
                  {s === 'all'      && <Inbox className="w-3 h-3" />}
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {s === 'pending' && pendingCount > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded bg-amber/20 text-amber text-[9px] font-black">{pendingCount}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-surface/80">
                  <tr>
                    {['User', 'Current Plan', 'Requesting', 'Status', 'Message', 'Submitted', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-text-muted font-semibold uppercase tracking-wide text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reqLoading ? (
                    <tr><td colSpan={7} className="text-center py-12 text-text-muted">Loading…</td></tr>
                  ) : requests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-16">
                        <div className="flex flex-col items-center gap-2 text-text-muted">
                          <Inbox className="w-8 h-8 opacity-30" />
                          <p className="text-xs">No {reqFilter === 'all' ? '' : reqFilter} upgrade requests</p>
                        </div>
                      </td>
                    </tr>
                  ) : requests.map((r, i) => (
                    <tr key={r.id} className={`border-b border-border/40 hover:bg-white/2 transition-colors ${i % 2 === 0 ? '' : 'bg-surface/40'}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary truncate max-w-44">{r.user_email || '—'}</div>
                        {r.user_display_name && <div className="text-text-muted text-[10px]">{r.user_display_name}</div>}
                        <div className="text-[9px] text-text-muted font-mono mt-0.5 truncate max-w-44 opacity-60">{r.user_id}</div>
                      </td>
                      <td className="px-4 py-3"><PlanBadge plan={r.current_plan || 'free'} /></td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/30">
                          <Crown className="w-2.5 h-2.5" />{(r.requested_plan || 'pro').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <RequestStatusBadge status={r.status} />
                        {r.reviewed_at && (
                          <div className="text-[9px] text-text-muted mt-0.5">{new Date(r.reviewed_at).toLocaleDateString()}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[180px]">
                        {r.user_message ? (
                          <p className="text-[10px] text-text-secondary line-clamp-2 italic" title={r.user_message}>
                            "{r.user_message}"
                          </p>
                        ) : (
                          <span className="text-[10px] text-text-muted italic">No message</span>
                        )}
                        {r.admin_note && (
                          <p className="text-[9px] text-primary/70 mt-0.5 line-clamp-1" title={r.admin_note}>
                            Note: {r.admin_note}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-muted whitespace-nowrap text-[10px]">
                        {new Date(r.requested_at).toLocaleDateString()}
                        <div className="text-[9px] opacity-60">
                          {new Date(r.requested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {r.status === 'pending' ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => { setReviewModal({ request: r, action: 'approve' }); setReviewNote(''); setReviewExpiry('') }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-bold bg-emerald/10 text-emerald border border-emerald/20 hover:bg-emerald/20 transition-colors"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Approve
                            </button>
                            <button
                              onClick={() => { setReviewModal({ request: r, action: 'reject' }); setReviewNote(''); setReviewExpiry('') }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-bold bg-rose/10 text-rose border border-rose/20 hover:bg-rose/20 transition-colors"
                            >
                              <XCircle className="w-3 h-3" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-text-muted italic">Reviewed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {reqTotalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-text-muted">
                  Showing {((reqPage - 1) * 20) + 1}–{Math.min(reqPage * 20, reqTotal)} of {reqTotal}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setReqPage(p => Math.max(1, p - 1))} disabled={reqPage === 1}
                    className="p-1.5 rounded-lg border border-border text-text-muted disabled:opacity-30 transition-colors">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-text-muted px-2 py-1">{reqPage} / {reqTotalPages}</span>
                  <button onClick={() => setReqPage(p => Math.min(reqTotalPages, p + 1))} disabled={reqPage === reqTotalPages}
                    className="p-1.5 rounded-lg border border-border text-text-muted disabled:opacity-30 transition-colors">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          USER ACTION MODAL (ban / grant_pro / revoke / etc.)
      ══════════════════════════════════════════════════════════════════════ */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                modal.action === 'grant_pro'  ? 'bg-primary/15' :
                modal.action === 'revoke_pro' ? 'bg-rose/10' :
                modal.action === 'ban'        ? 'bg-rose/10' :
                modal.action === 'reset_daily'? 'bg-slate/10' : 'bg-amber/10'
              }`}>
                {modal.action === 'grant_pro'   && <Crown      className="w-5 h-5 text-primary" />}
                {modal.action === 'revoke_pro'  && <UserX      className="w-5 h-5 text-rose" />}
                {modal.action === 'set_plan'    && <Star       className="w-5 h-5 text-violet-400" />}
                {modal.action === 'reset_daily' && <RotateCcw  className="w-5 h-5 text-slate-400" />}
                {modal.action === 'ban'         && <Ban        className="w-5 h-5 text-rose" />}
                {modal.action === 'unban'       && <CheckCircle className="w-5 h-5 text-emerald" />}
                {modal.action === 'revoke'      && <ShieldOff  className="w-5 h-5 text-amber" />}
                {modal.action === 'restore'     && <ShieldCheck className="w-5 h-5 text-emerald" />}
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary capitalize">
                  {modal.action.replace(/_/g, ' ')}
                </h3>
                <p className="text-xs text-text-muted mt-0.5 truncate max-w-xs">{modal.email}</p>
              </div>
            </div>

            {(modal.action === 'grant_pro' || modal.action === 'set_plan') && (
              <div className="space-y-3 mb-4">
                {modal.action === 'set_plan' && (
                  <div>
                    <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wide block mb-1.5">Plan</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {['free', 'pro', 'team', 'enterprise'].map(p => (
                        <button key={p} onClick={() => setPlanChoice(p)}
                          className={`py-2 rounded-lg text-[10px] font-bold border transition-colors ${planChoice === p ? 'bg-primary/15 border-primary/50 text-primary' : 'border-border text-text-muted hover:text-text-primary'}`}
                        >
                          {p.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wide block mb-1.5">
                    Expires in (days) — leave blank for no expiry
                  </label>
                  <input type="number" min="1" max="3650"
                    value={expiryDays} onChange={e => setExpiryDays(e.target.value)}
                    placeholder="e.g. 30 (optional)"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary/50 text-text-primary placeholder:text-text-muted"
                  />
                </div>
              </div>
            )}

            {['ban', 'revoke'].includes(modal.action) && (
              <div className="mb-4">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wide block mb-1.5">Reason (optional)</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)}
                  rows={2} placeholder="e.g. TOS violation"
                  className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary/50 text-text-primary placeholder:text-text-muted resize-none"
                />
              </div>
            )}

            <div className="text-xs text-text-muted mb-4 bg-background/60 rounded-lg px-3 py-2 border border-border/50">
              {modal.action === 'grant_pro'   && 'User will get 100 scans/day + all 4 modalities. No charge to user.'}
              {modal.action === 'revoke_pro'  && 'User will revert to free plan (10 scans/day, text + image only).'}
              {modal.action === 'set_plan'    && `User will be set to ${planChoice} plan with matching limits.`}
              {modal.action === 'reset_daily' && 'Daily scan counter resets to 0. User can scan again immediately.'}
              {modal.action === 'ban'         && 'User will be blocked from all access immediately.'}
              {modal.action === 'unban'       && 'User account will be restored.'}
              {modal.action === 'revoke'      && 'Dashboard access removed. User cannot log in.'}
              {modal.action === 'restore'     && 'Dashboard access restored.'}
            </div>

            <div className="flex gap-2">
              <button onClick={() => { setModal(null); setReason(''); setExpiryDays('') }}
                className="flex-1 py-2.5 rounded-xl border border-border text-xs font-semibold text-text-muted hover:text-text-primary transition-colors">
                Cancel
              </button>
              <button onClick={doAction} disabled={!!actionLoading}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 ${
                  ['ban', 'revoke', 'revoke_pro'].includes(modal.action)
                    ? 'bg-rose text-white hover:bg-rose/90'
                    : modal.action === 'grant_pro' || modal.action === 'set_plan'
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'bg-emerald/90 text-white hover:bg-emerald'
                }`}>
                {actionLoading ? 'Processing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          UPGRADE REQUEST REVIEW MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-start gap-3 mb-5">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${reviewModal.action === 'approve' ? 'bg-emerald/10' : 'bg-rose/10'}`}>
                {reviewModal.action === 'approve'
                  ? <CheckCircle2 className="w-5 h-5 text-emerald" />
                  : <XCircle className="w-5 h-5 text-rose" />}
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">
                  {reviewModal.action === 'approve' ? 'Approve Upgrade Request' : 'Reject Upgrade Request'}
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  {reviewModal.request.user_email || reviewModal.request.user_id}
                </p>
              </div>
            </div>

            {/* Plan change summary */}
            <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-background/60 border border-border/50">
              <PlanBadge plan={reviewModal.request.current_plan || 'free'} />
              <ChevronRight className="w-3 h-3 text-text-muted" />
              <PlanBadge plan={reviewModal.request.requested_plan || 'pro'} />
              <span className="text-[10px] text-text-muted ml-auto">10 → 100 scans/day</span>
            </div>

            {/* User's message */}
            {reviewModal.request.user_message && (
              <div className="mb-4 p-3 rounded-lg bg-background/60 border border-border/50">
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">User's message</p>
                <p className="text-xs text-text-secondary italic">"{reviewModal.request.user_message}"</p>
              </div>
            )}

            {/* Expiry (approve only) */}
            {reviewModal.action === 'approve' && (
              <div className="mb-4">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wide block mb-1.5">
                  Expires in (days) — leave blank for permanent Pro
                </label>
                <input type="number" min="1" max="3650"
                  value={reviewExpiry} onChange={e => setReviewExpiry(e.target.value)}
                  placeholder="e.g. 365 (optional)"
                  className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary/50 text-text-primary placeholder:text-text-muted"
                />
              </div>
            )}

            {/* Admin note */}
            <div className="mb-5">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wide block mb-1.5">
                Note to user {reviewModal.action === 'approve' ? '(optional)' : '(recommended)'}
              </label>
              <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)}
                rows={3}
                placeholder={reviewModal.action === 'approve'
                  ? 'e.g. Welcome to Pro! Enjoy the full platform.'
                  : 'e.g. Please reapply after 30 days.'}
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary/50 text-text-primary placeholder:text-text-muted resize-none"
              />
            </div>

            <div className="text-xs text-text-muted mb-4 bg-background/60 rounded-lg px-3 py-2 border border-border/50">
              {reviewModal.action === 'approve'
                ? 'User is immediately upgraded to Pro. They receive an in-app notification with your note.'
                : 'User stays on free plan. They are notified and can reapply in the future.'}
            </div>

            <div className="flex gap-2">
              <button onClick={() => { setReviewModal(null); setReviewNote(''); setReviewExpiry('') }}
                className="flex-1 py-2.5 rounded-xl border border-border text-xs font-semibold text-text-muted hover:text-text-primary transition-colors">
                Cancel
              </button>
              <button onClick={doReview} disabled={reviewLoading}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 ${
                  reviewModal.action === 'approve'
                    ? 'bg-emerald/90 text-white hover:bg-emerald'
                    : 'bg-rose text-white hover:bg-rose/90'
                }`}>
                {reviewLoading ? 'Processing…' : reviewModal.action === 'approve' ? 'Approve & Upgrade' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </RoleGuard>
  )
}
