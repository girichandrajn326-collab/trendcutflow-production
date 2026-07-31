// Google OAuth token management — persists tokens in Supabase integrations table.
// Tokens are stored per user per provider. Access tokens are short-lived (1h);
// refresh tokens live forever.
//
// The YouTube OAuth flow (authorize / callback / refresh / upload) was previously
// proxied through the `youtube-oauth` Supabase Edge Function. That function is
// unreachable from the custom domain due to persistent CORS errors, so the
// client now talks to Google's OAuth2 endpoints directly. The YouTube Data API
// upload is also performed client-side using the access token.

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

// Refresh access token via Google OAuth2 endpoint (direct browser call).
export async function refreshAccessToken(userId: string, provider: 'youtube' | 'google'): Promise<RefreshResult> {
  const stored = await loadStoredToken(userId, provider);
  if (!stored) return { success: false, error: 'No stored token found' };

  if (!tokenNeedsRefresh(stored)) {
    return { success: true, newAccessToken: stored.accessToken, newExpiresAt: stored.expiresAt };
  }

  const clientId = import.meta.env.VITE_YOUTUBE_CLIENT_ID as string | undefined;
  const clientSecret = import.meta.env.VITE_YOUTUBE_CLIENT_SECRET as string | undefined;
  if (!clientId || !clientSecret) {
    return { success: false, error: 'YouTube OAuth client credentials are not configured. Add VITE_YOUTUBE_CLIENT_ID and VITE_YOUTUBE_CLIENT_SECRET to your environment.' };
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: stored.refreshToken,
        grant_type: 'refresh_token',
      }),
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

// Initiate YouTube OAuth flow — opens Google consent screen in a popup.
// Uses the client-side OAuth flow (no edge function proxy).
export function initiateYouTubeOAuth(userId: string): void {
  const clientId = import.meta.env.VITE_YOUTUBE_CLIENT_ID as string | undefined;
  if (!clientId) {
    console.error('VITE_YOUTUBE_CLIENT_ID is not configured');
    return;
  }

  const redirectUri = `${window.location.origin}/youtube-callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube',
    access_type: 'offline',
    prompt: 'consent',
    state: userId,
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  window.open(authUrl, 'youtube_oauth', 'width=600,height=700,scrollbars=yes');
}

// Exchange authorization code for tokens (called from the OAuth callback handler).
// Uses the client-side OAuth flow.
export async function exchangeCodeForTokens(
  code: string,
  userId: string,
): Promise<RefreshResult> {
  const clientId = import.meta.env.VITE_YOUTUBE_CLIENT_ID as string | undefined;
  const clientSecret = import.meta.env.VITE_YOUTUBE_CLIENT_SECRET as string | undefined;
  if (!clientId || !clientSecret) {
    return { success: false, error: 'YouTube OAuth client credentials are not configured.' };
  }

  const redirectUri = `${window.location.origin}/youtube-callback`;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: err };
    }

    const result = await res.json();
    const token: OAuthToken = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000,
      scope: result.scope ?? 'youtube',
      provider: 'youtube',
    };
    await storeRefreshToken(userId, token);

    return { success: true, newAccessToken: token.accessToken, newExpiresAt: token.expiresAt };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
