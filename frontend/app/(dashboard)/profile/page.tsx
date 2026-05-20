'use client'
import { ScrollToTop } from '@/components/ScrollToTop'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import {
  Mail, Shield, BarChart3, Calendar, Edit3, Save, X,
  Loader2, Check, FileText, Image as ImageIcon, Music, Video,
  Brain, User, Zap, Camera, Crown, ChevronRight
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/auth-provider'
import { toast } from 'sonner'

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, photoURL, avatarUrl, size = 96 }: { name: string; photoURL?: string|null; avatarUrl?: string|null; size?: number }) {
  const initials = name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2) || 'U'
  const src = avatarUrl || photoURL
  if (src) {
    return <img src={src} alt={initials} style={{ width:size, height:size }}
      className="rounded-full object-cover ring-4 ring-primary/30 shadow-xl shadow-primary/20"
      onError={e => { (e.target as HTMLImageElement).style.display='none' }} />
  }
  return (
    <div
      style={{ background:'linear-gradient(135deg,#7c3aed,#2563eb)', width:size, height:size, fontSize:size*0.32 }}
      className="rounded-full flex items-center justify-center font-black text-white ring-4 ring-primary/30 shadow-xl shadow-primary/20">
      {initials}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number|string; color: string }) {
  return (
    <div className="bg-surface border border-border/55 rounded-2xl p-5 flex flex-col gap-2">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}><Icon className="w-4 h-4" /></div>
      <p className="text-2xl font-black text-text-primary tabular-nums">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  )
}

