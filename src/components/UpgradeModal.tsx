import { useState } from 'react';
import {
  X, Check, Zap, CreditCard, Smartphone, Lock,
  Sparkles, Shield, Gauge, Cpu, CalendarClock,
  BarChart2, Infinity,
} from 'lucide-react';
import type { PlanTier } from '../store/appStore';
import { useAuth } from '../context/AuthContext';

// ─── Plan definitions ─────────────────────────────────────────────────────────

interface Feature {
  text: string;
  highlight?: boolean;  // bold / accented row
  icon?: React.ReactNode;
}

interface PlanDef {
  id: PlanTier;
  name: string;
  tagline: string;
  price: string;
  priceRaw: number;
  credits: number;
  color: 'neutral' | 'sky' | 'amber';
  popular: boolean;
  features: Feature[];
}

const PLAN_DEFS: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Try before you commit',
    price: '₹0',
    priceRaw: 0,
    credits: 1,
    color: 'neutral',
    popular: false,
    features: [
      { text: '1 video/month', icon: <Cpu size={11} /> },
      { text: '5 viral shorts per video', icon: <Sparkles size={11} /> },
      { text: 'Watermarked export' },
      { text: 'Basic subtitle styles (Hormozi only)' },
      { text: 'Browser-side processing' },
      { text: 'Community support' },
    ],
  },
  {
    id: 'creator',
    name: 'Creator Flow',
    tagline: 'For serious content creators',
    price: '₹499',
    priceRaw: 499,
    credits: 3,
    color: 'sky',
    popular: true,
    features: [
      { text: '3 videos/month', icon: <Cpu size={11} />, highlight: true },
      { text: '5 viral shorts per video', icon: <Sparkles size={11} /> },
      { text: 'No watermark on exports', highlight: true },
      { text: 'All 3 subtitle styles', icon: <Sparkles size={11} /> },
      { text: 'Delayed publish queue (24–48h spacing)', icon: <CalendarClock size={11} /> },
      { text: 'AI viral titles, SEO tags & hashtags', icon: <Zap size={11} />, highlight: true },
      { text: 'Algorithm safety filter — auto-varies style seed to prevent footprint detection', icon: <Shield size={11} />, highlight: true },
      { text: 'Priority rendering queue', icon: <Gauge size={11} /> },
      { text: 'Email support' },
    ],
  },
  {
    id: 'pro',
    name: 'Pro Flow',
    tagline: 'Built for agencies & power users',
    price: '₹999',
    priceRaw: 999,
    credits: 5,
    color: 'amber',
    popular: false,
    features: [
      { text: '5 videos/month', icon: <Cpu size={11} />, highlight: true },
      { text: '5 viral shorts per video', icon: <Sparkles size={11} /> },
      { text: 'No watermark on exports', highlight: true },
      { text: 'All 3 subtitle styles + custom seed control', icon: <Sparkles size={11} /> },
      { text: 'Advanced scheduling & batch queue', icon: <CalendarClock size={11} />, highlight: true },
      { text: 'AI viral titles, SEO tags & hashtags', icon: <Zap size={11} /> },
      { text: 'Enhanced algorithm safety (per-clip seed randomisation)', icon: <Shield size={11} />, highlight: true },
      { text: 'Ultra-priority rendering — first in queue', icon: <Gauge size={11} />, highlight: true },
      { text: 'Analytics dashboard', icon: <BarChart2 size={11} /> },
      { text: 'API access for automation', icon: <Infinity size={11} />, highlight: true },
      { text: 'Dedicated Slack support' },
    ],
  },
];

