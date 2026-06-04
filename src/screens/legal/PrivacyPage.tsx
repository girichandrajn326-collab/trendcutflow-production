import { ArrowLeft, Shield } from 'lucide-react';

interface LegalPageProps {
  onBack: () => void;
}

export default function PrivacyPage({ onBack }: LegalPageProps) {
  return (
    <LegalLayout title="Privacy Policy" icon={<Shield size={20} />} onBack={onBack} lastUpdated="May 30, 2026">
      <Section title="1. Introduction">
        <p>TrendCutFlow ("we", "our", "us") is committed to protecting your personal information. This Privacy Policy explains what data we collect, how we use it, and your rights regarding that data.</p>
      </Section>

      <Section title="2. Data We Collect">
        <p>We collect the following categories of information:</p>
        <ul>
          <li><strong className="text-white">Account data</strong> — name, email address, and password (stored as a secure hash) provided during registration.</li>
          <li><strong className="text-white">Usage data</strong> — number of videos processed, plan tier, credit consumption, and timestamps of service activity.</li>
          <li><strong className="text-white">Video content</strong> — files you upload are temporarily processed to generate short-form clips and are not retained on our servers after processing is complete.</li>
          <li><strong className="text-white">Payment data</strong> — payment transactions are handled exclusively by Razorpay. We do not store your card number, UPI ID, or bank details.</li>
          <li><strong className="text-white">Technical data</strong> — browser type, IP address, and basic analytics for service improvement (collected only with your consent where required by law).</li>
        </ul>
      </Section>

      <Section title="3. How We Use Your Data">
        <ul>
          <li>To create and manage your account and authenticate your identity.</li>
          <li>To deliver the video processing and clip generation services you requested.</li>
          <li>To process payments securely via our payment partner, Razorpay.</li>
          <li>To send transactional emails (e.g. password resets, payment confirmations).</li>
          <li>To improve our platform through aggregate, anonymised usage analytics.</li>
          <li>To comply with applicable legal obligations.</li>
        </ul>
      </Section>

      <Section title="4. Data Storage & Security">
        <p>Your data is stored securely in Supabase-hosted databases protected by industry-standard encryption at rest and in transit (TLS 1.2+). Access controls and row-level security policies ensure your data is only accessible to you.</p>
        <p>We do not sell, rent, or share your personal data with unauthorised third parties. Data is shared only with the following trusted service providers strictly to operate the Service:</p>
        <ul>
          <li><strong className="text-white">Supabase</strong> — database and authentication infrastructure.</li>
          <li><strong className="text-white">Razorpay</strong> — payment processing (PCI-DSS compliant).</li>
          <li><strong className="text-white">Groq / OpenAI</strong> — AI transcription and clip detection (audio/text content only; no personally identifiable information is transmitted).</li>
        </ul>
      </Section>

      <Section title="5. Data Retention">
        <p>We retain your account data for as long as your account is active. Uploaded video files are deleted from our processing environment within 24 hours of job completion. You may request deletion of your account and all associated data at any time by contacting us.</p>
      </Section>

      <Section title="6. Your Rights">
        <p>Subject to applicable law, you have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you.</li>
          <li>Request correction of inaccurate data.</li>
          <li>Request deletion of your account and personal data.</li>
          <li>Withdraw consent for optional data processing.</li>
          <li>Lodge a complaint with your local data protection authority.</li>
        </ul>
        <p>To exercise these rights, contact us at <a href="mailto:support@trendcutflow.com" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">support@trendcutflow.com</a>.</p>
      </Section>

      <Section title="7. Cookies">
        <p>We use essential session cookies required for authentication. We do not use advertising or tracking cookies. You can manage cookies through your browser settings, but disabling essential cookies will prevent you from logging in.</p>
      </Section>

      <Section title="8. Children's Privacy">
        <p>The Service is not directed to individuals under 18. We do not knowingly collect personal data from minors. If you believe a minor has provided us data, please contact us immediately.</p>
      </Section>

      <Section title="9. Changes to This Policy">
        <p>We may update this Privacy Policy periodically. We will notify you of significant changes via email or a prominent notice on the platform. Your continued use of the Service constitutes acceptance of the updated policy.</p>
      </Section>

      <Section title="10. Contact">
        <p>For privacy-related questions or data requests, contact our privacy team at <a href="mailto:support@trendcutflow.com" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">support@trendcutflow.com</a>.</p>
      </Section>
    </LegalLayout>
  );
}

function LegalLayout({
  title, icon, children, onBack, lastUpdated,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onBack: () => void;
  lastUpdated: string;
}) {
  return (
    <div className="min-h-screen bg-[#0B0F17] text-white pt-24 pb-20 px-4">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-8 transition-colors duration-200 group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
          Back
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-sky-500/[0.12] border border-sky-500/20 flex items-center justify-center text-sky-400">
            {icon}
          </div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
        </div>
        <p className="text-slate-500 text-sm mb-10">Last updated: {lastUpdated}</p>

        <div className="space-y-8 text-slate-300 leading-relaxed text-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-white font-semibold text-base mb-3 pb-2 border-b border-white/[0.06]">{title}</h2>
      <div className="space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_p]:text-slate-300">{children}</div>
    </section>
  );
}
