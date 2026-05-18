'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line
} from 'recharts'
import {
  Shield, Activity, LogOut, RefreshCw, Users, Database,
  TrendingUp, AlertTriangle, Zap, Radio, Settings, Clock,
  AlertCircle, Search, ChevronDown, Crown, Ban, CheckCircle,
  ShieldOff, RotateCcw, UserX, Star, Play, Flag, FileText,
  Globe, Eye, EyeOff, Loader2, BarChart3, Server, Package,
  ArrowUpRight, ArrowDownRight, Hash, Terminal, Layers
} from 'lucide-react'

// ── Aiscern Logo ──────────────────────────────────────────────────────────────
function AiscernLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="9" fill="url(#alg)" />
      <path d="M20 8L30 28H10L20 8Z" fill="white" fillOpacity="0.92" />
      <circle cx="20" cy="25" r="3.5" fill="white" fillOpacity="0.6" />
      <defs>
        <linearGradient id="alg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c3aed" /><stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ── API helper ────────────────────────────────────────────────────────────────
async function api(path: string, method = 'GET', body?: unknown) {
  try {
    const r = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (r.status === 401) return { error: 'Unauthorized' }
    return r.json()
  } catch { return { error: 'Network error' } }
}

// ── Small components ──────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
}

function Badge({ v, label }: { v: string; label?: string }) {
  return <span className={`badge badge-${v.toLowerCase()}`}>{label || v}</span>
}

function Spinner() {
  return <div className="w-5 h-5 rounded-full border-2 border-[#1e1e35] border-t-[#7c3aed] spinner" />
}

