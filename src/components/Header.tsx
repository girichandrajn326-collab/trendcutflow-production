import { useRef, useEffect } from 'react';
import { Zap, ChevronDown, User, LogOut, CreditCard, Settings, TrendingUp } from 'lucide-react';
import type { AppState } from '../store/appStore';

interface HeaderProps {
  state: AppState;
  onOpenUpgradeModal: () => void;
  onToggleAccountDropdown: () => void;
  onCloseAccountDropdown: () => void;
  onNavigateHome: () => void;
  onLogout: () => void;
}

export default function Header({
  state,
  onOpenUpgradeModal,
  onToggleAccountDropdown,
  onCloseAccountDropdown,
  onNavigateHome,
  onLogout,
}: HeaderProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { user, isAccountDropdownOpen } = state;
  const creditPct = (user.videosProcessed / Math.max(user.totalCredits, 1)) * 100;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onCloseAccountDropdown();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCloseAccountDropdown]);

  const planBadgeColor = {
    free:    'text-slate-400 border-slate-600/60',
    creator: 'text-sky-400 border-sky-500/40',
    pro:     'text-amber-400 border-amber-500/40',
  }[user.plan];

  const planName = {
    free:    'Free',
    creator: 'Creator Flow',
    pro:     'Pro Flow',
  }[user.plan];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass-dark border-b border-white/[0.06]">
      <div className="max-w-screen-xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={onNavigateHome}
          className="flex items-center gap-3 group"
        >
          <div className="relative">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center shadow-lg group-hover:shadow-violet-500/40 transition-shadow duration-300">
              <TrendingUp size={16} className="text-white" />
            </div>
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 opacity-0 group-hover:opacity-30 blur-md transition-opacity duration-300" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-white font-bold text-[15px] tracking-tight">TrendCutFlow</span>
            <span className="text-[10px] text-slate-500 font-medium tracking-wide mt-0.5">Long Video In. Viral Shorts Out.</span>
          </div>
        </button>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Upgrade button */}
          {user.plan !== 'pro' && (
            <button
              onClick={onOpenUpgradeModal}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-sky-600/20 to-cyan-500/20 border border-sky-500/30 hover:border-sky-500/60 text-sky-300 hover:text-sky-200 text-xs font-semibold transition-all duration-200 hover:shadow-[0_0_12px_rgba(14,165,233,0.3)]"
            >
              <Zap size={12} />
              Upgrade
            </button>
          )}

          {/* Account dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={onToggleAccountDropdown}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/[0.08] hover:border-white/[0.15] transition-all duration-200 group"
            >
              {/* Avatar */}
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/80 to-cyan-500/80 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {user.avatarInitials}
              </div>
              <div className="hidden sm:flex flex-col items-start leading-none">
                <span className="text-white text-xs font-medium">{user.name}</span>
                <span className={`text-[10px] font-medium border rounded px-1 mt-0.5 ${planBadgeColor}`}>
                  {planName}
                </span>
              </div>
              <ChevronDown
                size={14}
                className={`text-slate-400 transition-transform duration-200 ${isAccountDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Dropdown */}
            {isAccountDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 glass border border-white/[0.1] rounded-xl shadow-2xl shadow-black/50 animate-slide-up overflow-hidden">
                {/* User info */}
                <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      {user.avatarInitials}
                    </div>
                    <div>
                      <div className="text-white text-sm font-semibold">{user.name}</div>
                      <div className="text-slate-400 text-xs">{user.email}</div>
                    </div>
                  </div>

                  {/* Credit usage */}
                  <div className="mt-3">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs text-slate-400 font-medium">Processing Credits</span>
                      <span className={`text-xs font-bold ${creditPct >= 100 ? 'text-red-400' : 'text-white'}`}>
                        {user.videosProcessed} / {user.totalCredits} used
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(creditPct, 100)}%`,
                          background: creditPct >= 100
                            ? 'linear-gradient(90deg, #ef4444, #f87171)'
                            : creditPct >= 70
                            ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                            : 'linear-gradient(90deg, #8B5CF6, #06B6D4)',
                        }}
                      />
                    </div>
                    {creditPct >= 100 && (
                      <p className="text-red-400 text-[10px] mt-1.5">Credit limit reached. Upgrade to continue.</p>
                    )}
                  </div>
                </div>

                {/* Menu items */}
                <div className="p-2">
                  <DropdownItem icon={<User size={14} />} label="Profile Settings" />
                  <DropdownItem icon={<CreditCard size={14} />} label="Billing & Plans" onClick={onOpenUpgradeModal} />
                  <DropdownItem icon={<Settings size={14} />} label="Preferences" />
                </div>

                {/* Upgrade CTA if not pro */}
                {user.plan !== 'pro' && (
                  <div className="px-3 pb-3">
                    <button
                      onClick={onOpenUpgradeModal}
                      className="w-full py-2 rounded-lg bg-gradient-to-r from-sky-600 to-cyan-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 shadow-lg shadow-sky-900/30"
                    >
                      <Zap size={12} />
                      Upgrade Plan
                    </button>
                  </div>
                )}

                <div className="border-t border-white/[0.06] p-2">
                  <DropdownItem icon={<LogOut size={14} />} label="Sign Out" danger onClick={onLogout} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function DropdownItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-150 ${
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
      }`}
    >
      <span className={danger ? 'text-red-400' : 'text-slate-400'}>{icon}</span>
      {label}
    </button>
  );
}