const COLOR = {
  neutral: {
    border: 'border-white/[0.1]',
    borderActive: 'border-slate-400/50',
    bg: 'bg-white/[0.02]',
    bgActive: 'bg-slate-500/[0.06]',
    badge: '',
    btnPrimary: 'bg-white/[0.1] hover:bg-white/[0.16] text-white border border-white/[0.1]',
    btnSecondary: 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white border border-white/[0.06]',
    checkActive: 'text-slate-300',
    checkInactive: 'text-slate-500',
    pill: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    current: 'bg-slate-600 text-white',
  },
  sky: {
    border: 'border-sky-500/20',
    borderActive: 'border-sky-400/60',
    bg: 'bg-sky-500/[0.03]',
    bgActive: 'bg-sky-500/[0.07] shadow-[0_0_24px_rgba(14,165,233,0.12)]',
    badge: '',
    btnPrimary: 'bg-gradient-to-r from-sky-600 to-cyan-500 hover:from-sky-500 hover:to-cyan-400 text-white shadow-lg shadow-sky-900/30',
    btnSecondary: 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white border border-white/[0.06]',
    checkActive: 'text-sky-400',
    checkInactive: 'text-slate-600',
    pill: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    current: 'bg-sky-500 text-white',
  },
  amber: {
    border: 'border-amber-500/20',
    borderActive: 'border-amber-400/60',
    bg: 'bg-amber-500/[0.02]',
    bgActive: 'bg-amber-500/[0.06] shadow-[0_0_24px_rgba(245,158,11,0.10)]',
    badge: '',
    btnPrimary: 'bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white shadow-lg shadow-amber-900/30',
    btnSecondary: 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white border border-white/[0.06]',
    checkActive: 'text-amber-400',
    checkInactive: 'text-slate-600',
    pill: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    current: 'bg-amber-500 text-black',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface UpgradeModalProps {
  currentPlan: PlanTier;
  onClose: () => void;
  onSelectPlan: (plan: PlanTier) => void;
  onPurchasePlan: (plan: PlanTier) => Promise<void>;
  userId: string;
}

type PaymentMethod = 'upi' | 'card';
type GatewayState = { planId: PlanTier; method: PaymentMethod } | null;

// Razorpay script loader — idempotent, safe to call multiple times
function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src*="checkout.razorpay.com"]')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
    document.head.appendChild(script);
  });
}

const PLAN_PAISE: Partial<Record<PlanTier, number>> = {
  creator: 49900,
  pro:     99900,
};