function CreditBar({ label, used, total, color }: { label: string; used: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (used/total)*100) : 0
  const left = total - used
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted font-medium">{label}</span>
        <span className="font-bold text-text-primary">{left} / {total} left</span>
      </div>
      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width:`${pct}%`, background:color }} />
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user }          = useAuth()
  const { user: clerkUser } = useUser()
  const supabase          = createClient()

  const [profile, setProfile]       = useState<any>(null)
  const [stats,   setStats]         = useState<any>(null)
  const [loading, setLoading]       = useState(true)
  const [editing, setEditing]       = useState(false)
  const [saving,  setSaving]        = useState(false)

  // Editable fields
  const [displayName, setDisplayName] = useState('')
  const [username,    setUsername]    = useState('')
  const [bio,         setBio]         = useState('')
  const [avatarUrl,   setAvatarUrl]   = useState('')

  // Username check
  const [uStatus, setUStatus] = useState<'idle'|'checking'|'available'|'taken'>('idle')
  const [suggestions, setSugg] = useState<string[]>([])
  const debounceRef = useRef<NodeJS.Timeout|null>(null)

  const loadProfile = useCallback(async () => {
    if (!user?.uid) return
    const { data } = await (supabase as any).from('profiles').select('*').eq('id', user.uid).single()
    if (data) {
      setProfile(data)
      setDisplayName(data.display_name || user.displayName || '')
      setUsername(data.username || '')
      setBio(data.bio || '')
      setAvatarUrl(data.avatar_url || '')
    }
    // Stats — use server API route (admin client bypasses Supabase RLS for Clerk users)
    try {
      const statsRes = await fetch('/api/user/stats')
      if (statsRes.ok) {
        const s = await statsRes.json()
        setStats({
          ...s,
          avg_confidence: (s.avg_confidence ?? 0) <= 1
            ? Math.round(s.avg_confidence * 100)
            : Math.round(s.avg_confidence),
        })
      }
    } catch { /* silent — stats section shows 0 gracefully */ }
    setLoading(false)
  }, [user?.uid]) // eslint-disable-line

  useEffect(() => { loadProfile() }, [loadProfile])

  const checkUsername = (val: string) => {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g,'')
    setUsername(clean)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!clean || clean.length < 3) { setUStatus('idle'); return }
    setUStatus('checking')
    debounceRef.current = setTimeout(async () => {
      const res  = await fetch(`/api/profiles/username?username=${encodeURIComponent(clean)}`)
      const data = await res.json()
      setUStatus(data.available ? 'available' : 'taken')
      setSugg(data.suggestions || [])
    }, 400)
  }

  const handleSave = async () => {
    if (!user?.uid) return
    if (username && uStatus === 'taken') { toast.error('That username is taken'); return }
    setSaving(true)
    const res = await fetch('/api/profiles/update', {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ display_name: displayName.trim(), username: username||null, bio: bio||null, avatar_url: avatarUrl||null }),
    })
    if (!res.ok) {
      const d = await res.json()
      toast.error(d.error || 'Failed to save')
    } else {
      toast.success('Profile saved!')
      setEditing(false)
      loadProfile()
    }
    setSaving(false)
  }

  const plan      = profile?.plan || 'free'
  const planLabel = ({ free:'Free', pro:'Pro', team:'Team', enterprise:'Enterprise' } as Record<string, string>)[plan] || 'Free'
  const isPro     = ['pro','team','enterprise'].includes(plan)
  const joinedAt  = clerkUser?.createdAt ? new Date(clerkUser.createdAt).toLocaleDateString('en-US',{month:'long',year:'numeric'}) : '—'

  const audioCredits     = profile?.audio_credits ?? 3
  const videoCredits     = profile?.video_credits ?? 3
  const audioCreditsUsed = profile?.audio_credits_used ?? 0
  const videoCreditsUsed = profile?.video_credits_used ?? 0
  const dailyUsed        = profile?.daily_scans ?? 0
  const dailyLimit       = plan==='enterprise' ? Infinity : plan==='team' ? 500 : plan==='pro' ? 100 : 10

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">

      {/* ── Profile Card ─────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }}
        className="bg-surface border border-border/55 rounded-3xl overflow-hidden">
        {/* Banner */}
        <div className="h-28 sm:h-32 relative overflow-hidden" style={{ background:'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(37,99,235,0.2), rgba(124,58,237,0.15))' }}>
          <div className="absolute inset-0" style={{ backgroundImage:'radial-gradient(circle at 30% 50%, rgba(124,58,237,0.2) 0%, transparent 60%)' }} />
        </div>
        <div className="px-3 sm:px-6 pb-5">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 -mt-10 sm:-mt-14">
            {/* Avatar with upload overlay */}
            <div className="relative group w-24 h-24">
              <div className="w-24 h-24 rounded-full flex items-center justify-center text-white font-black text-2xl ring-4 ring-surface"
                style={{ background:'linear-gradient(135deg,#7c3aed,#2563eb)' }}>
                {(displayName||user?.displayName||user?.email||'U')[0]?.toUpperCase()}
              </div>
              {editing && (
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                  <Camera className="w-5 h-5 text-white" />
                </div>
              )}
              <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald border-2 border-surface" />
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 sm:mb-2">
              {editing ? (
                <>
                  <button onClick={handleSave} disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-60"
                    style={{ background:'linear-gradient(135deg,#7c3aed,#2563eb)' }}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border/55 text-sm text-text-muted hover:bg-surface-hover transition-all">
                    <X className="w-4 h-4" /> Cancel
                  </button>
                </>
              ) : (
                <button onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border/55 text-sm font-semibold text-text-secondary hover:bg-surface-hover hover:border-primary/40 transition-all">
                  <Edit3 className="w-4 h-4" /> Edit Profile
                </button>
              )}
            </div>
          </div>

          {/* Name / username / email */}
          <div className="mt-4 space-y-3">
            {editing ? (
              <div className="space-y-3 max-w-sm">
                {/* Display name */}
                <div>
                  <label className="text-[11px] text-text-muted uppercase tracking-widest mb-1 block">Display Name</label>
                  <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                    className="w-full bg-surface-active border border-border/55 rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
                    placeholder="Your full name" />
                </div>
                {/* Username */}
                <div>
                  <label className="text-[11px] text-text-muted uppercase tracking-widest mb-1 block">Username</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">@</span>
                    <input value={username} onChange={e => checkUsername(e.target.value)}
                      className="w-full bg-surface-active border border-border/55 rounded-xl pl-7 pr-9 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
                      placeholder="yourname" maxLength={30} />
                    {uStatus==='checking'  && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-border border-t-primary animate-spin" />}
                    {uStatus==='available' && <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald" />}
                    {uStatus==='taken'     && <X     className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rose-400" />}
                  </div>
                  {uStatus==='taken' && suggestions.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="text-[11px] text-text-muted">Try:</span>
                      {suggestions.map(s => (
                        <button key={s} onClick={() => { setUsername(s); setUStatus('available') }}
                          className="text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">
                          @{s}
                        </button>
                      ))}
                    </div>
                  )}
                  {uStatus==='available' && username && <p className="text-[11px] text-emerald mt-1">@{username} is available</p>}
                </div>
                {/* Bio */}
                <div>
                  <label className="text-[11px] text-text-muted uppercase tracking-widest mb-1 block">Bio</label>
                  <textarea value={bio} onChange={e => setBio(e.target.value)} rows={2}
                    className="w-full bg-surface-active border border-border/55 rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary resize-none"
                    placeholder="A short bio (optional)" maxLength={160} />
                  <p className="text-[10px] text-text-muted text-right mt-0.5">{bio.length}/160</p>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-xl sm:text-2xl font-black text-text-primary">{displayName || user?.displayName || user?.email?.split('@')[0]}</h1>
                {profile?.username && <p className="text-sm text-text-muted">@{profile.username}</p>}
                {profile?.bio      && <p className="text-sm text-text-secondary">{profile.bio}</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-text-muted">
                  <span className="flex items-center gap-1.5 min-w-0"><Mail className="w-4 h-4 shrink-0" /><span className="truncate max-w-[200px] sm:max-w-none">{user?.email}</span></span>
                  <span className="flex items-center gap-1.5 shrink-0"><Calendar className="w-4 h-4" />Joined {joinedAt}</span>
                  <span className="flex items-center gap-1.5 text-emerald shrink-0"><Shield className="w-4 h-4" />Verified</span>
                </div>
              </>
            )}

            {/* Plan badge */}
            <div className="flex items-center gap-2 mt-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${isPro ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-primary/10 text-primary border-primary/20'}`}>
                {isPro ? <Crown className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                {planLabel} Plan
              </span>
              {!isPro && (
                <a href="/pricing" className="text-xs text-text-muted hover:text-primary transition-colors flex items-center gap-1">
                  Upgrade <ChevronRight className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Credits & Usage ─────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0, transition:{delay:0.05} }}
        className="bg-surface border border-border/55 rounded-2xl p-4 sm:p-6">
        <h2 className="font-bold text-text-primary flex items-center gap-2 mb-5">
          <Zap className="w-4 h-4 text-primary" /> Credits & Usage
        </h2>
        <div className="space-y-4">
          <CreditBar
            label={`Daily Scans (${planLabel} — ${dailyLimit === Infinity ? 'Unlimited' : dailyLimit}/day)`}
            used={dailyUsed} total={dailyLimit === Infinity ? dailyUsed+1 : dailyLimit}
            color="linear-gradient(90deg,#7c3aed,#2563eb)" />
          {!isPro && (
            <>
              <CreditBar label="Audio Detection Credits (Free Trial)" used={audioCreditsUsed} total={audioCreditsUsed+audioCredits} color="#06b6d4" />
              <CreditBar label="Video Detection Credits (Free Trial)" used={videoCreditsUsed} total={videoCreditsUsed+videoCredits} color="#f59e0b" />
              {(audioCredits === 0 || videoCredits === 0) && (
                <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-400">
                  Some credits exhausted.{' '}
                  <a href="/pricing" className="font-semibold underline">Upgrade to Pro</a> for 100 scans/day across all modalities.
                </div>
              )}
            </>
          )}
          {isPro && (
            <div className="flex items-center gap-2 p-3 bg-emerald/5 border border-emerald/20 rounded-xl text-xs text-emerald">
              <Check className="w-4 h-4 flex-shrink-0" />
              Full access to all detection modalities included in your {planLabel} plan.
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-text-muted uppercase tracking-widest mb-3 px-1">Detection Stats</h2>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(8)].map((_,i) => <div key={i} className="bg-surface border border-border/55 rounded-2xl h-20 sm:h-24 animate-pulse" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <StatCard icon={Brain}     label="Total Scans"    value={stats?.total_scans    ?? 0} color="bg-primary/10 text-primary" />
              <StatCard icon={Shield}    label="AI Detected"    value={stats?.ai_detected    ?? 0} color="bg-rose-500/10 text-rose-400" />
              <StatCard icon={User}      label="Human Detected" value={stats?.human_detected ?? 0} color="bg-emerald/10 text-emerald" />
              <StatCard icon={BarChart3} label="Avg Confidence" value={`${stats?.avg_confidence ?? 0}%`} color="bg-amber-500/10 text-amber-400" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={FileText}  label="Text"  value={stats?.text_scans  ?? 0} color="bg-amber-500/10 text-amber-400" />
              <StatCard icon={ImageIcon} label="Image" value={stats?.image_scans ?? 0} color="bg-violet-500/10 text-violet-400" />
              <StatCard icon={Music}     label="Audio" value={stats?.audio_scans ?? 0} color="bg-cyan-500/10 text-cyan-400" />
              <StatCard icon={Video}     label="Video" value={stats?.video_scans ?? 0} color="bg-blue-500/10 text-blue-400" />
            </div>
          </>
        )}
      </div>

      {/* ── Account Details ─────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
        className="bg-surface border border-border/55 rounded-2xl p-4 sm:p-6 space-y-3">
        <h2 className="font-bold text-text-primary flex items-center gap-2 mb-1">
          <Shield className="w-5 h-5 text-primary" /> Account Details
        </h2>
        {[
          ['Email address',  user?.email,                  ''],
          ['Username',       profile?.username ? `@${profile.username}` : '—', ''],
          ['Display name',   displayName || '—',           ''],
          ['Joined',         joinedAt,                     ''],
          ['Plan',           planLabel,                    isPro ? 'text-yellow-400' : 'text-primary'],
          ['Status',         'Active',                     'text-emerald'],
        ].map(([label, value, cls]) => (
          <div key={label as string} className="flex justify-between items-center gap-4 py-2.5 border-b border-border/50 last:border-0 text-sm min-w-0">
            <span className="text-text-muted shrink-0">{label}</span>
            <span className={`font-medium text-text-primary truncate text-right min-w-0 ${cls}`}>{value}</span>
          </div>
        ))}
      </motion.div>

      <ScrollToTop />
    </div>
  )
}
