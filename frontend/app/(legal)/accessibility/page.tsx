import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { SiteFooter } from '@/components/site-footer'

export const metadata: Metadata = {
  title: 'Accessibility Statement | Aiscern',
  description: 'Aiscern accessibility statement. Our commitment to WCAG 2.1 Level AA compliance and how to report accessibility issues.',
}

const LAST_REVIEWED = 'May 17, 2026'

export default function AccessibilityPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-surface/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Aiscern" className="w-8 h-auto object-contain" />
            <span className="font-black gradient-text">Aiscern</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-12">
        <div className="mb-10">
          <h1 className="text-4xl font-black text-text-primary mb-3">Accessibility Statement</h1>
          <p className="text-text-muted">Last reviewed: {LAST_REVIEWED}</p>
        </div>

        {/* Status badge */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 mb-8 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-300 text-sm">Partial Compliance — In Progress</p>
            <p className="text-amber-400/80 text-xs mt-1">
              Aiscern is working toward WCAG 2.1 Level AA compliance. Some areas are not yet fully compliant.
              We are actively addressing known issues and welcome feedback.
            </p>
          </div>
        </div>

        <div className="prose-aiscern space-y-8">

          <Section title="1. Our Commitment">
            <p>
              Aiscern is committed to ensuring digital accessibility for people with disabilities.
              We continually improve the user experience for everyone, and apply the relevant accessibility standards.
            </p>
            <p>
              We aim to conform to the <strong>Web Content Accessibility Guidelines (WCAG) 2.1 Level AA</strong>.
              These guidelines explain how to make web content more accessible to people with a wide range of disabilities.
            </p>
          </Section>

          <Section title="2. Conformance Status">
            <p>The current conformance status of Aiscern is <strong>partially conformant</strong> with WCAG 2.1 Level AA.</p>
            <p>Partially conformant means that some parts of the content do not fully conform to the accessibility standards.</p>

            <div className="mt-4 space-y-3">
              <StatusItem icon="pass" label="Keyboard Navigation" detail="All interactive elements are accessible via keyboard. Tab order is logical throughout." />
              <StatusItem icon="pass" label="Colour Contrast" detail="Text contrast ratios meet or exceed 4.5:1 for normal text and 3:1 for large text across the dark theme." />
              <StatusItem icon="pass" label="Touch Targets" detail="All touch targets are a minimum of 44×44px (Apple HIG / WCAG 2.5.5)." />
              <StatusItem icon="pass" label="Font Sizing" detail="Base font size is 16px on mobile, preventing iOS auto-zoom. Users can resize text up to 200% without loss of content." />
              <StatusItem icon="pass" label="Reduced Motion" detail="All animations respect prefers-reduced-motion. Framer Motion animations are disabled for users who opt out." />
              <StatusItem icon="pass" label="Skip Navigation" detail="A 'Skip to main content' link is available at the top of every page." />
              <StatusItem icon="pass" label="Semantic HTML" detail="Pages use landmark roles (main, nav, header, footer), heading hierarchy, and ARIA labels where appropriate." />
              <StatusItem icon="warn" label="Screen Reader Testing" detail="Automated testing via axe-core has been performed. Manual screen reader testing with NVDA/JAWS is in progress." />
              <StatusItem icon="warn" label="Complex Widgets" detail="The scan result confidence visualisations and animated charts may not convey all information to screen reader users. Text alternatives are being added." />
              <StatusItem icon="warn" label="File Upload" detail="The drag-and-drop file upload interface has keyboard fallback but may present challenges for some assistive technologies." />
              <StatusItem icon="fail" label="WCAG 2.1 Full Audit" detail="A formal third-party WCAG audit has not yet been completed. We plan to commission one in Q3 2026." />
            </div>
          </Section>

          <Section title="3. Technical Specifications">
            <p>Aiscern relies on the following technologies for conformance:</p>
            <ul>
              <li>HTML5 semantic markup</li>
              <li>CSS (Tailwind CSS with focus-visible support)</li>
              <li>JavaScript (Next.js React — server and client components)</li>
              <li>WAI-ARIA 1.2 where native HTML semantics are insufficient</li>
            </ul>
            <p>The following assistive technologies have been tested:</p>
            <ul>
              <li>Chrome + ChromeVox (automated)</li>
              <li>axe-core browser extension (automated)</li>
              <li>iOS VoiceOver (basic manual testing)</li>
            </ul>
          </Section>

          <Section title="4. Known Limitations">
            <p>Despite our best efforts to ensure accessibility of Aiscern, there may be some limitations. Below is a description of known limitations and potential workarounds:</p>
            <ul>
              <li><strong>Detection result confidence rings:</strong> SVG-based visualisations may not be announced correctly by all screen readers. A numeric percentage is always displayed as a text alternative.</li>
              <li><strong>Real-time scan progress:</strong> Live detection updates use aria-live regions but may announce too frequently. We are reviewing announcement frequency.</li>
              <li><strong>PDF export:</strong> Generated PDFs are not yet tagged for accessibility. Tagged PDF output is planned for a future release.</li>
              <li><strong>Video player (demo):</strong> The homepage hero video does not currently have captions. We are adding caption support.</li>
            </ul>
          </Section>

          <Section title="5. Feedback and Contact">
            <p>
              We welcome your feedback on the accessibility of Aiscern. Please let us know if you encounter accessibility barriers:
            </p>
            <ul>
              <li><strong>Email:</strong> <a href="mailto:accessibility@aiscern.com" className="text-primary hover:underline">accessibility@aiscern.com</a></li>
              <li><strong>Response time:</strong> We aim to respond within 2 business days</li>
            </ul>
            <p>
              We try to respond to feedback within 2 business days. If you are not satisfied with our response,
              you can contact the relevant supervisory authority in your jurisdiction.
            </p>
          </Section>

          <Section title="6. Formal Complaints">
            <p>
              If you are located in the EU and are not satisfied with our response to your accessibility feedback,
              you have the right to contact your national accessibility enforcement authority.
              In the UK, you may contact the <a href="https://www.equalityhumanrights.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Equality and Human Rights Commission</a>.
            </p>
          </Section>

          <Section title="7. Assessment and Roadmap">
            <p>Aiscern assesses the accessibility of our platform through:</p>
            <ul>
              <li>Self-evaluation using axe-core automated testing on every deployment (CI/CD)</li>
              <li>Manual keyboard navigation testing on all new features</li>
              <li>Review of user feedback and accessibility bug reports</li>
            </ul>
            <p><strong>Planned improvements:</strong></p>
            <ul>
              <li>Q2 2026: Complete manual screen reader testing (NVDA + JAWS)</li>
              <li>Q3 2026: Commission formal third-party WCAG 2.1 AA audit</li>
              <li>Q3 2026: Tagged PDF export</li>
              <li>Q4 2026: Full WCAG 2.1 AA conformance target</li>
            </ul>
          </Section>

        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold text-text-primary mb-4 pb-2 border-b border-border">{title}</h2>
      <div className="space-y-3 text-text-secondary text-sm leading-relaxed">{children}</div>
    </section>
  )
}

function StatusItem({ icon, label, detail }: { icon: 'pass' | 'warn' | 'fail'; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface/50">
      {icon === 'pass' && <CheckCircle className="w-4 h-4 text-emerald flex-shrink-0 mt-0.5" />}
      {icon === 'warn' && <Clock className="w-4 h-4 text-amber flex-shrink-0 mt-0.5" />}
      {icon === 'fail' && <AlertCircle className="w-4 h-4 text-rose flex-shrink-0 mt-0.5" />}
      <div>
        <p className="font-semibold text-text-primary text-sm">{label}</p>
        <p className="text-text-muted text-xs mt-0.5">{detail}</p>
      </div>
    </div>
  )
}
