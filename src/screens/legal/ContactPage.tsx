import { ArrowLeft, Mail, Clock, MessageSquare, MapPin, TrendingUp } from 'lucide-react';

interface LegalPageProps {
  onBack: () => void;
}

export default function ContactPage({ onBack }: LegalPageProps) {
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

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-sky-500/[0.12] border border-sky-500/20 flex items-center justify-center text-sky-400">
            <MessageSquare size={20} />
          </div>
          <h1 className="text-2xl font-bold text-white">Contact Us</h1>
        </div>
        <p className="text-slate-500 text-sm mb-10">
          We typically respond within 1 business day. For billing & refund queries, include your payment ID.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
          {/* Email card */}
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.05] p-6 flex flex-col gap-4">
            <div className="w-10 h-10 rounded-xl bg-sky-500/[0.15] border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Mail size={18} />
            </div>
            <div>
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-1">Email Support</p>
              <a
                href="mailto:support@trendcutflow.com"
                className="text-white font-semibold text-base hover:text-sky-300 transition-colors duration-200 break-all"
              >
                support@trendcutflow.com
              </a>
              <p className="text-slate-500 text-xs mt-2 leading-snug">
                For account issues, billing, refunds, and general enquiries.
              </p>
            </div>
          </div>

          {/* Response time card */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 flex flex-col gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-slate-400">
              <Clock size={18} />
            </div>
            <div>
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-1">Response Time</p>
              <p className="text-white font-semibold text-base">Within 1 business day</p>
              <p className="text-slate-500 text-xs mt-2 leading-snug">
                Monday–Friday, 10 AM–6 PM IST. Replies may be delayed on public holidays.
              </p>
            </div>
          </div>
        </div>

        {/* Business address */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400 flex-shrink-0">
              <MapPin size={18} />
            </div>
            <div>
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">Business Address</p>
              <div className="text-slate-300 text-sm leading-relaxed">
                <p className="text-white font-semibold mb-1">TrendCutFlow</p>
                <p>[Your Street Address]</p>
                <p>[City, State – PIN Code]</p>
                <p>India</p>
              </div>
              <p className="text-slate-600 text-xs mt-3 italic">
                This address is for correspondence only. We operate as a fully remote business.
              </p>
            </div>
          </div>
        </div>

        {/* Common topics */}
        <div>
          <h2 className="text-white font-semibold text-base mb-4">Common Topics</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { topic: 'Billing & Payment Issues', hint: 'Include your Razorpay Payment ID' },
              { topic: 'Refund Requests',           hint: 'See our Refund Policy for eligibility' },
              { topic: 'Account Access',            hint: 'Provide your registered email' },
              { topic: 'Technical Support',         hint: 'Describe the issue and browser used' },
              { topic: 'Privacy & Data Requests',   hint: 'We respond within 72 hours for data requests' },
              { topic: 'Partnership / Business',    hint: 'Mention "Partnership" in your subject line' },
            ].map(({ topic, hint }) => (
              <div
                key={topic}
                className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"
              >
                <p className="text-white text-sm font-medium">{topic}</p>
                <p className="text-slate-500 text-xs mt-0.5">{hint}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Brand footer within page */}
        <div className="mt-12 pt-8 border-t border-white/[0.06] flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center">
            <TrendingUp size={14} className="text-white" />
          </div>
          <p className="text-slate-500 text-xs">
            TrendCutFlow — AI-powered viral short video generation.
          </p>
        </div>
      </div>
    </div>
  );
}
