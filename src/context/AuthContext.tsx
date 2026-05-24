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
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  signup: (name: string, email: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
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
  });

  // Hydrate from existing Supabase session on mount, then listen for changes.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      hydrateFromSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      hydrateFromSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  function hydrateFromSession(session: Session | null) {
    if (session?.user) {
      setAuthState({
        user: supabaseUserToAuthUser(session.user),
        isAuthenticated: true,
        isLoading: false,
      });
    } else {
      setAuthState({ user: null, isAuthenticated: false, isLoading: false });
    }
  }

  const login = useCallback(async (email: string, password: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('invalid login') || msg.includes('credentials')) {
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
      if (error.message.toLowerCase().includes('already registered')) {
        return { error: 'An account with this email already exists. Please sign in instead.' };
      }
      return { error: error.message };
    }

    if (data.user) {
      await supabase.from('users').insert({
        id: data.user.id,
        email,
        name,
        current_plan: 'FREE',
        total_credits: 1,
        credits_used: 0,
      });
    }

    return { error: null };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthState({ user: null, isAuthenticated: false, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...authState, login, signup, logout }}>
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
