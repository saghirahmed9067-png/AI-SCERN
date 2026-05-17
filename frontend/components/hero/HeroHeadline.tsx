'use client'

/**
 * components/hero/HeroHeadline.tsx
 *
 * Fix: prior version used `absolute inset-0` inside a zero-width container,
 * clipped by overflow-hidden → word invisible on mobile.
 *
 * Fix: slot now has EXPLICIT w + h at every breakpoint so it never collapses.
 * `absolute inset-0` inside a sized parent works correctly.
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'

const ROTATING_WORDS = ['Text', 'Image', 'Audio', 'Video'] as const

// Full static class strings — Tailwind must see these to include in bundle
const WORD_STYLES = {
  Text:  { text: 'text-amber',     bg: 'bg-amber'     },
  Image: { text: 'text-primary',   bg: 'bg-primary'   },
  Audio: { text: 'text-cyan',      bg: 'bg-cyan'      },
  Video: { text: 'text-secondary', bg: 'bg-secondary' },
} as const

const INTERVAL = 2500

export function HeroHeadline({ initialIndex = 0 }: { initialIndex?: number }) {
  const [idx,      setIdx]      = useState(initialIndex)
  const [isPaused, setIsPaused] = useState(false)
  const reduced = useReducedMotion()

  const next = useCallback(() => setIdx(p => (p + 1) % ROTATING_WORDS.length), [])

  useEffect(() => {
    if (isPaused) return
    const id = setInterval(next, INTERVAL)
    return () => clearInterval(id)
  }, [isPaused, next])

  const word      = ROTATING_WORDS[idx]
  const wordStyle = WORD_STYLES[word]
  const dur       = reduced ? 0 : 0.3
  const ease      = [0.25, 0.1, 0.25, 1] as const

  return (
    <div className="text-center select-none">

      {/* Static "Detect" */}
      <motion.h1
        className="font-black leading-[0.9] tracking-tight"
        initial={{ opacity: 0, y: reduced ? 0 : 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.5, ease: 'easeOut' }}
      >
        <span
          className="block text-[2.5rem] xs:text-5xl sm:text-6xl md:text-7xl lg:text-8xl"
          style={{
            background: 'linear-gradient(135deg,#ffffff 0%,#d8b4fe 45%,#8B5CF6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Detect
        </span>
      </motion.h1>

      {/* Rotating word row */}
      <motion.div
        className="mt-3 sm:mt-4 flex items-center justify-center gap-x-2 sm:gap-x-3"
        initial={{ opacity: 0, y: reduced ? 0 : 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.5, delay: 0.15, ease: 'easeOut' }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {/*
          KEY FIX: explicit w + h at every breakpoint.
          Without explicit dimensions the parent collapses to 0×0 when all
          children are absolute — overflow-hidden then clips everything.
          Widths sized for "Image"/"Audio"/"Video" (longest words) at each size.
        */}
        <div
          className="relative overflow-hidden
                     w-16  h-8
                     xs:w-20 xs:h-9
                     sm:w-28 sm:h-11
                     md:w-36 md:h-14
                     lg:w-44 lg:h-16"
          aria-live="polite"
          aria-atomic="true"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={idx}
              initial={{ opacity: 0, y: reduced ?  0 :  22 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{   opacity: 0, y: reduced ?  0 : -22 }}
              transition={{ duration: dur, ease }}
              className={`
                absolute inset-0 flex items-center justify-center
                font-black leading-none
                text-2xl xs:text-3xl sm:text-4xl md:text-5xl lg:text-6xl
                ${wordStyle.text}
              `}
            >
              {word}
            </motion.span>
          </AnimatePresence>
        </div>

        <span className="text-lg xs:text-xl sm:text-2xl md:text-3xl lg:text-4xl font-semibold text-text-secondary whitespace-nowrap">
          with AI
        </span>
      </motion.div>

      {/* Dot indicators */}
      <motion.div
        className="mt-4 sm:mt-5 flex items-center justify-center gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduced ? 0 : 0.4, delay: 0.3 }}
        role="tablist"
        aria-label="Select detection type"
      >
        {ROTATING_WORDS.map((w, i) => {
          const active = i === idx
          return (
            <button
              key={w}
              role="tab"
              aria-selected={active}
              aria-label={`Show ${w}`}
              onClick={() => { setIdx(i); setIsPaused(true) }}
              className={[
                'rounded-full transition-all duration-300',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                active
                  ? `w-5 sm:w-6 h-2 sm:h-2.5 ${WORD_STYLES[w].bg}`
                  : 'w-2 sm:w-2.5 h-2 sm:h-2.5 bg-white/20 hover:bg-white/40',
              ].join(' ')}
            />
          )
        })}
      </motion.div>

    </div>
  )
}
