// Google OAuth token management — persists tokens encrypted in Supabase integrations table.
// Tokens are stored per user per provider. Access tokens are short-lived (1h); refresh tokens live forever.

import { supabase } from './supabase';

export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
  scope: string;
  provider: 'youtube' | 'google';
}

export interface RefreshResult {
  success: boolean;
  newAccessToken?: string;
  newExpiresAt?: number;
  error?: string;
}

// Store/update OAuth token in Supabase integrations table
export async function storeRefreshToken(userId: string, token: OAuthToken): Promise<void> {
  const payload = JSON.stringify({
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    scope: token.scope,
  });

  const { error } = await supabase
    .from('integrations')
    .upsert(
      {
        user_id: userId,
        platform: token.provider,
        encrypted_refresh_token: payload,
      },
      { onConflict: 'user_id,platform' },
    );

  if (error) throw new Error(`storeRefreshToken failed: ${error.message}`);
}

// Load stored token for a user + provider
export async function loadStoredToken(userId: string, provider: 'youtube' | 'google'): Promise<OAuthToken | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('encrypted_refresh_token')
    .eq('user_id', userId)
    .eq('platform', provider)
    .maybeSingle();

  if (error || !data) return null;

  try {
    const parsed = JSON.parse(data.encrypted_refresh_token);
    return { ...parsed, provider };
  } catch {
    return null;
  }
}

// Refresh access token via Google OAuth2 endpoint.
// Calls the youtube-oauth Edge Function to keep client_secret server-side.
export async function refreshAccessToken(userId: string, provider: 'youtube' | 'google'): Promise<RefreshResult> {
  const stored = await loadStoredToken(userId, provider);
  if (!stored) return { success: false, error: 'No stored token found' };

  if (!tokenNeedsRefresh(stored)) {
    return { success: true, newAccessToken: stored.accessToken, newExpiresAt: stored.expiresAt };
  }

  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch(`${supabaseUrl}/functions/v1/youtube-oauth?action=refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token ?? anonKey}`,
        'Apikey': anonKey,
      },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: err };
    }

    const result = await res.json();
    const newExpiresAt = Date.now() + (result.expires_in ?? 3600) * 1000;
    const updated: OAuthToken = {
      ...stored,
      accessToken: result.access_token,
      expiresAt: newExpiresAt,
    };
    await storeRefreshToken(userId, updated);

    return { success: true, newAccessToken: result.access_token, newExpiresAt };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function tokenNeedsRefresh(token: OAuthToken): boolean {
  const fiveMinutes = 5 * 60 * 1000;
  return Date.now() >= token.expiresAt - fiveMinutes;
}

// Revoke token on user disconnect
export async function revokeOAuthToken(userId: string, provider: 'youtube' | 'google'): Promise<void> {
  const stored = await loadStoredToken(userId, provider);
  if (stored?.refreshToken) {
    // Best-effort revoke at Google
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(stored.refreshToken)}`, {
      method: 'POST',
    }).catch(() => {});
  }

  await supabase
    .from('integrations')
    .delete()
    .eq('user_id', userId)
    .eq('platform', provider);
}

// Initiate YouTube OAuth flow — opens Google consent screen in a popup
export function initiateYouTubeOAuth(userId: string): void {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const callbackUrl = `${supabaseUrl}/functions/v1/youtube-oauth?action=callback`;
  const params = new URLSearchParams({
    action: 'authorize',
    user_id: userId,
    redirect_uri: callbackUrl,
  });
  const authUrl = `${supabaseUrl}/functions/v1/youtube-oauth?${params}`;
  window.open(authUrl, 'youtube_oauth', 'width=600,height=700,scrollbars=yes');
}
