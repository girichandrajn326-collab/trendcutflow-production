import { TrendingUp } from 'lucide-react';

interface FooterProps {
  onNavigate?: (page: string) => void;
}

const LEGAL_LINKS = [
  { label: 'Terms & Conditions', page: 'terms' },
  { label: 'Privacy Policy',     page: 'privacy' },
  { label: 'Refund & Cancellation', page: 'refund' },
  { label: 'Contact Us',         page: 'contact' },
];

export default function Footer({ onNavigate }: FooterProps) {
  return (
    <footer className="border-t border-white/[0.06] bg-[#080C13]/80 mt-auto">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center">
              <TrendingUp size={14} className="text-white" />
            </div>
            <span className="text-white font-semibold text-sm tracking-tight">TrendCutFlow</span>
          </div>

          {/* Legal links */}
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {LEGAL_LINKS.map(({ label, page }) => (
              <button
                key={page}
                onClick={() => onNavigate?.(page)}
                className="text-slate-500 hover:text-slate-300 text-xs transition-colors duration-200"
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Copyright */}
          <p className="text-slate-600 text-xs text-center md:text-right">
            &copy; {new Date().getFullYear()} TrendCutFlow. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