export default function UpgradeModal({
  currentPlan,
  onClose,
  onPurchasePlan,
  userId,
}: UpgradeModalProps) {
  const { user } = useAuth();
  const [gateway, setGateway] = useState<GatewayState>(null);

  async function handlePay(planId: PlanTier, method: PaymentMethod) {
    setGateway({ planId, method });

    try {
      await loadRazorpayScript();
    } catch {
      // Script failed to load — fall through to simulated flow
    }

    const plan = PLAN_DEFS.find(p => p.id === planId)!;
    const amount = PLAN_PAISE[planId] ?? 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Razorpay = (window as any).Razorpay;

    const razorpayKey = (import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined) ?? '';

    // Only open real Razorpay checkout when key starts with "rzp_"
    const keyIsValid = typeof razorpayKey === 'string' && razorpayKey.startsWith('rzp_');

    if (typeof Razorpay === 'function' && keyIsValid) {
      const planKeyMap: Partial<Record<PlanTier, string>> = {
        creator: 'plan_creator',
        pro: 'plan_pro',
      };
      const rzp = new Razorpay({
        key: razorpayKey,
        amount,
        currency: 'INR',
        name: 'TrendCutFlow',
        description: plan.name,
        prefill: {
          name:  user?.name  ?? '',
          email: user?.email ?? '',
        },
        notes: {
          user_id: userId,
          plan_key: planKeyMap[planId] ?? planId,
        },
        theme: { color: '#0EA5E9' },
        modal: {
          ondismiss: () => setGateway(null),
        },
        handler: async (response: { razorpay_payment_id?: string }) => {
          if (response.razorpay_payment_id) {
            await onPurchasePlan(planId);
          } else {
            setGateway(null);
          }
        },
      });
      rzp.open();
    } else {
      // Simulation path: no valid Razorpay key configured
      await onPurchasePlan(planId);
    }
  }

  const isLoading = gateway !== null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={(e) => { if (!isLoading && e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />

      {/* Sheet */}
      <div className="relative w-full max-w-4xl glass border border-white/[0.09] rounded-2xl shadow-2xl shadow-black/70 overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Zap size={16} className="text-sky-400" />
              <h2 className="text-white text-xl font-bold">Choose Your Plan</h2>
            </div>
            <p className="text-slate-400 text-sm">
              Unlock more processing credits · All plans include AI subtitle generation
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-slate-400 hover:text-white transition-colors disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Plan cards */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLAN_DEFS.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const c = COLOR[plan.color];
            const isThisLoading = isLoading && gateway?.planId === plan.id;

            return (
              <div
                key={plan.id}
                className={`relative rounded-xl border flex flex-col transition-all duration-300 overflow-hidden ${
                  isCurrent
                    ? `${c.borderActive} ${c.bgActive}`
                    : `${c.border} ${c.bg} hover:${c.borderActive}`
                }`}
              >
                {/* Popular pill */}
                {plan.popular && !isCurrent && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-500 to-cyan-400" />
                )}
                {plan.popular && (
                  <div className={`absolute -top-px left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-b-lg text-[10px] font-bold tracking-wider ${
                    isCurrent ? c.current : 'bg-gradient-to-r from-sky-500 to-cyan-400 text-white'
                  }`}>
                    {isCurrent ? 'CURRENT PLAN' : 'MOST POPULAR'}
                  </div>
                )}
                {isCurrent && !plan.popular && (
                  <div className={`absolute -top-px left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-b-lg text-[10px] font-bold tracking-wider ${c.current}`}>
                    CURRENT PLAN
                  </div>
                )}

                <div className="p-5 flex flex-col flex-1">
                  {/* Title + credits badge */}
                  <div className="mb-1 mt-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-white font-bold text-base">{plan.name}</h3>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.pill}`}>
                        {plan.credits} credit{plan.credits > 1 ? 's' : ''}
                      </span>
                    </div>
                    <p className="text-slate-500 text-[11px] mt-0.5">{plan.tagline}</p>
                  </div>

                  {/* Price */}
                  <div className="my-3 flex items-baseline gap-1">
                    <span className="text-white text-3xl font-extrabold tracking-tight">{plan.price}</span>
                    {plan.priceRaw > 0 && (
                      <span className="text-slate-500 text-xs">/month</span>
                    )}
                  </div>

                  {/* Feature list */}
                  <ul className="flex-1 space-y-1.5 mb-5">
                    {plan.features.map((feat, fi) => (
                      <li key={fi} className={`flex items-start gap-2 text-xs leading-tight ${
                        feat.highlight ? 'text-white' : 'text-slate-400'
                      }`}>
                        <span className={`mt-0.5 flex-shrink-0 ${isCurrent || plan.priceRaw === 0 ? c.checkInactive : c.checkActive}`}>
                          {feat.icon
                            ? <span>{feat.icon}</span>
                            : <Check size={11} />
                          }
                        </span>
                        <span>{feat.text}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA buttons */}
                  {plan.priceRaw > 0 ? (
                    isCurrent ? (
                      <div className={`py-2.5 rounded-lg text-center text-xs font-semibold border ${c.pill}`}>
                        Active Plan
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* UPI */}
                        <button
                          onClick={() => handlePay(plan.id, 'upi')}
                          disabled={isLoading}
                          className={`relative w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 overflow-hidden ${c.btnPrimary} disabled:opacity-60 disabled:cursor-not-allowed`}
                        >
                          {isThisLoading && gateway?.method === 'upi' ? (
                            <GatewayLoading />
                          ) : (
                            <>
                              <Smartphone size={14} />
                              Pay via UPI
                            </>
                          )}
                        </button>
                        {/* Card */}
                        <button
                          onClick={() => handlePay(plan.id, 'card')}
                          disabled={isLoading}
                          className={`w-full py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${c.btnSecondary} disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {isThisLoading && gateway?.method === 'card' ? (
                            <GatewayLoading small />
                          ) : (
                            <>
                              <CreditCard size={12} />
                              Credit / Debit Card
                            </>
                          )}
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="py-2.5 rounded-lg text-center text-xs font-medium text-slate-600 border border-white/[0.04] bg-white/[0.01]">
                      {isCurrent ? 'Active Plan' : 'Free — No card needed'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <Lock size={11} className="text-slate-500" />
            Secured by Razorpay
          </span>
          <span>UPI · Cards · Net Banking · Wallets</span>
          <span>Cancel anytime · No hidden charges</span>
          <span className="flex items-center gap-1.5">
            <Shield size={11} className="text-slate-500" />
            256-bit SSL encryption
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Gateway loading indicator ────────────────────────────────────────────────

function GatewayLoading({ small = false }: { small?: boolean }) {
  return (
    <span className={`flex items-center gap-2 ${small ? 'text-xs' : 'text-sm'}`}>
      <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
      Redirecting to secure gateway…
    </span>
  );
}
