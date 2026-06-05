// Edge Function: download-video
// Server-side proxy that downloads YouTube/Instagram videos using yt-dlp
// (when the binary is present) or falls back to ytdl-core for YouTube.
// This bypasses browser-side CORS restrictions on streaming platforms.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Logging helpers ──────────────────────────────────────────────────────────

type LogStatus = "pending" | "success" | "error";

async function insertLog(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  step: string,
  status: LogStatus,
  message?: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("processing_logs")
    .insert({ user_id: userId, step, status, message: message ?? null })
    .select("id")
    .maybeSingle();
  if (error) console.error("insertLog failed:", error.message);
  return data?.id ?? null;
}

async function updateLog(
  supabase: ReturnType<typeof createClient>,
  logId: string | null,
  status: LogStatus,
  message?: string,
  errorCode?: string,
  durationMs?: number,
) {
  if (!logId) return;
  await supabase.from("processing_logs").update({
    status,
    message: message ?? null,
    error_code: errorCode ?? null,
    duration_ms: durationMs ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", logId);
}

// ─── yt-dlp subprocess helper (requires binary in PATH) ───────────────────────

async function ytdlpStream(
  url: string,
  format = "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
): Promise<{ stream: ReadableStream<Uint8Array>; title: string; ext: string }> {
  // First, get JSON info to extract title and format details
  const infoCmd = new Deno.Command("yt-dlp", {
    args: ["--no-playlist", "--dump-json", "--no-download", url],
    stdout: "piped",
    stderr: "piped",
  });
  const infoResult = await infoCmd.output();
  if (infoResult.code !== 0) {
    const errText = new TextDecoder().decode(infoResult.stderr);
    throw Object.assign(
      new Error(`yt-dlp info failed: ${errText.trim()}`),
      { code: String(infoResult.code) },
    );
  }
  const info = JSON.parse(new TextDecoder().decode(infoResult.stdout));
  const title: string = info.title ?? "video";
  const ext: string = info.ext ?? "mp4";

  // Stream the video to stdout
  const dlCmd = new Deno.Command("yt-dlp", {
    args: [
      "--no-playlist",
      "--format", format,
      "--output", "-",           // write to stdout
      "--no-part",
      "--max-filesize", "500m",
      url,
    ],
    stdout: "piped",
    stderr: "null",
  });
  const child = dlCmd.spawn();

  return {
    stream: child.stdout,
    title,
    ext,
  };
}

// ─── ytdl-core fallback (pure JS, no binary required) ────────────────────────

async function ytdlCoreStream(
  url: string,
): Promise<{ stream: ReadableStream<Uint8Array>; title: string; ext: string }> {
  const { default: ytdl } = await import("npm:@distube/ytdl-core@4");

  const info = await ytdl.getInfo(url);
  const title: string = info.videoDetails.title ?? "video";

  // Prefer a combined video+audio format at 720p or lower for faster transfer
  const format =
    ytdl.chooseFormat(info.formats, { quality: "highestvideo", filter: "audioandvideo" }) ??
    ytdl.chooseFormat(info.formats, { quality: "lowestvideo",  filter: "audioandvideo" });

  if (!format?.url) throw new Error("No suitable combined format found on YouTube");

  const ext = format.container ?? "mp4";

  // Fetch the format URL and stream it through
  const upstream = await fetch(format.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Referer": "https://www.youtube.com/",
    },
  });
  if (!upstream.ok) throw new Error(`Upstream YouTube fetch failed: ${upstream.status}`);
  if (!upstream.body)  throw new Error("Empty upstream response body");

  return { stream: upstream.body, title, ext };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const videoUrl = body.url?.trim();
  if (!videoUrl) return json({ error: "Missing url in request body" }, 400);

  const isYouTube   = /youtube\.com|youtu\.be/i.test(videoUrl);
  const isInstagram = /instagram\.com/i.test(videoUrl);

  if (!isYouTube && !isInstagram) {
    return json({ error: "Only YouTube and Instagram URLs are supported" }, 400);
  }

  if (isInstagram) {
    return json({
      error: "Instagram downloads require session authentication. Please download the video manually and upload the file.",
    }, 501);
  }

  const logId = await insertLog(supabase, user.id, "download", "pending", videoUrl);
  const start = Date.now();

  try {
    let result: { stream: ReadableStream<Uint8Array>; title: string; ext: string };

    // Try yt-dlp binary first; fall back to ytdl-core
    try {
      result = await ytdlpStream(videoUrl);
    } catch (ytdlpErr) {
      const errMsg = ytdlpErr instanceof Error ? ytdlpErr.message : String(ytdlpErr);
      const isMissing = errMsg.includes("No such file") || errMsg.includes("not found");
      if (!isMissing) {
        // yt-dlp exists but failed (bad URL, age-restricted, etc.)
        const code = (ytdlpErr as { code?: string }).code;
        await updateLog(supabase, logId, "error", errMsg, code);
        return json({ error: `Download failed: ${errMsg}` }, 502);
      }
      // yt-dlp binary absent — use ytdl-core
      result = await ytdlCoreStream(videoUrl);
    }

    const durationMs = Date.now() - start;
    await updateLog(supabase, logId, "success", null, undefined, durationMs);

    const safeTitle = result.title.replace(/[^\w\s-]/g, "").trim() || "video";

    return new Response(result.stream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": `video/${result.ext}`,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeTitle)}.${result.ext}"`,
        "X-Video-Title": encodeURIComponent(safeTitle),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg  = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    await updateLog(supabase, logId, "error", msg, code).catch(() => {});
    return json({ error: "Download failed: " + msg }, 502);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