function KPI({
  label, value, sub, icon: Icon, color = '#a78bfa', delta
}: {
  label: string; value: string | number; sub?: string
  icon?: any; color?: string; delta?: number
}) {
  return (
    <div className="card flex items-start justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#4a5568] mb-1">{label}</p>
        <p className="text-2xl font-black text-white tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-[#4a5568] mt-0.5">{sub}</p>}
        {delta !== undefined && (
          <div className={`flex items-center gap-0.5 text-[11px] mt-1 ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {delta >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(delta)}% vs last period
          </div>
        )}
      </div>
      {Icon && (
        <div className="w-9 h-9 rounded-xl flex items-center justify-center ml-3 flex-shrink-0"
          style={{ background: color + '18' }}>
          <Icon className="w-4.5 h-4.5" style={{ color }} />
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <h2 className="text-sm font-bold text-white">{title}</h2>
        {sub && <p className="text-[11px] text-[#4a5568] mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Nav tabs ──────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',   label: 'Overview',    icon: BarChart3 },
  { id: 'users',      label: 'Users',       icon: Users },
  { id: 'pipeline',   label: 'Pipeline',    icon: Database },
  { id: 'flags',      label: 'Feature Flags',icon: Flag },
  { id: 'errors',     label: 'Error Logs',  icon: AlertTriangle },
  { id: 'audit',      label: 'Audit Log',   icon: FileText },
  { id: 'settings',   label: 'Settings',    icon: Settings },
]

// ── OVERVIEW TAB ──────────────────────────────────────────────────────────────
function OverviewTab() {
  const [data, setData]     = useState<any>(null)
  const [loading, setLoad]  = useState(true)
  const [period, setPeriod] = useState('7d')

  const load = useCallback(() => {
    setLoad(true)
    api(`/analytics?period=${period}`).then(d => { setData(d); setLoad(false) })
  }, [period])

  useEffect(load, [load])

  if (loading) return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array(8).fill(0).map((_,i) => <div key={i} className="card h-24 shimmer" />)}
      </div>
    </div>
  )

  const k = data?.kpis || {}
  const PLAN_COLORS: Record<string,string> = { free:'#64748b', pro:'#7c3aed', team:'#2563eb', enterprise:'#f59e0b' }
  const VERDICT_COLORS: Record<string,string> = { AI:'#f87171', HUMAN:'#34d399', UNCERTAIN:'#fbbf24' }

  return (
    <div className="space-y-6">
      {/* Period picker */}
      <div className="flex items-center gap-2">
        {(['7d','30d','90d'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${period===p ? 'bg-[#7c3aed] text-white' : 'bg-[#111120] text-[#4a5568] hover:text-white border border-[#1e1e35]'}`}>
            {p === '7d' ? 'Last 7 days' : p === '30d' ? 'Last 30 days' : 'Last 90 days'}
          </button>
        ))}
        <button onClick={load} className="ml-auto p-2 rounded-lg bg-[#111120] border border-[#1e1e35] text-[#4a5568] hover:text-white transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Total Scans"    value={(k.totalScans||0).toLocaleString()}   icon={Activity}  color="#a78bfa" />
        <KPI label="Total Users"    value={(k.totalUsers||0).toLocaleString()}   icon={Users}     color="#60a5fa" />
        <KPI label="Active (7d)"    value={(k.activeUsers||0).toLocaleString()}  icon={Radio}     color="#34d399" sub={`${Math.round((k.activeUsers||0)*100/(k.totalUsers||1))}% of total`} />
        <KPI label="Inactive"       value={(k.inactiveUsers||0).toLocaleString()}icon={Clock}     color="#f59e0b" />
        <KPI label="Paid Users"     value={(k.paidUsers||0).toLocaleString()}    icon={Crown}     color="#fbbf24" />
        <KPI label="Banned"         value={(k.bannedUsers||0).toLocaleString()}  icon={Ban}       color="#f87171" />
        <KPI label="Admin-Granted"  value={(k.adminGranted||0).toLocaleString()} icon={Star}      color="#a78bfa" />
        <KPI label="New Today"      value={(k.newToday||0).toLocaleString()}     icon={Zap}       color="#34d399" />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <SectionHeader title="Daily Scans" sub="AI vs Human vs Uncertain" />
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data?.dailyScans || []}>
              <defs>
                <linearGradient id="gAI" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gH" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tickFormatter={v => v.slice(5)} tick={{ fill:'#4a5568', fontSize:10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:'#4a5568', fontSize:10 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={{ background:'#0d0d18', border:'1px solid #1e1e35', borderRadius:10, fontSize:11 }} labelStyle={{ color:'#94a3b8' }} />
              <Area type="monotone" dataKey="ai"    stroke="#f87171" fill="url(#gAI)" strokeWidth={2} name="AI" />
              <Area type="monotone" dataKey="human" stroke="#34d399" fill="url(#gH)"  strokeWidth={2} name="Human" />
              <Area type="monotone" dataKey="uncertain" stroke="#fbbf24" fill="none" strokeWidth={1.5} strokeDasharray="3 3" name="Uncertain" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionHeader title="User Growth" sub="New signups per day" />
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data?.dailyUsers || []}>
              <XAxis dataKey="date" tickFormatter={v => v.slice(5)} tick={{ fill:'#4a5568', fontSize:10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:'#4a5568', fontSize:10 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={{ background:'#0d0d18', border:'1px solid #1e1e35', borderRadius:10, fontSize:11 }} labelStyle={{ color:'#94a3b8' }} />
              <Bar dataKey="new_users" fill="#7c3aed" radius={[4,4,0,0]} name="New Users" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card>
          <SectionHeader title="Plan Distribution" />
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={data?.planDistribution || []} dataKey="count" nameKey="plan" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3}>
                {(data?.planDistribution||[]).map((d:any) => (
                  <Cell key={d.plan} fill={PLAN_COLORS[d.plan] || '#4a5568'} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background:'#0d0d18', border:'1px solid #1e1e35', borderRadius:10, fontSize:11 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-2">
            {(data?.planDistribution||[]).map((d:any) => (
              <div key={d.plan} className="flex items-center gap-1.5 text-[11px]">
                <div className="w-2 h-2 rounded-full" style={{ background: PLAN_COLORS[d.plan]||'#4a5568' }} />
                <span className="text-[#64748b]">{d.plan}</span>
                <span className="text-white font-semibold">{d.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionHeader title="Verdict Distribution" />
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={data?.verdictDistribution||[]} dataKey="count" nameKey="verdict" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3}>
                {(data?.verdictDistribution||[]).map((d:any) => (
                  <Cell key={d.verdict} fill={VERDICT_COLORS[d.verdict]||'#4a5568'} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background:'#0d0d18', border:'1px solid #1e1e35', borderRadius:10, fontSize:11 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-2">
            {(data?.verdictDistribution||[]).map((d:any) => (
              <div key={d.verdict} className="flex items-center gap-1.5 text-[11px]">
                <div className="w-2 h-2 rounded-full" style={{ background: VERDICT_COLORS[d.verdict]||'#4a5568' }} />
                <span className="text-[#64748b]">{d.verdict}</span>
                <span className="text-white font-semibold">{d.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionHeader title="Tool Usage" />
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data?.toolUsage||[]} layout="vertical">
              <XAxis type="number" tick={{ fill:'#4a5568', fontSize:10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="tool" tick={{ fill:'#94a3b8', fontSize:11 }} axisLine={false} tickLine={false} width={50} />
              <Tooltip contentStyle={{ background:'#0d0d18', border:'1px solid #1e1e35', borderRadius:10, fontSize:11 }} />
              <Bar dataKey="count" fill="#2563eb" radius={[0,4,4,0]} name="Scans" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  )
}

// ── USERS TAB ─────────────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers]       = useState<any[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [filter, setFilter]     = useState('all')
  const [loading, setLoad]      = useState(true)
  const [modal, setModal]       = useState<any>(null)
  const [actioning, setAct]     = useState<string|null>(null)
  const [expiryDays, setExpiry] = useState('')
  const [planChoice, setPlan]   = useState('pro')

  const load = useCallback(async () => {
    setLoad(true)
    const params = new URLSearchParams({ page: String(page) })
    if (search) params.set('q', search)
    const res = await api(`/users?${params}`)
    // Client-side filter since API doesn't have all filters yet
    let allUsers = res.users || []
    if (filter === 'active')   allUsers = allUsers.filter((u:any) => !u.is_banned && u.dashboard_access !== false)
    if (filter === 'banned')   allUsers = allUsers.filter((u:any) => u.is_banned)
    if (filter === 'pro')      allUsers = allUsers.filter((u:any) => ['pro','team','enterprise'].includes(u.plan))
    if (filter === 'free')     allUsers = allUsers.filter((u:any) => !u.plan || u.plan === 'free')
    if (filter === 'granted')  allUsers = allUsers.filter((u:any) => u.plan_granted_by)
    setUsers(allUsers)
    setTotal(res.total || 0)
    setLoad(false)
  }, [page, search, filter])

  useEffect(() => { load() }, [load])

  const doAction = async () => {
    if (!modal) return
    setAct(modal.userId + modal.action)
    const body: any = { userId: modal.userId, action: modal.action }
    if (modal.action === 'grant_pro' || modal.action === 'set_plan') {
      body.plan = modal.action === 'grant_pro' ? 'pro' : planChoice
      if (expiryDays && parseInt(expiryDays) > 0) body.expiresInDays = parseInt(expiryDays)
    }
    // Route to main frontend admin API
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
    // Also try local admin API for ban/unban
    if (['ban','unban'].includes(modal.action)) {
      await api(`/users/${modal.userId}/ban`, 'POST', { banned: modal.action === 'ban' })
    }
    if (['grant_pro','set_plan','revoke_pro'].includes(modal.action)) {
      const plan = modal.action === 'revoke_pro' ? 'free' : (modal.action === 'grant_pro' ? 'pro' : planChoice)
      await api(`/users/${modal.userId}/plan`, 'POST', { planId: plan })
    }
    setModal(null); setExpiry(''); setAct(null); load()
  }

  const isPro = (u: any) => ['pro','team','enterprise'].includes(u.plan)
  const isActive = (u: any) => !u.is_banned && u.dashboard_access !== false

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#2a2a45]" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by email…"
            className="w-full bg-[#0d0d18] border border-[#1e1e35] rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder:text-[#2a2a45] focus:outline-none focus:border-[#7c3aed]" />
        </div>
        {['all','active','free','pro','banned','granted'].map(f => (
          <button key={f} onClick={() => { setFilter(f); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${filter===f ? 'bg-[#7c3aed20] border-[#7c3aed50] text-[#a78bfa]' : 'border-[#1e1e35] text-[#4a5568] hover:text-white'}`}>
            {f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
        <button onClick={load} className="p-2 rounded-lg bg-[#0d0d18] border border-[#1e1e35] text-[#4a5568] hover:text-white">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <Card className="!p-0 overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-[#1e1e35]">
            <tr>
              {['User','Plan','Status','Daily Scans','Joined','Actions'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-16 text-[#4a5568] text-sm">
                <Spinner />
              </td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-[#4a5568] text-sm">No users found</td></tr>
            ) : users.map((u, i) => (
              <tr key={u.id} className={`hoverable border-b border-[#1e1e35]/50 transition-colors ${i%2===1?'bg-[#0d0d18]/30':''}`}>
                <td className="px-4 py-3">
                  <div className="text-xs font-semibold text-white truncate max-w-[180px]">{u.email}</div>
                  {u.display_name && <div className="text-[10px] text-[#4a5568]">{u.display_name}</div>}
                  {u.plan_granted_by && <div className="text-[9px] text-[#7c3aed] mt-0.5">★ admin-granted</div>}
                </td>
                <td className="px-4 py-3">
                  <Badge v={u.plan||'free'} />
                </td>
                <td className="px-4 py-3">
                  {u.is_banned
                    ? <Badge v="banned" />
                    : isActive(u)
                      ? <Badge v="active" />
                      : <Badge v="inactive" />
                  }
                </td>
                <td className="px-4 py-3 text-xs font-mono text-[#94a3b8]">
                  {u.daily_scans??0} / {u.plan==='enterprise'?'∞':u.plan==='team'?'500':u.plan==='pro'?'100':'10'}
                </td>
                <td className="px-4 py-3 text-[11px] text-[#4a5568] whitespace-nowrap">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {!isPro(u) ? (
                      <button onClick={() => setModal({ userId:u.id, email:u.email, action:'grant_pro' })}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[#7c3aed18] text-[#a78bfa] border border-[#7c3aed30] hover:bg-[#7c3aed30]">
                        <Crown className="w-2.5 h-2.5" /> Grant Pro
                      </button>
                    ) : u.plan_granted_by ? (
                      <button onClick={() => setModal({ userId:u.id, email:u.email, action:'revoke_pro' })}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[#f43f5e10] text-[#f87171] border border-[#f43f5e20] hover:bg-[#f43f5e20]">
                        <UserX className="w-2.5 h-2.5" /> Revoke
                      </button>
                    ) : null}
                    <button onClick={() => setModal({ userId:u.id, email:u.email, action:'set_plan' })}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[#ffffff08] text-[#64748b] border border-[#ffffff10] hover:text-white">
                      <ChevronDown className="w-2.5 h-2.5" /> Plan
                    </button>
                    {!u.is_banned ? (
                      <button onClick={() => setModal({ userId:u.id, email:u.email, action:'ban' })}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[#f43f5e10] text-[#f87171] border border-[#f43f5e20] hover:bg-[#f43f5e20]">
                        <Ban className="w-2.5 h-2.5" /> Ban
                      </button>
                    ) : (
                      <button onClick={() => setModal({ userId:u.id, email:u.email, action:'unban' })}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[#10b98118] text-[#34d399] border border-[#10b98130] hover:bg-[#10b98130]">
                        <CheckCircle className="w-2.5 h-2.5" /> Unban
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e1e35]">
            <span className="text-[11px] text-[#4a5568]">{total} total users</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
                className="px-3 py-1 rounded-lg text-xs border border-[#1e1e35] text-[#4a5568] hover:text-white disabled:opacity-30">Prev</button>
              <span className="px-2 py-1 text-xs text-[#4a5568]">{page}</span>
              <button onClick={() => setPage(p => p+1)}
                className="px-3 py-1 rounded-lg text-xs border border-[#1e1e35] text-[#4a5568] hover:text-white">Next</button>
            </div>
          </div>
        )}
      </Card>

      {/* Action Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0d0d18] border border-[#1e1e35] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-sm font-bold text-white mb-1 capitalize">{modal.action.replace('_',' ')}</h3>
            <p className="text-[11px] text-[#4a5568] mb-4 truncate">{modal.email}</p>

            {(modal.action==='grant_pro'||modal.action==='set_plan') && (
              <div className="space-y-3 mb-4">
                {modal.action==='set_plan' && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {['free','pro','team','enterprise'].map(p => (
                      <button key={p} onClick={() => setPlan(p)}
                        className={`py-2 rounded-lg text-[10px] font-bold border transition-colors ${planChoice===p?'bg-[#7c3aed20] border-[#7c3aed50] text-[#a78bfa]':'border-[#1e1e35] text-[#4a5568]'}`}>
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
                <input type="number" min="1" max="3650" value={expiryDays} onChange={e => setExpiry(e.target.value)}
                  placeholder="Expires in days (optional)"
                  className="w-full bg-[#07070d] border border-[#1e1e35] rounded-xl px-3 py-2 text-xs text-white placeholder:text-[#2a2a45] focus:outline-none focus:border-[#7c3aed]" />
              </div>
            )}

            <p className="text-[11px] text-[#4a5568] bg-[#07070d] rounded-lg px-3 py-2 border border-[#1e1e35] mb-4">
              {modal.action==='grant_pro' && 'User gets 100 scans/day + all modalities. No charge.'}
              {modal.action==='revoke_pro' && 'User reverts to free plan (10 scans/day).'}
              {modal.action==='set_plan'   && `Plan → ${planChoice}`}
              {modal.action==='ban'        && 'User blocked immediately.'}
              {modal.action==='unban'      && 'User account restored.'}
            </p>

            <div className="flex gap-2">
              <button onClick={() => { setModal(null); setExpiry('') }}
                className="flex-1 py-2.5 rounded-xl border border-[#1e1e35] text-xs font-semibold text-[#64748b] hover:text-white">Cancel</button>
              <button onClick={doAction} disabled={!!actioning}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-50 transition-colors"
                style={{ background: ['ban','revoke_pro'].includes(modal.action)?'#f43f5e':'linear-gradient(135deg,#7c3aed,#2563eb)' }}>
                {actioning ? '…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PIPELINE TAB ──────────────────────────────────────────────────────────────
function PipelineTab() {
  const [data, setData]     = useState<any>(null)
  const [loading, setLoad]  = useState(true)
  const [triggering, setTrig] = useState(false)
  const [trigResult, setTR] = useState<any>(null)

  const load = useCallback(() => {
    setLoad(true)
    api('/pipeline').then(d => { setData(d); setLoad(false) })
  }, [])

  useEffect(load, [load])

  const trigger = async () => {
    setTrig(true); setTR(null)
    const r = await api('/pipeline', 'POST')
    setTR(r); setTrig(false)
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  const p = data?.pipeline || {}
  const b = data?.d1_buffer || {}

  const formatNum = (n: number) => n >= 1_000_000
    ? (n/1_000_000).toFixed(2)+'M'
    : n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n)

  return (
    <div className="space-y-6">
      {/* Pipeline KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Total Scraped"  value={formatNum(p.total_scraped||0)} icon={Database}  color="#a78bfa" />
        <KPI label="Total Pushed"   value={formatNum(p.total_pushed||0)}  icon={TrendingUp} color="#60a5fa" />
        <KPI label="D1 Buffer"      value={formatNum(b.total||0)}          icon={Server}    color="#34d399" sub={`${b.pending||0} pending push`} />
        <KPI label="Avg Quality"    value={`${((b.avg_quality||0)*100).toFixed(0)}%`} icon={Layers} color="#fbbf24" />
      </div>

      {/* Pipeline health + trigger */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <SectionHeader title="Pipeline State" sub={`Last scraped: ${p.last_scrape ? new Date(p.last_scrape).toLocaleTimeString() : 'unknown'}`}
            action={
              <button onClick={trigger} disabled={triggering}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7c3aed20] text-[#a78bfa] border border-[#7c3aed30] hover:bg-[#7c3aed30] disabled:opacity-50">
                <Play className="w-3 h-3" />
                {triggering ? 'Triggering…' : 'Trigger All Workers'}
              </button>
            }
          />
          <div className="space-y-3">
            {[
              { label: 'Text items',  val: b.text||0,  color:'#a78bfa' },
              { label: 'Image items', val: b.image||0, color:'#60a5fa' },
              { label: 'Audio items', val: b.audio||0, color:'#34d399' },
              { label: 'Video items', val: b.video||0, color:'#f59e0b' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-xs text-[#64748b] w-20 flex-shrink-0">{row.label}</span>
                <div className="flex-1 bg-[#07070d] rounded-full h-1.5">
                  <div className="h-1.5 rounded-full" style={{ width:`${Math.min(100,(row.val/(b.total||1))*100)}%`, background: row.color }} />
                </div>
                <span className="text-xs font-semibold text-white w-12 text-right">{formatNum(row.val)}</span>
              </div>
            ))}
          </div>
          {trigResult && (
            <div className={`mt-4 text-xs px-3 py-2 rounded-lg border ${trigResult.triggered?'bg-[#10b98110] border-[#10b98130] text-[#34d399]':'bg-[#f43f5e10] border-[#f43f5e30] text-[#f87171]'}`}>
              {trigResult.triggered
                ? `✓ Triggered ${trigResult.success} workers (${trigResult.failed} failed)`
                : trigResult.error || 'Trigger failed'}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title="AI vs Human Split" />
          <div className="flex items-center gap-6">
            <ResponsiveContainer width="50%" height={140}>
              <PieChart>
                <Pie data={[
                  { name:'AI',    value: b.ai_items||0 },
                  { name:'Human', value: b.human_items||0 },
                ]} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={60}>
                  <Cell fill="#f87171" /><Cell fill="#34d399" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] text-[#4a5568] uppercase tracking-wide">AI samples</div>
                <div className="text-xl font-black text-[#f87171]">{formatNum(b.ai_items||0)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#4a5568] uppercase tracking-wide">Human samples</div>
                <div className="text-xl font-black text-[#34d399]">{formatNum(b.human_items||0)}</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent pushes */}
      {(data?.recent_pushes||[]).length > 0 && (
        <Card>
          <SectionHeader title="Recent HF Pushes" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-[#1e1e35]">
                {['Items','Status','Commit','Date'].map(h => (
                  <th key={h} className="text-left pb-2 text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(data.recent_pushes||[]).map((r:any, i:number) => (
                  <tr key={i} className="hoverable border-b border-[#1e1e35]/40">
                    <td className="py-2 font-mono text-[#94a3b8]">{(r.item_count||0).toLocaleString()}</td>
                    <td className="py-2">
                      <span className={`badge ${r.status==='success'?'badge-human':'badge-ai'}`}>
                        {r.status||'unknown'}
                      </span>
                    </td>
                    <td className="py-2 font-mono text-[#4a5568] text-[10px]">{(r.commit_id||'').slice(0,8)}</td>
                    <td className="py-2 text-[#4a5568]">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Top sources */}
      {(data?.top_sources||[]).length > 0 && (
        <Card>
          <SectionHeader title="Top Data Sources" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-[#1e1e35]">
                {['Source','Type','Label','Count'].map(h => (
                  <th key={h} className="text-left pb-2 text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(data.top_sources||[]).slice(0,15).map((s:any, i:number) => (
                  <tr key={i} className="hoverable border-b border-[#1e1e35]/40">
                    <td className="py-2 text-[#94a3b8] font-mono text-[11px]">{s.source_name}</td>
                    <td className="py-2"><Badge v={s.media_type||'text'} /></td>
                    <td className="py-2"><Badge v={s.label||'human'} /></td>
                    <td className="py-2 font-semibold text-white">{(s.count||0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── FEATURE FLAGS TAB ─────────────────────────────────────────────────────────
function FlagsTab() {
  const [flags, setFlags]   = useState<any[]>([])
  const [loading, setLoad]  = useState(true)
  const [newKey, setNewKey] = useState('')
  const [saving, setSaving] = useState<string|null>(null)

  const load = () => {
    setLoad(true)
    api('/feature-flags').then(d => { setFlags(d.flags||[]); setLoad(false) })
  }
  useEffect(load, [])

  const toggle = async (flag: any) => {
    setSaving(flag.key)
    await api(`/feature-flags/${flag.key}`, 'PATCH', { enabled: !flag.enabled, rollout_percentage: flag.rollout_percentage })
    setSaving(null); load()
  }

  const create = async () => {
    if (!newKey.trim()) return
    await api('/feature-flags', 'POST', { key: newKey.trim(), enabled: false, rollout_percentage: 100 })
    setNewKey(''); load()
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  return (
    <div className="space-y-5">
      <Card>
        <SectionHeader title="Create Flag" />
        <div className="flex gap-2">
          <input value={newKey} onChange={e => setNewKey(e.target.value)}
            onKeyDown={e => e.key==='Enter' && create()}
            placeholder="flag_key_name"
            className="flex-1 bg-[#07070d] border border-[#1e1e35] rounded-xl px-3 py-2 text-xs text-white placeholder:text-[#2a2a45] focus:outline-none focus:border-[#7c3aed]" />
          <button onClick={create}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white"
            style={{ background:'linear-gradient(135deg,#7c3aed,#2563eb)' }}>
            Create
          </button>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-[#1e1e35]">
            <tr>
              {['Flag Key','Status','Rollout','Description','Toggle'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flags.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-[#4a5568]">No flags found</td></tr>
            ) : flags.map((f, i) => (
              <tr key={f.key} className={`hoverable border-b border-[#1e1e35]/50 ${i%2===1?'bg-[#0d0d18]/30':''}`}>
                <td className="px-4 py-3 font-mono text-[#94a3b8] text-[11px]">{f.key}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${f.enabled?'badge-active':'badge-inactive'}`}>
                    {f.enabled ? 'ON' : 'OFF'}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#64748b]">{f.rollout_percentage??100}%</td>
                <td className="px-4 py-3 text-[#4a5568] max-w-xs truncate">{f.description||'—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggle(f)} disabled={saving===f.key}
                    className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${f.enabled?'bg-[#7c3aed]':'bg-[#1e1e35]'}`}>
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${f.enabled?'translate-x-6':'translate-x-1'}`} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ── ERRORS TAB ────────────────────────────────────────────────────────────────
function ErrorsTab() {
  const [errors, setErrors] = useState<any[]>([])
  const [loading, setLoad]  = useState(true)
  const [filter, setFil]    = useState('all')

  const load = () => {
    setLoad(true)
    api('/errors').then(d => { setErrors(d.errors||[]); setLoad(false) })
  }
  useEffect(load, [])

  const filtered = filter === 'unresolved' ? errors.filter(e => !e.resolved)
    : filter === 'resolved' ? errors.filter(e => e.resolved) : errors

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {['all','unresolved','resolved'].map(f => (
          <button key={f} onClick={() => setFil(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${filter===f?'bg-[#7c3aed20] border-[#7c3aed50] text-[#a78bfa]':'border-[#1e1e35] text-[#4a5568] hover:text-white'}`}>
            {f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
        <button onClick={load} className="ml-auto p-2 rounded-lg bg-[#0d0d18] border border-[#1e1e35] text-[#4a5568] hover:text-white">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className="space-y-2">
          {filtered.length === 0
            ? <div className="text-center py-16 text-[#4a5568]">No errors found</div>
            : filtered.map((e, i) => (
              <Card key={e.id||i} className={`border ${e.resolved?'border-[#1e1e35]':'border-[#f43f5e30]'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`badge ${e.resolved?'badge-human':'badge-ai'}`}>{e.resolved?'Resolved':'Open'}</span>
                      <span className="text-[11px] text-[#64748b]">{e.service}</span>
                      <span className="text-[11px] text-[#2a2a45]">{e.created_at ? new Date(e.created_at).toLocaleString() : ''}</span>
                    </div>
                    <p className="text-xs text-[#f87171] truncate">{e.message}</p>
                    {e.stack_trace && (
                      <pre className="text-[10px] text-[#2a2a45] mt-2 overflow-hidden max-h-16 whitespace-pre-wrap">{e.stack_trace.slice(0,200)}</pre>
                    )}
                  </div>
                  {!e.resolved && (
                    <button onClick={() => api(`/errors/${e.id}`, 'PATCH', { resolved: true }).then(load)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-md bg-[#10b98110] text-[#34d399] border border-[#10b98130] hover:bg-[#10b98130] flex-shrink-0">
                      Resolve
                    </button>
                  )}
                </div>
              </Card>
            ))}
        </div>
      )}
    </div>
  )
}

// ── AUDIT LOG TAB ─────────────────────────────────────────────────────────────
function AuditTab() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setL] = useState(true)

  useEffect(() => {
    api('/audit-log').then(d => { setLogs(d.logs||[]); setL(false) })
  }, [])

  return (
    <div className="space-y-4">
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="border-b border-[#1e1e35]">
              <tr>
                {['Action','Admin','Target','IP','Time'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0
                ? <tr><td colSpan={5} className="text-center py-12 text-[#4a5568]">No audit logs</td></tr>
                : logs.map((l, i) => (
                  <tr key={l.id||i} className={`hoverable border-b border-[#1e1e35]/50 ${i%2===1?'bg-[#0d0d18]/30':''}`}>
                    <td className="px-4 py-3 font-mono text-[11px] text-[#a78bfa]">{l.action_type||l.action||'—'}</td>
                    <td className="px-4 py-3 text-[#64748b] text-[11px]">{l.admin_users?.email || l.admin_id?.slice(0,8) || '—'}</td>
                    <td className="px-4 py-3 text-[#4a5568] font-mono text-[10px] truncate max-w-32">{l.target_resource || l.target_id || '—'}</td>
                    <td className="px-4 py-3 text-[#4a5568] font-mono text-[10px]">{l.ip_address || l.admin_ip || '—'}</td>
                    <td className="px-4 py-3 text-[#4a5568] whitespace-nowrap text-[11px]">{l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

// ── SETTINGS TAB ──────────────────────────────────────────────────────────────
function SettingsTab() {
  const [settings, setSettings] = useState<any[]>([])
  const [loading, setL]         = useState(true)
  const [editing, setEdit]      = useState<Record<string,string>>({})
  const [saving, setSave]       = useState<string|null>(null)

  useEffect(() => {
    api('/settings').then(d => { setSettings(d.settings||[]); setL(false) })
  }, [])

  const save = async (key: string) => {
    setSave(key)
    await api('/settings', 'PATCH', { key, value: editing[key] })
    setSave(null)
    setEdit(e => { const c = {...e}; delete c[key]; return c })
    api('/settings').then(d => setSettings(d.settings||[]))
  }

  return (
    <div className="space-y-4">
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <Card>
          <SectionHeader title="Platform Settings" sub="Changes take effect immediately" />
          <div className="space-y-3">
            {settings.length === 0
              ? <p className="text-xs text-[#4a5568] text-center py-8">No configurable settings found</p>
              : settings.map(s => (
                <div key={s.key} className="flex items-center gap-3 p-3 bg-[#07070d] rounded-xl border border-[#1e1e35]">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white font-mono">{s.key}</p>
                    {s.description && <p className="text-[11px] text-[#4a5568]">{s.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={editing[s.key] ?? s.value ?? ''}
                      onChange={e => setEdit(prev => ({ ...prev, [s.key]: e.target.value }))}
                      className="w-40 bg-[#0d0d18] border border-[#1e1e35] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                    {editing[s.key] !== undefined && (
                      <button onClick={() => save(s.key)} disabled={saving===s.key}
                        className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-[#7c3aed20] text-[#a78bfa] border border-[#7c3aed30] hover:bg-[#7c3aed30] disabled:opacity-50">
                        {saving===s.key?'…':'Save'}
                      </button>
                    )}
                  </div>
                </div>
              ))
            }
          </div>
        </Card>
      )}
    </div>
  )
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [tab, setTab]         = useState('overview')
  const [loggingOut, setLO]   = useState(false)
  const [sidebarOpen, setSO]  = useState(true)
  const [health, setHealth]   = useState<any>(null)
  const router                = useRouter()

  useEffect(() => {
    api('/health').then(d => setHealth(d)).catch(() => {})
  }, [])

  const logout = async () => {
    setLO(true)
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => {})
    router.push('/')
  }

  const activeTab = TABS.find(t => t.id === tab)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={`flex-shrink-0 ${sidebarOpen?'w-56':'w-16'} bg-[#0d0d18] border-r border-[#1e1e35] flex flex-col transition-all duration-200`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-[#1e1e35]">
          <AiscernLogo size={30} />
          {sidebarOpen && (
            <div>
              <div className="text-sm font-black text-white leading-none">Aiscern</div>
              <div className="text-[10px] text-[#4a5568] tracking-widest uppercase mt-0.5">Admin</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${active ? 'nav-active text-[#a78bfa]' : 'text-[#4a5568] hover:text-[#94a3b8] hover:bg-[#ffffff05]'}`}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {sidebarOpen && <span className="text-xs font-semibold">{t.label}</span>}
              </button>
            )
          })}
        </nav>

        {/* Health + logout */}
        <div className="p-2 border-t border-[#1e1e35] space-y-1">
          {health && sidebarOpen && (
            <div className="px-3 py-2 text-[10px] text-[#4a5568]">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full live-dot ${health.ok ? 'bg-[#10b981]' : 'bg-[#f43f5e]'}`} />
                {health.ok ? 'System healthy' : 'Degraded'}
              </div>
            </div>
          )}
          <button onClick={() => setSO(o => !o)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[#4a5568] hover:text-[#94a3b8] hover:bg-[#ffffff05] transition-colors">
            <Eye className="w-4 h-4 flex-shrink-0" />
            {sidebarOpen && <span className="text-xs font-semibold">Collapse</span>}
          </button>
          <button onClick={logout} disabled={loggingOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[#f87171] hover:bg-[#f43f5e10] transition-colors disabled:opacity-50">
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {sidebarOpen && <span className="text-xs font-semibold">{loggingOut ? 'Signing out…' : 'Sign out'}</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e35] bg-[#07070d]/80 backdrop-blur-sm flex-shrink-0">
          <div>
            <h1 className="text-sm font-bold text-white">{activeTab?.label}</h1>
            <p className="text-[11px] text-[#4a5568]">
              {new Date().toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#1e1e35] bg-[#0d0d18] text-[11px] text-[#64748b]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] live-dot" />
              Live
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {tab === 'overview'  && <OverviewTab />}
          {tab === 'users'     && <UsersTab />}
          {tab === 'pipeline'  && <PipelineTab />}
          {tab === 'flags'     && <FlagsTab />}
          {tab === 'errors'    && <ErrorsTab />}
          {tab === 'audit'     && <AuditTab />}
          {tab === 'settings'  && <SettingsTab />}
        </main>
      </div>
    </div>
  )
}
