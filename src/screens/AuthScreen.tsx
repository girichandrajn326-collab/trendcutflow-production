import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, TrendingUp, Zap, Mail, Lock, User, AlertCircle, ArrowRight, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuthScreenProps {
  onSuccess: (name: string) => void;
}

type AuthTab = 'signin' | 'signup' | 'forgot';

export default function AuthScreen({ onSuccess }: AuthScreenProps) {
  const { login, signup, resetPassword } = useAuth();

  const [tab, setTab]                     = useState<AuthTab>('signin');
  const [name, setName]                   = useState('');
  const [email, setEmail]                 = useState('');
  const [password, setPassword]           = useState('');
  const [showPassword, setShowPassword]   = useState(false);
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [globalError, setGlobalError]     = useState<string | null>(null);
  const [emailError, setEmailError]       = useState<string | null>(null);
  const [nameError, setNameError]         = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [resetSent, setResetSent]         = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGlobalError(null);
    setEmailError(null);
    setNameError(null);
    setPasswordError(null);
    setResetSent(false);
  }, [tab]);

  useEffect(() => {
    emailRef.current?.focus();
  }, [tab]);

  function clearErrors() {
    setGlobalError(null);
    setEmailError(null);
    setNameError(null);
    setPasswordError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearErrors();

    if (tab === 'forgot') {
      if (!email.trim()) {
        setEmailError('Please enter your email address.');
        return;
      }
      setIsSubmitting(true);
      try {
        const { error } = await resetPassword(email.trim());
        if (error) {
          setGlobalError(error);
          return;
        }
        setResetSent(true);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    let hasError = false;
    if (tab === 'signup' && !name.trim()) {
      setNameError('Please enter your full name.');
      hasError = true;
    }
    if (!email.trim()) {
      setEmailError('Please enter your email address.');
      hasError = true;
    }
    if (!password || password.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      hasError = true;
    }
    if (hasError) return;

    setIsSubmitting(true);

    try {
      if (tab === 'signin') {
        const { error } = await login(email.trim(), password);
        if (error) {
          setGlobalError(error);
          return;
        }
        onSuccess(email.split('@')[0]);
      } else {
        const { error } = await signup(name.trim(), email.trim(), password);
        if (error) {
          if (error.toLowerCase().includes('permanent') || error.toLowerCase().includes('temporary')) {
            setEmailError(error);
          } else if (error.toLowerCase().includes('already exists') || error.toLowerCase().includes('already registered')) {
            setGlobalError(error);
          } else {
            setGlobalError(error);
          }
          return;
        }
        onSuccess(name.trim());
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[#060A12]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-sky-700/[0.08] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/3 w-[500px] h-[400px] bg-cyan-600/[0.05] rounded-full blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-md mx-4 z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center shadow-2xl shadow-sky-900/50">
              <TrendingUp size={22} className="text-white" />
            </div>
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 blur-xl opacity-40" />
          </div>
          <h1 className="text-white text-2xl font-bold tracking-tight">TrendCutFlow</h1>
          <p className="text-slate-500 text-sm mt-1">Long Video In. Viral Shorts Out.</p>
        </div>

        <div className="bg-slate-900/80 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">

          {/* Tab switcher — hidden on forgot password view */}
          {tab !== 'forgot' && (
            <div className="flex border-b border-white/[0.06]">
              {(['signin', 'signup'] as AuthTab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-4 text-sm font-semibold transition-all duration-200 relative ${
                    tab === t ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t === 'signin' ? 'Sign In' : 'Create Account'}
                  {tab === t && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-gradient-to-r from-sky-400 to-cyan-400 rounded-full" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ── Forgot password view ── */}
          {tab === 'forgot' ? (
            <form onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
              <button
                type="button"
                onClick={() => setTab('signin')}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-xs transition-colors mb-1"
              >
                <ArrowLeft size={13} />
                Back to Sign In
              </button>

              <div className="mb-1">
                <h2 className="text-white text-lg font-bold">Reset your password</h2>
                <p className="text-slate-500 text-xs mt-0.5">
                  Enter your email and we'll send you a reset link
                </p>
              </div>

              {resetSent ? (
                <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/25">
                  <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-emerald-300 text-xs font-semibold">Reset link sent!</p>
                    <p className="text-emerald-400/70 text-xs mt-0.5">
                      Check your inbox at <span className="text-emerald-300">{email}</span> and follow the instructions.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {globalError && (
                    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/25">
                      <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-red-300 text-xs leading-relaxed">{globalError}</p>
                    </div>
                  )}

                  <Field
                    label="Email Address"
                    icon={<Mail size={15} />}
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={setEmail}
                    error={emailError}
                    autoComplete="email"
                    inputRef={emailRef}
                  />

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-500 text-white text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-sky-900/30"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Sending reset link…
                      </>
                    ) : (
                      <>
                        Send Reset Link
                        <ArrowRight size={15} />
                      </>
                    )}
                  </button>
                </>
              )}

              {resetSent && (
                <button
                  type="button"
                  onClick={() => setTab('signin')}
                  className="w-full py-2.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white text-sm font-medium transition-colors"
                >
                  Back to Sign In
                </button>
              )}
            </form>
          ) : (
            /* ── Sign in / Sign up view ── */
            <form onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
              <div className="mb-1">
                <h2 className="text-white text-lg font-bold">
                  {tab === 'signin' ? 'Welcome back' : 'Get your free credits'}
                </h2>
                <p className="text-slate-500 text-xs mt-0.5">
                  {tab === 'signin'
                    ? 'Sign in to access your viral shorts workspace'
                    : 'Start with 1 free video every month — no card required'}
                </p>
              </div>

              {globalError && (
                <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/25">
                  <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs leading-relaxed">{globalError}</p>
                </div>
              )}

              {tab === 'signup' && (
                <Field
                  label="Full Name"
                  icon={<User size={15} />}
                  type="text"
                  placeholder="Alex Johnson"
                  value={name}
                  onChange={setName}
                  error={nameError}
                  autoComplete="name"
                />
              )}

              <Field
                label="Email Address"
                icon={<Mail size={15} />}
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={setEmail}
                error={emailError}
                autoComplete="email"
                inputRef={emailRef}
              />

              {/* Password + forgot link row */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between pl-1">
                  <label className="block text-xs font-medium text-slate-400">Password</label>
                  {tab === 'signin' && (
                    <button
                      type="button"
                      onClick={() => setTab('forgot')}
                      className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border bg-white/[0.03] transition-all duration-200 focus-within:border-sky-500/50 focus-within:bg-sky-500/[0.03] ${
                  passwordError
                    ? 'border-red-500/50 bg-red-500/[0.04]'
                    : 'border-white/[0.08] hover:border-white/[0.14]'
                }`}>
                  <Lock size={15} className={passwordError ? 'text-red-400/70' : 'text-slate-500'} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={tab === 'signup' ? 'At least 6 characters' : '••••••••'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                    className="flex-1 bg-transparent text-white text-sm placeholder-slate-600 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-red-400 text-[11px] pl-1 flex items-center gap-1">
                    <AlertCircle size={11} />
                    {passwordError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-500 text-white text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-sky-900/30 hover:shadow-sky-900/50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {tab === 'signin' ? 'Signing in…' : 'Creating account…'}
                  </>
                ) : (
                  <>
                    {tab === 'signin' ? 'Sign In' : 'Create Account — It\'s Free'}
                    <ArrowRight size={15} />
                  </>
                )}
              </button>

              {tab === 'signup' && (
                <div className="pt-1 flex items-start gap-2 px-1">
                  <Zap size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Free plan includes <span className="text-slate-300">1 video/month</span> with 5 AI-generated viral shorts, subtitle customization, and the delayed publish queue — no credit card needed.
                  </p>
                </div>
              )}

              <p className="text-center text-xs text-slate-600 pt-1">
                {tab === 'signin' ? (
                  <>Don't have an account?{' '}
                    <button type="button" onClick={() => setTab('signup')} className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
                      Create one free
                    </button>
                  </>
                ) : (
                  <>Already have an account?{' '}
                    <button type="button" onClick={() => setTab('signin')} className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-700 mt-5">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}

// ─── Field helper ─────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  icon: React.ReactNode;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  autoComplete?: string;
  inputRef?: React.RefObject<HTMLInputElement>;
}

function Field({ label, icon, type, placeholder, value, onChange, error, autoComplete, inputRef }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-400 pl-1">{label}</label>
      <div className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border bg-white/[0.03] transition-all duration-200 focus-within:border-sky-500/50 focus-within:bg-sky-500/[0.03] ${
        error
          ? 'border-red-500/50 bg-red-500/[0.04]'
          : 'border-white/[0.08] hover:border-white/[0.14]'
      }`}>
        <span className={error ? 'text-red-400/70' : 'text-slate-500'}>{icon}</span>
        <input
          ref={inputRef}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="flex-1 bg-transparent text-white text-sm placeholder-slate-600 outline-none"
        />
      </div>
      {error && (
        <p className="text-red-400 text-[11px] pl-1 flex items-center gap-1">
          <AlertCircle size={11} />
          {error}
        </p>
      )}
    </div>
  );
}
