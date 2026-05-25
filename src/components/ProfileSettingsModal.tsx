import { useState, useRef, useEffect } from 'react';
import { X, User, Mail, Save, Loader2 } from 'lucide-react';
import type { UserAccount } from '../store/appStore';
import { supabase } from '../lib/supabase';

interface ProfileSettingsModalProps {
  user: UserAccount;
  onClose: () => void;
  onSaved: (name: string) => void;
}

export default function ProfileSettingsModal({ user, onClose, onSaved }: ProfileSettingsModalProps) {
  const [name, setName]         = useState(user.name);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const inputRef                = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Name cannot be empty.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { error: authErr } = await supabase.auth.updateUser({ data: { full_name: trimmed } });
      if (authErr) throw authErr;
      onSaved(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
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
            <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/25 flex items-center justify-center">
              <User size={15} className="text-sky-400" />
            </div>
            <div>
              <h2 className="text-white text-sm font-bold">Profile Settings</h2>
              <p className="text-slate-500 text-[11px]">Update your display name</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          {/* Email (read-only) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400 pl-1">Email Address</label>
            <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-slate-800/40 border border-white/[0.06] opacity-60">
              <Mail size={14} className="text-slate-500 flex-shrink-0" />
              <span className="text-slate-400 text-sm">{user.email}</span>
            </div>
            <p className="text-slate-600 text-[11px] pl-1">Email cannot be changed here.</p>
          </div>

          {/* Display name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400 pl-1">Display Name</label>
            <div className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-slate-800/60 border transition-colors ${error ? 'border-red-500/40' : 'border-white/[0.08] focus-within:border-sky-500/50'}`}>
              <User size={14} className="text-slate-500 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setError(null); }}
                placeholder="Your full name"
                className="flex-1 bg-transparent text-white text-sm outline-none placeholder-slate-600"
              />
            </div>
            {error && <p className="text-red-400 text-[11px] pl-1">{error}</p>}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || name.trim() === user.name}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-sky-900/20"
            >
              {saving ? <><Loader2 size={14} className="animate-spin" />Saving…</> : <><Save size={14} />Save Changes</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
