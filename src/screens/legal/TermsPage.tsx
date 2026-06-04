import { ArrowLeft, FileText } from 'lucide-react';

interface LegalPageProps {
  onBack: () => void;
}

export default function TermsPage({ onBack }: LegalPageProps) {
  return (
    <LegalLayout title="Terms & Conditions" icon={<FileText size={20} />} onBack={onBack} lastUpdated="May 30, 2026">
      <Section title="1. Acceptance of Terms">
        <p>By accessing or using TrendCutFlow ("the Service"), you agree to be bound by these Terms & Conditions. If you do not agree, you must not use the Service.</p>
      </Section>

      <Section title="2. Description of Service">
        <p>TrendCutFlow is an AI-powered short video generation platform that processes uploaded video files to produce viral-optimised short-form clips with subtitles, titles, and metadata. The Service is provided on a subscription basis with metered processing credits.</p>
      </Section>

      <Section title="3. User Accounts">
        <ul>
          <li>You must be at least 18 years old to create an account.</li>
          <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
          <li>You agree to provide accurate and complete registration information.</li>
          <li>You are solely responsible for all activity that occurs under your account.</li>
        </ul>
      </Section>

      <Section title="4. Acceptable Use">
        <p>You agree not to use the Service to:</p>
        <ul>
          <li>Upload content that infringes any third-party intellectual property rights.</li>
          <li>Process content that is illegal, harmful, defamatory, obscene, or fraudulent.</li>
          <li>Attempt to reverse-engineer, scrape, or otherwise misuse the platform.</li>
          <li>Circumvent any access controls or usage limits.</li>
        </ul>
      </Section>

      <Section title="5. Intellectual Property">
        <p>You retain full ownership of the video content you upload. By uploading content, you grant TrendCutFlow a limited, non-exclusive licence to process and transform your content solely to deliver the Service. TrendCutFlow retains ownership of all platform software, algorithms, and generated UI assets.</p>
      </Section>

      <Section title="6. Subscription & Credits">
        <p>Processing credits are consumed per video processed. Credits are non-transferable and expire at the end of each billing cycle. Unused credits do not roll over to the next period unless explicitly stated in your plan description.</p>
      </Section>

      <Section title="7. Limitation of Liability">
        <p>To the maximum extent permitted by applicable law, TrendCutFlow shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service, even if advised of the possibility of such damages. Our total liability shall not exceed the amount paid by you in the three months preceding the claim.</p>
      </Section>

      <Section title="8. Disclaimer of Warranties">
        <p>The Service is provided "as is" and "as available" without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that AI-generated content will meet your expectations.</p>
      </Section>

      <Section title="9. Termination">
        <p>We reserve the right to suspend or terminate your account at our sole discretion if you violate these Terms. Upon termination, your right to access the Service ceases immediately.</p>
      </Section>

      <Section title="10. Governing Law">
        <p>These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts of India.</p>
      </Section>

      <Section title="11. Changes to Terms">
        <p>We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance of the revised Terms. We will notify registered users of material changes via email.</p>
      </Section>

      <Section title="12. Contact">
        <p>For questions regarding these Terms, contact us at <a href="mailto:support@trendcutflow.com" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">support@trendcutflow.com</a>.</p>
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
