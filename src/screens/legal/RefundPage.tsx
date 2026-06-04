import { ArrowLeft, RefreshCcw, CheckCircle2, Clock, CreditCard, Mail } from 'lucide-react';

interface LegalPageProps {
  onBack: () => void;
}

export default function RefundPage({ onBack }: LegalPageProps) {
  return (
    <LegalLayout title="Refund & Cancellation Policy" icon={<RefreshCcw size={20} />} onBack={onBack} lastUpdated="May 30, 2026">

      {/* Quick-reference cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 not-prose">
        <InfoCard icon={<Clock size={16} />} label="Processing Time" value="5 working days" color="sky" />
        <InfoCard icon={<CreditCard size={16} />} label="Refund Method" value="Original payment" color="cyan" />
        <InfoCard icon={<Mail size={16} />} label="Request Via" value="support@trendcutflow.com" color="slate" />
      </div>

      <Section title="1. Overview">
        <p>At TrendCutFlow, we want you to be completely satisfied with your subscription. This policy outlines the conditions under which refunds are granted and the process for requesting one.</p>
      </Section>

      <Section title="2. Eligibility for Refund">
        <p>You may request a refund under the following circumstances:</p>
        <ul>
          <li>You were charged in error (duplicate charge, wrong plan billed).</li>
          <li>The Service was substantially unavailable or non-functional for more than 48 consecutive hours during your paid billing period.</li>
          <li>You request a refund within <strong className="text-white">7 days</strong> of your initial subscription payment and have not used more than 1 processing credit.</li>
        </ul>
        <p>Refunds are generally <strong className="text-white">not</strong> issued for:</p>
        <ul>
          <li>Partial use of credits within a billing cycle.</li>
          <li>Dissatisfaction with AI-generated clip quality (AI outputs are subjective by nature).</li>
          <li>Requests made after 7 days from the billing date, except in error-billing cases.</li>
          <li>Free-tier accounts (no charge applies).</li>
        </ul>
      </Section>

      <Section title="3. How to Request a Refund">
        <p>To initiate a refund, please email us at <a href="mailto:support@trendcutflow.com" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">support@trendcutflow.com</a> with the subject line <strong className="text-white">"Refund Request"</strong> and include:</p>
        <ul>
          <li>Your registered email address.</li>
          <li>The Razorpay Payment ID from your confirmation email.</li>
          <li>The reason for your refund request.</li>
        </ul>
        <p>Our support team will acknowledge your request within 1 business day and confirm eligibility.</p>
      </Section>

      <Section title="4. Refund Processing Timeline">
        <p>Once a refund is approved:</p>
        <ul>
          <li>Refunds are processed within <strong className="text-white">5 working days</strong> of approval.</li>
          <li>The refund is credited to the <strong className="text-white">original payment method</strong> used at checkout (UPI, credit/debit card, net banking, or wallet).</li>
          <li>Bank processing time may add an additional 2–7 business days depending on your bank or payment provider.</li>
        </ul>
        <p>You will receive a confirmation email once the refund has been initiated on our end.</p>
      </Section>

      <Section title="5. Cancellation">
        <p>You may cancel your subscription at any time from your account settings or by contacting support. Upon cancellation:</p>
        <ul>
          <li>Your plan remains active until the end of the current billing period.</li>
          <li>No further charges will be made after the current period ends.</li>
          <li>Unused credits in the cancelled period are forfeited and not refunded unless you are within the 7-day eligibility window.</li>
        </ul>
      </Section>

      <Section title="6. Disputes">
        <p>If you believe a charge is unauthorised, please contact us before initiating a chargeback with your bank. We will work with you to resolve the issue promptly. Unwarranted chargebacks may result in account suspension.</p>
      </Section>

      <Section title="7. Contact">
        <p>For all refund and cancellation requests:</p>
        <ul>
          <li>Email: <a href="mailto:support@trendcutflow.com" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">support@trendcutflow.com</a></li>
          <li>Response time: within 1 business day</li>
        </ul>
      </Section>
    </LegalLayout>
  );
}

function InfoCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: 'sky' | 'cyan' | 'slate' }) {
  const colorMap = {
    sky:   { bg: 'bg-sky-500/[0.07]  border-sky-500/20',  text: 'text-sky-400',   val: 'text-sky-200' },
    cyan:  { bg: 'bg-cyan-500/[0.07] border-cyan-500/20', text: 'text-cyan-400',  val: 'text-cyan-200' },
    slate: { bg: 'bg-white/[0.04]    border-white/[0.08]', text: 'text-slate-400', val: 'text-slate-200' },
  }[color];

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${colorMap.bg}`}>
      <span className={colorMap.text}>{icon}</span>
      <div>
        <p className="text-slate-500 text-[11px] font-medium uppercase tracking-wide">{label}</p>
        <p className={`text-sm font-semibold mt-0.5 ${colorMap.val}`}>{value}</p>
      </div>
    </div>
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
