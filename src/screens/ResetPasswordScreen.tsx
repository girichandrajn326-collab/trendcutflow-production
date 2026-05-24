import { useState, useEffect } from 'react';
import { TrendingUp, Lock, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function ResetPasswordScreen() {
  const [password, setPassword]         = useState('');
  const [confirm, setConfirm]           = useState('');
  const [showPw, setShowPw]             = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [done, setDone]                 = useState(false);

  // Supabase sends the user back with a hash fragment — exchange it for a session
  useEffect(() => {
    supabase.auth.getSession(); // triggers PKCE exchange from URL hash automatically
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setDone(true);
      // Redirect to app after short delay
      setTimeout(() => {
        window.location.href = '/';
      }, 2500);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[#060A12]">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-sky-700/[0.07] rounded-full blur-[120px] pointer-events-none" />

      <div className="relative w-full max-w-md mx-4">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center shadow-2xl shadow-sky-900/50">
              <TrendingUp size={22} className="text-white" />
            </div>
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 blur-xl opacity-40" />
          </div>
          <h1 className="text-white text-2xl font-bold tracking-tight">TrendCutFlow</h1>
        </div>

        <div className="bg-slate-900/80 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/60 p-6 space-y-4">
          <div>
            <h2 className="text-white text-lg font-bold">Set a new password</h2>
            <p className="text-slate-500 text-xs mt-0.5">Choose something strong — at least 6 characters</p>
          </div>

          {done ? (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/25">
              <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-emerald-300 text-sm font-semibold">Password updated!</p>
                <p className="text-emerald-400/70 text-xs mt-0.5">Redirecting you to the app…</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {error && (
                <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/25">
                  <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">{error}</p>
                </div>
              )}

              {/* New password */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400 pl-1">New Password</label>
                <div className="input-field">
                  <Lock size={15} className="text-slate-500" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    className="auth-input"
                  />
                  <button type="button" onClick={() => setShowPw(p => !p)} className="text-slate-600 hover:text-slate-300 transition-colors" tabIndex={-1}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Confirm */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400 pl-1">Confirm Password</label>
                <div className={`input-field ${confirm && confirm !== password ? 'input-field--error' : ''}`}>
                  <Lock size={15} className={confirm && confirm !== password ? 'text-red-400/70' : 'text-slate-500'} />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repeat new password"
                    autoComplete="new-password"
                    className="auth-input"
                  />
                </div>
                {confirm && confirm !== password && (
                  <p className="text-red-400 text-[11px] pl-1 flex items-center gap-1">
                    <AlertCircle size={11} /> Passwords do not match
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-500 text-white text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-sky-900/30"
              >
                {isSubmitting
                  ? <><Loader2 size={16} className="animate-spin" />Updating…</>
                  : <>Update Password <ArrowRight size={15} /></>}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
