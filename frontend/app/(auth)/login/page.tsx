'use client'
import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { SignIn, useAuth } from '@clerk/nextjs'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Loader2, ShieldCheck, Zap, Lock } from 'lucide-react'

const TRUST_PILLS = [
  { icon: ShieldCheck, label: 'Free forever' },
  { icon: Zap,         label: 'Instant results' },
  { icon: Lock,        label: 'No data stored' },
]

function LoginContent() {
  const { isSignedIn, isLoaded } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [redirecting, setRedirecting] = useState(false)
  const redirectUrl = searchParams.get('redirect_url') || '/dashboard'

  useEffect(() => {
    if (isLoaded && isSignedIn) { setRedirecting(true); router.replace(redirectUrl) }
  }, [isLoaded, isSignedIn, router, redirectUrl])

  if (redirecting) return (
    <div className="min-h-screen bg-[#050510] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
        <p className="text-sm text-slate-400">Redirecting to dashboard…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#050510] flex flex-col items-center justify-center p-4 relative overflow-hidden">

      {/* Ambient bg */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(ellipse, rgba(109,40,217,0.18) 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(ellipse, rgba(59,130,246,0.08) 0%, transparent 70%)' }} />
        <div className="absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: 'linear-gradient(#a78bfa 1px, transparent 1px), linear-gradient(90deg, #a78bfa 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>

      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 mb-7 relative z-10 group">
        <Image src="/logo.png" alt="Aiscern logo" width={36} height={24}
          className="object-contain drop-shadow-[0_0_14px_rgba(245,100,0,0.6)] group-hover:drop-shadow-[0_0_20px_rgba(245,100,0,0.75)] transition-all duration-300" priority />
        <span className="text-xl font-black gradient-text tracking-tight">Aiscern</span>
      </Link>

      {/* Card */}
      <div className="relative z-10 w-full max-w-[420px]">

        {/* Custom header */}
        <div className="bg-[#0c0c20] border-2 border-[#2f2f58] border-b-0 rounded-t-2xl px-7 pt-7 pb-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase text-violet-300 bg-violet-500/10 border border-violet-500/25 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Secure sign in
            </span>
          </div>
          <h1 className="text-white font-bold text-[22px] tracking-tight leading-tight">Welcome back</h1>
          <p className="text-slate-400 text-[13.5px] mt-1.5 leading-relaxed">Sign in to your Aiscern account</p>
        </div>

        {/* Clerk body */}
        <SignIn
          routing="path"
          path="/login"
          forceRedirectUrl={redirectUrl}
          fallbackRedirectUrl="/dashboard"
          signUpUrl="/signup"
          appearance={{
            layout: { socialButtonsPlacement: 'bottom', socialButtonsVariant: 'blockButton', showOptionalFields: false },
            variables: {
              colorPrimary: '#7c3aed', colorBackground: '#0c0c20',
              colorInputBackground: '#080818', colorInputText: '#f1f5ff',
              colorText: '#e8edff', colorTextSecondary: '#94a3c4',
              colorTextOnPrimaryBackground: '#ffffff', colorNeutral: '#3a3a62',
              colorDanger: '#f87171', colorSuccess: '#34d399', colorWarning: '#fbbf24',
              borderRadius: '10px', fontFamily: 'inherit', fontSize: '14px', spacingUnit: '16px',
              fontWeight: { normal: 400, medium: 500, bold: 700 },
            },
            elements: {
              rootBox: 'w-full',
              card: 'bg-[#0c0c20] border-2 border-[#2f2f58] border-t-0 shadow-[0_32px_80px_rgba(0,0,0,0.8)] rounded-b-2xl overflow-hidden p-0',
              cardBox: 'rounded-b-2xl',
              header: '!hidden',
              main: 'px-7 pb-2 pt-6',
              formFieldRow: 'mb-4',
              formFieldLabelRow: 'flex items-center justify-between mb-2',
              formFieldLabel: 'text-[12px] font-semibold tracking-[0.07em] uppercase text-slate-300',
              formFieldHintText: 'text-slate-400 text-[12px] mt-1.5',
              formFieldInput: 'w-full bg-[#080818] border-2 border-[#2f2f58] text-[#f1f5ff] placeholder:text-slate-600 rounded-[10px] text-[14px] px-3.5 py-2.5 transition-all duration-150 focus:outline-none focus:border-violet-500 focus:bg-[#0a0a22] focus:shadow-[0_0_0_4px_rgba(124,58,237,0.15)] hover:border-[#3d3d6e]',
              formFieldInputShowPasswordButton: 'text-slate-500 hover:text-slate-300 transition-colors pr-1',
              formFieldAction: 'text-violet-400 hover:text-violet-300 text-[12px] font-medium transition-colors',
              formFieldErrorText: 'text-rose-400 text-[12.5px] mt-2 font-medium',
              formFieldSuccessText: 'text-emerald-400 text-[12.5px] mt-2 font-medium',
              formFieldWarningText: 'text-amber-400 text-[12.5px] mt-2 font-medium',
              otpCodeFieldInput: 'bg-[#080818] border-2 border-[#2f2f58] text-white font-mono text-[20px] font-bold rounded-[10px] text-center w-11 h-12 focus:outline-none focus:border-violet-500 focus:shadow-[0_0_0_4px_rgba(124,58,237,0.15)] transition-all duration-150',
              formButtonPrimary: 'w-full bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white font-semibold text-[14px] rounded-[10px] py-[11px] border-0 shadow-[0_4px_24px_rgba(124,58,237,0.45)] hover:shadow-[0_6px_32px_rgba(124,58,237,0.55)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
              formButtonReset: 'text-violet-400 hover:text-violet-300 text-[13px] font-medium transition-colors',
              dividerRow: 'my-5',
              dividerLine: 'bg-[#2f2f58]',
              dividerText: 'text-slate-500 text-[11px] px-3 uppercase tracking-widest',
              socialButtonsBlockButton: 'w-full bg-[#0e0e26] border-2 border-[#2f2f58] text-slate-200 rounded-[10px] hover:bg-[#131336] hover:border-[#3d3d70] hover:text-white transition-all duration-200 py-2.5 shadow-sm',
              socialButtonsBlockButtonText: 'text-[13.5px] font-semibold',
              socialButtonsBlockButtonArrow: 'hidden',
              socialButtonsProviderIcon: 'w-4 h-4',
              alert: 'border-2 rounded-[10px] px-4 py-3 my-4 bg-rose-500/8 border-rose-500/35',
              alertText: 'text-rose-300 leading-relaxed text-[13px]',
              alertTextDanger: 'text-rose-300 text-[13px]',
              alertTextWarning: 'text-amber-300 text-[13px]',
              footer: 'px-7 pt-3 pb-6',
              footerAction: 'text-center',
              footerActionText: 'text-slate-400 text-[13.5px]',
              footerActionLink: 'text-violet-400 hover:text-violet-300 font-semibold text-[13.5px] transition-colors ml-1 hover:underline underline-offset-2',
              footerPages: '!hidden',
              identityPreviewText: 'text-slate-200 text-[14px]',
              identityPreviewEditButton: 'text-violet-400 hover:text-violet-300 text-[13px] transition-colors',
              spinner: 'text-violet-400',
              alternativeMethodsBlockButton: 'w-full bg-[#0e0e26] border-2 border-[#2f2f58] text-slate-200 rounded-[10px] hover:bg-[#131336] hover:border-[#3d3d70] hover:text-white transition-all duration-200 py-2.5 text-[13px] font-medium',
            },
          }}
        />
      </div>

      {/* Trust pills */}
      <div className="relative z-10 flex items-center gap-3 mt-6 flex-wrap justify-center">
        {TRUST_PILLS.map(({ icon: Icon, label }) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400 bg-white/[0.04] border border-white/[0.08] px-3 py-1.5 rounded-full">
            <Icon className="w-3.5 h-3.5 text-violet-400" />
            {label}
          </span>
        ))}
      </div>

      <p className="mt-5 text-[11.5px] text-slate-600 relative z-10">© 2026 Aiscern · Secured by Clerk</p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#050510] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
