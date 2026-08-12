import { useRef, useEffect } from 'react';
import { ChevronDown, User, LogOut, Settings, TrendingUp, Clock } from 'lucide-react';
import type { AppState } from '../store/appStore';

interface HeaderProps {
  state: AppState;
  onToggleAccountDropdown: () => void;
  onCloseAccountDropdown: () => void;
  onNavigateHome: () => void;
  onNavigateHistory: () => void;
  onLogout: () => void;
  onOpenProfile?: () => void;
  onOpenPreferences?: () => void;
}

export default function Header({
  state,
  onToggleAccountDropdown,
  onCloseAccountDropdown,
  onNavigateHome,
  onNavigateHistory,
  onLogout,
  onOpenProfile,
  onOpenPreferences,
}: HeaderProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { user, isAccountDropdownOpen } = state;

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
  }[user?.plan ?? 'free'];

  const planName = {
    free:    'Free',
    creator: 'Creator Flow',
    pro:     'Pro Flow',
  }[user?.plan ?? 'free'] ?? 'Free';

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
          {/* History button */}
          <button
            onClick={onNavigateHistory}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] hover:border-white/[0.14] text-slate-400 hover:text-white text-xs font-medium transition-all duration-200"
          >
            <Clock size={12} />
            History
          </button>

          {/* Account dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={onToggleAccountDropdown}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/[0.08] hover:border-white/[0.15] transition-all duration-200 group"
            >
              {/* Avatar */}
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/80 to-cyan-500/80 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {user?.avatarInitials ?? '?'}
              </div>
              <div className="hidden sm:flex flex-col items-start leading-none">
                <span className="text-white text-xs font-medium">{user?.name ?? 'User'}</span>
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
                      {user?.avatarInitials ?? '?'}
                    </div>
                    <div>
                      <div className="text-white text-sm font-semibold">{user?.name ?? 'User'}</div>
                      <div className="text-slate-400 text-xs">{user?.email ?? ''}</div>
                    </div>
                  </div>

                </div>

                {/* Menu items */}
                <div className="p-2">
                  <DropdownItem icon={<User size={14} />} label="Profile Settings" onClick={onOpenProfile} />
                  <DropdownItem icon={<Settings size={14} />} label="Preferences" onClick={onOpenPreferences} />
                </div>

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
