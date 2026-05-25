import { useState } from 'react';
import { X, Settings, Bell, Monitor, Moon, Volume2, VolumeX } from 'lucide-react';

interface PreferencesModalProps {
  onClose: () => void;
}

export default function PreferencesModal({ onClose }: PreferencesModalProps) {
  const [emailNotifs, setEmailNotifs]   = useState(() => localStorage.getItem('pref_email_notifs') !== 'false');
  const [soundFx, setSoundFx]           = useState(() => localStorage.getItem('pref_sound_fx') !== 'false');
  const [autoExport, setAutoExport]     = useState(() => localStorage.getItem('pref_auto_export') === 'true');
  const [defaultPreset, setDefaultPreset] = useState(() => localStorage.getItem('pref_default_preset') ?? 'hormozi');

  function saveAndClose() {
    localStorage.setItem('pref_email_notifs', String(emailNotifs));
    localStorage.setItem('pref_sound_fx', String(soundFx));
    localStorage.setItem('pref_auto_export', String(autoExport));
    localStorage.setItem('pref_default_preset', defaultPreset);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-md glass border border-white/[0.09] rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-500/15 border border-slate-500/25 flex items-center justify-center">
              <Settings size={15} className="text-slate-400" />
            </div>
            <div>
              <h2 className="text-white text-sm font-bold">Preferences</h2>
              <p className="text-slate-500 text-[11px]">Customize your experience</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Notifications */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Bell size={12} className="text-slate-500" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Notifications</span>
            </div>
            <div className="space-y-2">
              <ToggleRow
                label="Email notifications"
                description="Receive updates about your processed videos"
                value={emailNotifs}
                onChange={setEmailNotifs}
              />
              <ToggleRow
                label="Sound effects"
                description="Play sounds on processing complete"
                value={soundFx}
                onChange={setSoundFx}
                icon={soundFx ? <Volume2 size={13} className="text-slate-400" /> : <VolumeX size={13} className="text-slate-500" />}
              />
            </div>
          </div>

          {/* Editor */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Monitor size={12} className="text-slate-500" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Editor</span>
            </div>
            <div className="space-y-2">
              <ToggleRow
                label="Auto-start export after processing"
                description="Immediately begin trimming clips when pipeline completes"
                value={autoExport}
                onChange={setAutoExport}
              />
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-xs font-medium">Default subtitle style</p>
                    <p className="text-slate-500 text-[10px] mt-0.5">Applied to new clips automatically</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {(['hormozi', 'minimalist', 'cyberpunk'] as const).map(preset => (
                    <button
                      key={preset}
                      onClick={() => setDefaultPreset(preset)}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border capitalize transition-all ${
                        defaultPreset === preset
                          ? preset === 'hormozi'
                            ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300'
                            : preset === 'cyberpunk'
                            ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                            : 'bg-white/10 border-white/20 text-white'
                          : 'bg-white/[0.03] border-white/[0.06] text-slate-500 hover:text-white hover:bg-white/[0.07]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Appearance note */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <Moon size={13} className="text-slate-600 flex-shrink-0" />
            <p className="text-slate-600 text-[11px]">Dark mode is always on — it's the only way to see viral shorts.</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveAndClose}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-slate-600 to-slate-500 text-white text-sm font-semibold hover:opacity-90 transition-all"
            >
              Save Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
  icon,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] cursor-pointer hover:bg-white/[0.05] transition-colors"
      onClick={() => onChange(!value)}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="mt-0.5 flex-shrink-0">{icon}</span>}
        <div>
          <p className="text-white text-xs font-medium">{label}</p>
          <p className="text-slate-500 text-[10px] mt-0.5">{description}</p>
        </div>
      </div>
      <div
        className={`w-9 h-5 rounded-full flex-shrink-0 relative transition-colors duration-200 ${value ? 'bg-sky-500' : 'bg-slate-700'}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ${value ? 'left-4' : 'left-0.5'}`} />
      </div>
    </div>
  );
}
