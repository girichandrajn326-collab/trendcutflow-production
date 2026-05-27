import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Session, User } from '@supabase/supabase-js';
import { isDisposableEmail } from '../lib/emailBlocklist';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsPasswordReset: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  signup: (name: string, email: string, password: string) => Promise<{ error: string | null; emailConfirmationRequired?: boolean }>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  clearPasswordResetFlag: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

function supabaseUserToAuthUser(user: User): AuthUser {
  const meta = user.user_metadata as Record<string, string> | undefined;
  const name = meta?.full_name ?? meta?.name ?? user.email?.split('@')[0] ?? 'User';
  return { id: user.id, email: user.email ?? '', name };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    needsPasswordReset: false,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      hydrateFromSession('INITIAL_SESSION', session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      hydrateFromSession(event, session);
    });

    return () => subscription.unsubscribe();
  }, []);

  function hydrateFromSession(event: string, session: Session | null) {
    // When Supabase processes a password-reset link it fires PASSWORD_RECOVERY.
    // Hold the app in a "must set new password" state until the user submits.
    if (event === 'PASSWORD_RECOVERY') {
      setAuthState({
        user: session?.user ? supabaseUserToAuthUser(session.user) : null,
        isAuthenticated: false, // block normal app access
        isLoading: false,
        needsPasswordReset: true,
      });
      return;
    }

    if (session?.user) {
      setAuthState({
        user: supabaseUserToAuthUser(session.user),
        isAuthenticated: true,
        isLoading: false,
        needsPasswordReset: false,
      });
    } else {
      setAuthState({ user: null, isAuthenticated: false, isLoading: false, needsPasswordReset: false });
    }
  }

  const clearPasswordResetFlag = useCallback(() => {
    setAuthState(s => ({ ...s, needsPasswordReset: false }));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('invalid login') || msg.includes('credentials') || msg.includes('invalid')) {
        return { error: 'Incorrect email or password. Please try again.' };
      }
      return { error: error.message };
    }
    return { error: null };
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string): Promise<{ error: string | null }> => {
    if (isDisposableEmail(email)) {
      return { error: 'Please use a permanent business or personal email address to claim your free video credits.' };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('unique')) {
        return { error: 'An account with this email already exists. Please sign in instead.' };
      }
      return { error: error.message };
    }

    // When email confirmation is enabled, session is null until the user
    // clicks the verification link. Signal this to the UI so it can show
    // a "check your inbox" state instead of trying to enter the app.
    if (!data.session) {
      return { error: null, emailConfirmationRequired: true };
    }

    // Profile row is created automatically by the handle_new_user trigger.
    return { error: null };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthState({ user: null, isAuthenticated: false, isLoading: false });
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // redirectTo must point back to the app origin so the hash fragment
      // with type=recovery is processed by our onAuthStateChange listener.
      redirectTo: window.location.origin,
    });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  return (
    <AuthContext.Provider value={{ ...authState, login, signup, logout, resetPassword, clearPasswordResetFlag }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
