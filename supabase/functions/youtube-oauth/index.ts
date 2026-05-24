// Edge Function: youtube-oauth
// Handles the full YouTube OAuth2 flow server-side:
//   GET  ?action=authorize   → redirect to Google consent screen
//   GET  ?action=callback    → exchange code for tokens, store in DB, close popup
//   POST ?action=refresh     → refresh an access token using a stored refresh token
//   POST ?action=upload      → upload a video blob to YouTube Shorts

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    const CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID");
    const CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");

    // ── authorize: redirect to Google consent ────────────────────────────────
    if (action === "authorize") {
      if (!CLIENT_ID) return json({ error: "YOUTUBE_CLIENT_ID not configured" }, 500);

      const redirectUri = url.searchParams.get("redirect_uri") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/youtube-oauth?action=callback`;
      const userId = url.searchParams.get("user_id") ?? "";

      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube.upload",
        access_type: "offline",
        prompt: "consent",
        state: userId,
      });

      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
    }

    // ── callback: exchange code → tokens, persist, close popup ───────────────
    if (action === "callback") {
      if (!CLIENT_ID || !CLIENT_SECRET) {
        return htmlClose("YouTube OAuth not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET secrets.");
      }

      const code = url.searchParams.get("code");
      const userId = url.searchParams.get("state");

      if (!code || !userId) {
        return htmlClose("Missing OAuth code or user_id.");
      }

      const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/youtube-oauth?action=callback`;

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return htmlClose(`Token exchange failed: ${err}`);
      }

      const tokens = await tokenRes.json();
      const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      await supabase.from("integrations").upsert({
        user_id: userId,
        platform: "youtube",
        encrypted_refresh_token: JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt,
          scope: tokens.scope ?? "",
        }),
      }, { onConflict: "user_id,platform" });

      return htmlClose("YouTube connected successfully! You can close this window.");
    }

    // ── refresh: exchange refresh_token → new access_token ───────────────────
    if (req.method === "POST" && action === "refresh") {
      if (!CLIENT_ID || !CLIENT_SECRET) {
        return json({ error: "YouTube OAuth not configured" }, 500);
      }

      const body = await req.json();
      const refreshToken: string = body.refreshToken;
      if (!refreshToken) return json({ error: "Missing refreshToken" }, 400);

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return json({ error: `Refresh failed: ${err}` }, 502);
      }

      const data = await tokenRes.json();
      return json({
        access_token: data.access_token,
        expires_in: data.expires_in ?? 3600,
      });
    }

    // ── upload: upload video to YouTube as a Short ────────────────────────────
    if (req.method === "POST" && action === "upload") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Unauthorized" }, 401);

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: { user }, error: authErr } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", ""),
      );
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);

      // Load stored access token
      const { data: integration } = await supabase
        .from("integrations")
        .select("encrypted_refresh_token")
        .eq("user_id", user.id)
        .eq("platform", "youtube")
        .maybeSingle();

      if (!integration) return json({ error: "YouTube not connected. Please connect your account first." }, 403);

      const stored = JSON.parse(integration.encrypted_refresh_token);

      // Check if token needs refresh
      let accessToken: string = stored.accessToken;
      const needsRefresh = Date.now() >= stored.expiresAt - 5 * 60 * 1000;

      if (needsRefresh && stored.refreshToken && CLIENT_ID && CLIENT_SECRET) {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: CLIENT_ID!,
            client_secret: CLIENT_SECRET!,
            refresh_token: stored.refreshToken,
            grant_type: "refresh_token",
          }),
        });
        if (tokenRes.ok) {
          const refreshed = await tokenRes.json();
          accessToken = refreshed.access_token;
          const newExpiresAt = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
          await supabase.from("integrations").upsert({
            user_id: user.id,
            platform: "youtube",
            encrypted_refresh_token: JSON.stringify({ ...stored, accessToken, expiresAt: newExpiresAt }),
          }, { onConflict: "user_id,platform" });
        }
      }

      const formData = await req.formData();
      const videoFile = formData.get("video") as File | null;
      const title = (formData.get("title") as string) || "Short";
      const description = (formData.get("description") as string) || "";
      const tags = (formData.get("tags") as string) || "";

      if (!videoFile) return json({ error: "No video file provided" }, 400);

      const metadata = {
        snippet: {
          title: title.slice(0, 100),
          description: description.slice(0, 5000),
          tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean).slice(0, 500),
          categoryId: "22",
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      };

      // Multipart upload
      const boundary = `boundary_${Date.now()}`;
      const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
      const videoBytes = new Uint8Array(await videoFile.arrayBuffer());

      const metaBytes = new TextEncoder().encode(metaPart);
      const endBytes = new TextEncoder().encode(`\r\n--${boundary}--`);
      const videoPartHeader = new TextEncoder().encode(
        `--${boundary}\r\nContent-Type: video/mp4\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
      );

      const combined = new Uint8Array(
        metaBytes.length + videoPartHeader.length + videoBytes.length + endBytes.length,
      );
      combined.set(metaBytes, 0);
      combined.set(videoPartHeader, metaBytes.length);
      combined.set(videoBytes, metaBytes.length + videoPartHeader.length);
      combined.set(endBytes, metaBytes.length + videoPartHeader.length + videoBytes.length);

      const uploadRes = await fetch(`${YOUTUBE_UPLOAD_URL}?uploadType=multipart&part=snippet,status`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": String(combined.length),
        },
        body: combined,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return json({ error: `YouTube upload failed: ${err}` }, 502);
      }

      const result = await uploadRes.json();
      const videoId = result.id;
      const ytUrl = `https://www.youtube.com/shorts/${videoId}`;

      return json({ success: true, videoId, url: ytUrl });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlClose(message: string) {
  const escaped = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(
    `<!DOCTYPE html><html><body><p>${escaped}</p><script>window.opener?.postMessage({type:'youtube_oauth_done'},'*');setTimeout(()=>window.close(),2000);</script></body></html>`,
    { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html" } },
  );
}
