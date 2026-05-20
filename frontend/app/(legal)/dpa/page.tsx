import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Download } from 'lucide-react'
import { SiteFooter } from '@/components/site-footer'

export const metadata: Metadata = {
  title: 'Data Processing Agreement (DPA) | Aiscern',
  description: 'Aiscern Data Processing Agreement for enterprise and education customers requiring GDPR/CCPA compliance documentation.',
}

const LAST_UPDATED = 'May 17, 2026'
const VERSION = '1.0'

export default function DpaPage() {
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
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-4xl font-black text-text-primary mb-3">Data Processing Agreement</h1>
              <p className="text-text-muted">Version {VERSION} · Last updated: {LAST_UPDATED}</p>
            </div>
            <a
              href="mailto:privacy@aiscern.com?subject=DPA Request&body=Please send me the signed DPA for Aiscern."
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
            >
              <Download className="h-4 w-4" />
              Request Signed DPA
            </a>
          </div>
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
            This DPA is for enterprise and educational customers who require GDPR or CCPA compliance documentation.
            For a countersigned PDF, email <a href="mailto:privacy@aiscern.com" className="underline underline-offset-2">privacy@aiscern.com</a>.
          </div>
        </div>

        <div className="prose-aiscern space-y-8">

          <Section title="1. Parties and Scope">
            <p>
              This Data Processing Agreement (&quot;DPA&quot;) is entered into between <strong>Aiscern</strong> (&quot;Data Processor&quot; or &quot;we&quot;)
              and the customer organisation using Aiscern services (&quot;Data Controller&quot; or &quot;you&quot;).
            </p>
            <p>
              This DPA supplements the <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link> and
              governs the processing of personal data that the Data Controller submits to Aiscern for AI content detection.
            </p>
            <p>This DPA applies where the processing of personal data is subject to:</p>
            <ul>
              <li>The EU General Data Protection Regulation (GDPR 2016/679)</li>
              <li>The UK GDPR and Data Protection Act 2018</li>
              <li>The California Consumer Privacy Act (CCPA) as amended by CPRA</li>
              <li>Any other applicable data protection legislation</li>
            </ul>
          </Section>

          <Section title="2. Definitions">
            <ul>
              <li><strong>&quot;Personal Data&quot;</strong> — any information relating to an identified or identifiable natural person</li>
              <li><strong>&quot;Processing&quot;</strong> — any operation performed on Personal Data (collection, storage, analysis, deletion)</li>
              <li><strong>&quot;Data Subject&quot;</strong> — the individual whose Personal Data is being processed</li>
              <li><strong>&quot;Sub-processor&quot;</strong> — a third-party processor engaged by Aiscern to process Personal Data</li>
              <li><strong>&quot;Security Incident&quot;</strong> — a breach of security leading to accidental or unlawful destruction, loss, alteration, unauthorised disclosure or access to Personal Data</li>
            </ul>
          </Section>

          <Section title="3. Processing Details">
            <SubSection title="3.1 Subject Matter">
              <p>Aiscern processes personal data contained in content submitted for AI detection analysis (text documents, images, audio, video).</p>
            </SubSection>
            <SubSection title="3.2 Duration">
              <p>Processing continues for the duration of the customer&apos;s subscription. Upon termination, personal data is deleted within 30 days unless retention is required by law.</p>
            </SubSection>
            <SubSection title="3.3 Nature and Purpose">
              <p>Processing is performed solely to provide AI content detection results to the Data Controller. No secondary processing for Aiscern&apos;s own purposes occurs without explicit consent.</p>
            </SubSection>
            <SubSection title="3.4 Types of Personal Data">
              <ul>
                <li>Written content (text documents, emails, essays) that may contain names, identifiers, or personal opinions</li>
                <li>Images, audio, or video that may contain biometric data (faces, voices)</li>
                <li>User account identifiers (email, username) for authentication</li>
                <li>Usage metadata (timestamps, scan counts, IP addresses)</li>
              </ul>
            </SubSection>
            <SubSection title="3.5 Categories of Data Subjects">
              <p>End-users of the Data Controller&apos;s organisation; individuals whose content is submitted for analysis.</p>
            </SubSection>
          </Section>

          <Section title="4. Processor Obligations">
            <p>Aiscern agrees to:</p>
            <ul>
              <li>Process Personal Data only on documented instructions from the Data Controller (i.e., providing detection results)</li>
              <li>Ensure all personnel authorised to process Personal Data are bound by confidentiality obligations</li>
              <li>Implement appropriate technical and organisational security measures (see Section 6)</li>
              <li>Not engage new Sub-processors without informing the Data Controller (see Section 5)</li>
              <li>Assist the Data Controller in responding to Data Subject rights requests</li>
              <li>Assist with security impact assessments and breach notifications as required by GDPR Article 32–36</li>
              <li>Delete or return all Personal Data upon termination of the agreement</li>
              <li>Make available all information necessary to demonstrate compliance with GDPR Article 28</li>
            </ul>
          </Section>

          <Section title="5. Sub-processors (Annex A)">
            <p>Aiscern engages the following sub-processors. By accepting this DPA you authorise their use:</p>
            <div className="overflow-x-auto rounded-xl border border-border mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs text-text-muted uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-medium">Sub-processor</th>
                    <th className="px-4 py-3 text-left font-medium">Purpose</th>
                    <th className="px-4 py-3 text-left font-medium">Data Location</th>
                    <th className="px-4 py-3 text-left font-medium">Transfer Mechanism</th>
                  </tr>
                </thead>
                <tbody className="text-text-secondary">
                  {[
                    ['Clerk (clerk.com)',           'Authentication & identity',              'US (AWS)',         'SCC'],
                    ['Supabase (supabase.com)',      'Database & API',                        'EU / US (AWS)',    'SCC'],
                    ['Vercel (vercel.com)',          'Application hosting & serverless',       'US / Edge',        'SCC'],
                    ['Cloudflare (cloudflare.com)', 'CDN, R2 storage, D1 database',          'Global edge',      'SCC'],
                    ['Google Gemini API',            'AI inference (text/image detection)',   'US (Google)',      'SCC'],
                    ['Hugging Face (huggingface.co)','AI model inference (text/audio)',       'US (AWS)',         'SCC'],
                    ['Upstash (upstash.com)',        'Rate limiting (hashed IPs only)',       'US / EU',          'SCC'],
                  ].map(([name, purpose, location, mechanism]) => (
                    <tr key={name} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-text-primary">{name}</td>
                      <td className="px-4 py-3">{purpose}</td>
                      <td className="px-4 py-3">{location}</td>
                      <td className="px-4 py-3">{mechanism}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-text-muted">
              SCC = Standard Contractual Clauses (EU Commission Decision 2021/914). Copies available on request.
              We will notify you 30 days before adding new sub-processors.
            </p>
          </Section>

          <Section title="6. Security Measures (Annex B)">
            <p>Aiscern implements the following technical and organisational measures:</p>
            <SubSection title="6.1 Access Control">
              <ul>
                <li>Row-level security (RLS) on all database tables — users can only access their own data</li>
                <li>Service role keys stored only in server environment variables, never exposed to browsers</li>
                <li>Multi-factor authentication required for all Aiscern team members</li>
                <li>Principle of least privilege enforced across all infrastructure</li>
              </ul>
            </SubSection>
            <SubSection title="6.2 Encryption">
              <ul>
                <li>TLS 1.3 for all data in transit</li>
                <li>AES-256 encryption for data at rest (Supabase, Cloudflare R2)</li>
                <li>API keys stored as SHA-256 hashes — plaintext never persisted</li>
                <li>HSTS with preload enforced for all web traffic</li>
              </ul>
            </SubSection>
            <SubSection title="6.3 Availability & Resilience">
              <ul>
                <li>Deployed on Vercel Edge Network with global redundancy</li>
                <li>Database backups performed daily by Supabase</li>
                <li>File storage on Cloudflare R2 with automatic redundancy</li>
              </ul>
            </SubSection>
            <SubSection title="6.4 Incident Response">
              <ul>
                <li>Security incidents logged and triaged within 24 hours</li>
                <li>Data breaches reported to affected customers within 72 hours (GDPR Article 33)</li>
                <li>Vulnerability disclosure: <a href="/.well-known/security.txt" className="text-primary hover:underline">security.txt</a></li>
              </ul>
            </SubSection>
          </Section>

          <Section title="7. International Data Transfers">
            <p>
              Personal data may be transferred to and processed in the United States and other countries outside the EEA.
              Where such transfers occur, Aiscern relies on Standard Contractual Clauses (SCCs) adopted by the European Commission
              (Decision 2021/914) as the legal transfer mechanism.
            </p>
            <p>
              Copies of applicable SCCs are available upon written request to{' '}
              <a href="mailto:privacy@aiscern.com" className="text-primary hover:underline">privacy@aiscern.com</a>.
            </p>
          </Section>

          <Section title="8. Data Subject Rights Assistance">
            <p>
              Aiscern will assist the Data Controller in fulfilling Data Subject rights requests within 5 business days of receiving
              a written request. This includes access, rectification, erasure, portability, restriction, and objection requests.
            </p>
            <p>
              Submit requests to: <a href="mailto:privacy@aiscern.com" className="text-primary hover:underline">privacy@aiscern.com</a>
            </p>
          </Section>

          <Section title="9. Audit Rights">
            <p>
              The Data Controller may, with 30 days written notice, conduct (or commission a qualified third-party auditor to conduct)
              an audit of Aiscern&apos;s processing activities to verify compliance with this DPA. Audits are limited to once per year
              and must not unreasonably disrupt Aiscern&apos;s operations.
            </p>
          </Section>

          <Section title="10. Liability and Indemnification">
            <p>
              Each party shall be liable for damages caused by processing that infringes applicable data protection law.
              Aiscern&apos;s total liability under this DPA shall not exceed the amounts paid by the Data Controller in the 12 months
              preceding the claim, except in cases of gross negligence, wilful misconduct, or a personal data breach caused by
              Aiscern&apos;s failure to comply with this DPA.
            </p>
          </Section>

          <Section title="11. Execution">
            <p>
              This DPA becomes effective when the Data Controller accepts Aiscern&apos;s Terms of Service or, for enterprise customers,
              upon execution of a signed DPA addendum. To request a countersigned PDF version of this DPA, contact:
            </p>
            <p>
              <strong>Aiscern</strong><br />
              Email: <a href="mailto:privacy@aiscern.com" className="text-primary hover:underline">privacy@aiscern.com</a><br />
              Subject: &quot;DPA Request — [Your Organisation Name]&quot;
            </p>
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

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-semibold text-text-primary mb-2">{title}</h3>
      <div className="text-text-secondary text-sm leading-relaxed">{children}</div>
    </div>
  )
}
