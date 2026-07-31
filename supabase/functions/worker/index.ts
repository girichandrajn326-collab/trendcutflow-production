// Edge Function: worker
//
// Executes the full video processing pipeline for a single processing_jobs row.
// Called internally by swift-service / start-job via EdgeRuntime.waitUntil().
//
// POST body: { jobId: string }
// Auth:      service_role_key (Authorization: Bearer <key>)
//
// Pipeline (no ffmpeg / ffprobe — pure API calls):
//   generating_url → downloading → transcribing → detecting → slicing → completed | failed
//
// The worker downloads the video file and uploads it directly to Groq Whisper
// (more reliable than URL-based input, which requires Groq to fetch from Supabase).
// No mock/sample fallbacks — if an API call fails, the job fails with a clear error.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_CHAT_URL     = "https://api.openai.com/v1/chat/completions";
const STORAGE_BUCKET      = "videos";
const MAX_FILE_BYTES      = 100 * 1024 * 1024; // 100 MB — Groq dev-tier upload limit
const GROQ_TIMEOUT_MS      = 300_000;          // 5 min for transcription
const OPENAI_TIMEOUT_MS    = 120_000;          // 2 min for clip detection

// ─── Types ────────────────────────────────────────────────────────────────────

type LogStatus = "pending" | "success" | "error";

interface TranscriptWord {
  id:       number;
  word:     string;
  start_ms: number;
  end_ms:   number;
}

interface RawClip {
  startTime:       number;
  endTime:         number;
  viralTitles:     string[];
  seoDescription:  string;
  hashtags:        string[];
  algorithmicTags: string[];
}

interface ClipResult extends RawClip {
  transcriptWords: TranscriptWord[];
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

// ─── Logging helpers ──────────────────────────────────────────────────────────

async function insertLog(
  sb: SupabaseClient,
  userId: string,
  step: string,
  status: LogStatus,
  message?: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("processing_logs")
    .insert({ user_id: userId, step, status, message: message ?? null })
    .select("id")
    .maybeSingle();
  if (error) console.error("[insertLog] failed:", error.message);
  return data?.id ?? null;
}

async function updateLog(
  sb: SupabaseClient,
  logId: string | null,
  status: LogStatus,
  message?: string,
  errorCode?: string,
  durationMs?: number,
): Promise<void> {
  if (!logId) return;
  await sb.from("processing_logs").update({
    status,
    message:     message    ?? null,
    error_code:  errorCode  ?? null,
    duration_ms: durationMs ?? null,
    updated_at:  new Date().toISOString(),
  }).eq("id", logId);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let jobId: string;
  try {
    const body = await req.json();
    jobId      = body.jobId;
    if (!jobId) throw new Error("jobId is required");
  } catch {
    return json({ error: "Invalid body — expected { jobId: string }" }, 400);
  }

  const { data: job, error: jobErr } = await sb
    .from("processing_jobs")
    .select("id, user_id, storage_path, source_type, source_url, original_name, status")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !job) return json({ error: `Job not found: ${jobId}` }, 404);
  if (job.status !== "queued") {
    return json({ ok: true, skipped: true, status: job.status });
  }

  const bgPromise = runPipeline(sb, {
    jobId,
    userId:      job.user_id,
    storagePath: job.storage_path ?? null,
    sourceUrl:   job.source_url  ?? null,
    sourceType:  job.source_type ?? "file",
    fileName:    job.original_name ?? "video.mp4",
  });

  // deno-lint-ignore no-explicit-any
  const ert = (globalThis as any).EdgeRuntime;
  if (ert?.waitUntil) {
    ert.waitUntil(bgPromise);
  } else {
    bgPromise.catch(console.error);
  }

  await new Promise<void>(resolve => setTimeout(resolve, 100));

  return json({ ok: true, jobId });
});

// ─── Pipeline ─────────────────────────────────────────────────────────────────

interface PipelineCtx {
  jobId:       string;
  userId:      string;
  storagePath: string | null;
  sourceUrl:   string | null;
  sourceType:  string;
  fileName:    string;
}

async function runPipeline(sb: SupabaseClient, ctx: PipelineCtx): Promise<void> {
  const { jobId, userId } = ctx;

  const setStatus = async (status: string, detail?: string, extra: Record<string, unknown> = {}) => {
    console.log(`[worker][${jobId}] status=${status} | ${detail ?? ""}`);
    await sb.from("processing_jobs").update({
      status,
      step_detail: detail ?? null,
      updated_at:  new Date().toISOString(),
      ...extra,
    }).eq("id", jobId);
  };

  let videoUrl: string;

  try {
    // ── 1. Resolve video source URL ─────────────────────────────────────────
    if (ctx.storagePath) {
      const urlStep  = "Generating signed URL for storage path…";
      const urlLog   = await insertLog(sb, userId, "generate_signed_url", "pending", urlStep);
      const urlStart = Date.now();
      await setStatus("generating_url", urlStep);

      const { data: signedData, error: signedErr } = await sb.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(ctx.storagePath, 600);

      if (signedErr || !signedData?.signedUrl) {
        const msg = `Failed to generate signed URL: ${signedErr?.message ?? "No URL returned"}`;
        await updateLog(sb, urlLog, "error", msg, "SIGNED_URL_FAILED");
        throw new Error(msg);
      }

      videoUrl = signedData.signedUrl;

      await updateLog(sb, urlLog, "success",
        `Signed URL generated (expires in 10min) for ${ctx.storagePath}`,
        undefined, Date.now() - urlStart,
      );
      console.log(`[worker][${jobId}] Signed URL ready: ${videoUrl.slice(0, 100)}…`);
    } else if (ctx.sourceUrl) {
      videoUrl = ctx.sourceUrl;
      await setStatus("generating_url", "Using source URL directly");
    } else {
      throw new Error("No input source available");
    }

    // ── 2. Verify URL is accessible ──────────────────────────────────────────
    const verifyLog = await insertLog(sb, userId, "url_access_check", "pending", `Verifying URL accessibility…`);
    const headRes = await fetch(videoUrl, { method: "HEAD" }).catch((e) => {
      throw new Error(`HEAD request to storage URL failed: ${e instanceof Error ? e.message : String(e)}`);
    });

    if (!headRes.ok) {
      const msg = `Storage URL returned HTTP ${headRes.status} ${headRes.statusText} — URL is not accessible`;
      await updateLog(sb, verifyLog, "error", msg, "URL_NOT_ACCESSIBLE");
      throw new Error(msg);
    }

    const contentLength = headRes.headers.get("content-length");
    const contentType   = headRes.headers.get("content-type") ?? "unknown";
    const fileSizeBytes = contentLength ? parseInt(contentLength, 10) : 0;

    await updateLog(sb, verifyLog, "success",
      `URL accessible — ${fileSizeBytes ? Math.round(fileSizeBytes / 1024 / 1024) + " MB" : "size unknown"}, type: ${contentType}`,
    );
    console.log(`[worker][${jobId}] URL verified — size: ${fileSizeBytes ? Math.round(fileSizeBytes / 1024 / 1024) + "MB" : "unknown"}, type: ${contentType}`);

    if (fileSizeBytes > MAX_FILE_BYTES) {
      const mb = Math.round(fileSizeBytes / 1024 / 1024);
      const msg = `File is ${mb} MB. Maximum allowed is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`;
      await updateLog(sb, verifyLog, "error", msg, "FILE_TOO_LARGE");
      throw new Error(msg);
    }

    // ── 3. Download video file ───────────────────────────────────────────────
    await setStatus("downloading", `Downloading video file (${fileSizeBytes ? Math.round(fileSizeBytes / 1024 / 1024) + " MB" : "size unknown"})…`);
    const dlLog   = await insertLog(sb, userId, "download_video", "pending", "Downloading video from storage");
    const dlStart = Date.now();

    let videoBytes: Uint8Array;
    try {
      const dlRes = await fetch(videoUrl);
      if (!dlRes.ok) {
        const msg = `Download failed: HTTP ${dlRes.status} ${dlRes.statusText}`;
        await updateLog(sb, dlLog, "error", msg, "DOWNLOAD_FAILED");
        throw new Error(msg);
      }
      const buf = await dlRes.arrayBuffer();
      videoBytes = new Uint8Array(buf);
    } catch (dlErr) {
      const msg = `Download failed: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`;
      await updateLog(sb, dlLog, "error", msg, "DOWNLOAD_FAILED");
      throw new Error(msg);
    }

    await updateLog(sb, dlLog, "success",
      `Downloaded ${Math.round(videoBytes.length / 1024 / 1024)} MB`,
      undefined, Date.now() - dlStart,
    );
    console.log(`[worker][${jobId}] Downloaded ${videoBytes.length} bytes (${Math.round(videoBytes.length / 1024 / 1024)} MB)`);

    // ── 4. Transcribe with Groq Whisper (direct file upload) ──────────────────
    await setStatus("transcribing", "Transcribing audio with Groq Whisper…");
    const whisperLog   = await insertLog(sb, userId, "transcribe", "pending", `Sending ${Math.round(videoBytes.length / 1024 / 1024)} MB file to Groq Whisper large-v3`);
    const whisperStart = Date.now();

    // Verify API key exists before calling
    const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_KEY) {
      const msg = "GROQ_API_KEY secret is not configured — cannot transcribe. Add it in your Supabase project settings under Edge Function Secrets.";
      await updateLog(sb, whisperLog, "error", msg, "GROQ_KEY_MISSING");
      throw new Error(msg);
    }

    const { text: transcriptText, words } = await whisperTranscribeFile(videoBytes, ctx.fileName, GROQ_KEY);

    await updateLog(sb, whisperLog, "success",
      `Transcribed ${transcriptText.split(/\s+/).filter(Boolean).length} words from ${Math.round(videoBytes.length / 1024 / 1024)} MB file`,
      undefined, Date.now() - whisperStart,
    );
    console.log(`[worker][${jobId}] Whisper complete — ${transcriptText.split(/\s+/).filter(Boolean).length} words, ${words.length} word-timestamps`);

    // ── 5. GPT-4o-mini viral segment detection ───────────────────────────────
    await setStatus("detecting", "Detecting viral segments with GPT-4o-mini…");
    const detectLog   = await insertLog(sb, userId, "segment_detection", "pending", "Sending transcript to GPT-4o-mini");
    const detectStart = Date.now();

    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_KEY) {
      const msg = "OPENAI_API_KEY secret is not configured — cannot detect clips. Add it in your Supabase project settings under Edge Function Secrets.";
      await updateLog(sb, detectLog, "error", msg, "OPENAI_KEY_MISSING");
      throw new Error(msg);
    }

    const rawClips = await detectClips(transcriptText, OPENAI_KEY);

    await updateLog(sb, detectLog, "success",
      `${rawClips.length} segments identified by GPT-4o-mini`,
      undefined, Date.now() - detectStart,
    );
    console.log(`[worker][${jobId}] GPT-4o-mini returned ${rawClips.length} clips`);

    // ── 6. Build clip results with transcript words ──────────────────────────
    const clips: ClipResult[] = rawClips.slice(0, 5).map(r => ({
      ...r,
      transcriptWords: words.filter(
        w => w.start_ms / 1000 >= r.startTime && w.end_ms / 1000 <= r.endTime,
      ),
    }));

    await setStatus("slicing", `${clips.length} clips ready. Finalising…`);

    // ── 7. Consume credit ────────────────────────────────────────────────────
    console.log(`[worker][${jobId}] Consuming credit`);
    let creditConsumed = false;
    const { error: creditErr } = await sb.rpc("consume_credit", { uid: userId });
    if (creditErr) {
      console.error(`[worker][${jobId}] consume_credit failed:`, creditErr.message);
      await insertLog(sb, userId, "consume_credit", "error", creditErr.message);
    } else {
      creditConsumed = true;
    }

    // ── 8. Persist video_sources + repurposed_clips ──────────────────────────
    console.log(`[worker][${jobId}] Persisting results to DB`);
    try {
      const sourceTitle = ctx.sourceUrl ?? ctx.fileName;
      const { data: vsRow } = await sb
        .from("video_sources")
        .insert({
          user_id:    userId,
          title:      sourceTitle,
          source_url: ctx.sourceUrl ?? "",
          status:     "COMPLETED",
          duration:   0,
        })
        .select("id")
        .maybeSingle();

      if (vsRow) {
        await sb.from("repurposed_clips").insert(
          clips.map(c => ({
            video_source_id:  vsRow.id,
            start_time:       c.startTime,
            end_time:         c.endTime,
            clip_storage_url: "",
            ai_title:         c.viralTitles[0],
            ai_description:   c.seoDescription,
            is_queued:        false,
            metadata_json:    {
              viralTitles:     c.viralTitles,
              seoDescription:  c.seoDescription,
              hashtags:        c.hashtags,
              algorithmicTags: c.algorithmicTags,
            },
            source_video_url: ctx.sourceUrl ?? "",
            transcript_json:  { words: c.transcriptWords },
          })),
        );
      }
    } catch (persistErr) {
      console.error(`[worker][${jobId}] DB persist failed (non-fatal):`, persistErr);
      await insertLog(sb, userId, "db_persist", "error",
        persistErr instanceof Error ? persistErr.message : String(persistErr),
      );
    }

    // ── 9. Mark completed with REAL results ──────────────────────────────────
    console.log(`[worker][${jobId}] Marking job completed with real transcript + clips`);
    await sb.from("processing_jobs").update({
      status:           "completed",
      step_detail:      `${clips.length} clips extracted from real transcript`,
      progress:         100,
      credits_consumed: creditConsumed,
      result: {
        hasAudio:          true,
        videoDurationSecs: 0,
        sourceTitle:       ctx.sourceUrl ?? ctx.fileName,
        sourceVideoUrl:    videoUrl,
        clips,
        transcriptPreview: transcriptText.slice(0, 500),
      },
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    await insertLog(sb, userId, "job_complete", "success",
      `Job ${jobId} finished — ${clips.length} clips from real transcript (${transcriptText.split(/\s+/).filter(Boolean).length} words)`,
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker][${jobId}] FAILED:`, msg);
    if (err instanceof Error && err.stack) console.error(`[worker][${jobId}] Stack:`, err.stack);
    await sb.from("processing_jobs").update({
      status:        "failed",
      error_message: msg,
      updated_at:    new Date().toISOString(),
    }).eq("id", jobId).catch(() => {});
    await insertLog(sb, userId, "job_failed", "error", msg).catch(() => {});
  }
}

// ─── Pipeline helpers ─────────────────────────────────────────────────────────

/**
 * Transcribe audio by uploading the file directly to Groq Whisper.
 * Direct upload is more reliable than URL-based input because:
 *   - No dependency on Groq being able to reach Supabase Storage
 *   - We control the download and can verify the file
 *   - We get immediate error feedback
 *
 * Throws on any failure — the caller must handle the error (no mock fallback).
 */
async function whisperTranscribeFile(
  videoBytes: Uint8Array,
  fileName:   string,
  groqKey:    string,
): Promise<{ text: string; words: TranscriptWord[] }> {
  // Determine a valid audio/video filename for Groq
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "mp4";
  const groqFileName = `video.${ext}`;

  const form = new FormData();
  form.append("file",                     new Blob([videoBytes], { type: guessMimeType(ext) }), groqFileName);
  form.append("model",                    "whisper-large-v3");
  form.append("response_format",           "verbose_json");
  form.append("timestamp_granularities[]", "word");

  console.log(`[worker] Sending ${Math.round(videoBytes.length / 1024 / 1024)} MB to Groq as ${groqFileName}`);

  const controller = new AbortController();
  const timeout     = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(GROQ_TRANSCRIBE_URL, {
      method:  "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body:    form,
      signal:  controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
      throw new Error(`Groq Whisper timed out after ${GROQ_TIMEOUT_MS / 1000}s while transcribing ${Math.round(videoBytes.length / 1024 / 1024)} MB file`);
    }
    throw new Error(`Groq Whisper fetch failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text().catch(() => "(no response body)");
    throw new Error(`Groq Whisper returned HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 1000)}`);
  }

  const data = await res.json();
  const words: TranscriptWord[] = (data.words ?? []).map(
    (w: { word: string; start: number; end: number }, i: number) => ({
      id:       i,
      word:     w.word,
      start_ms: Math.round(w.start * 1000),
      end_ms:   Math.round(w.end   * 1000),
    }),
  );

  const text = data.text ?? "";
  if (!text && words.length === 0) {
    throw new Error("Groq Whisper returned an empty transcript — the video may have no audio track, or the audio codec is not supported.");
  }

  return { text, words };
}

/**
 * Detect viral clips from a transcript using GPT-4o-mini.
 * Throws on any failure — the caller must handle the error (no mock fallback).
 */
async function detectClips(transcriptText: string, openaiKey: string): Promise<RawClip[]> {
  const controller = new AbortController();
  const timeout     = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model:           "gpt-4o-mini",
        temperature:     0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are an elite viral video producer." },
          {
            role: "user",
            content: `Analyze this transcript and extract EXACTLY 5 highly engaging segments for viral short-form content.

For each segment provide:
- startTime: start timestamp in seconds (float)
- endTime: end timestamp in seconds (float, max 90s per clip)
- viralTitles: array of exactly 3 attention-grabbing titles
- seoDescription: 2-3 sentence SEO-optimized description
- hashtags: array of 6-8 hashtags with # symbol
- algorithmicTags: array of 5-6 keyword phrases (no # symbol)

Respond with valid JSON only: { "clips": [ ... ] }

Transcript:
${transcriptText}`,
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
      throw new Error(`OpenAI GPT-4o-mini timed out after ${OPENAI_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`OpenAI fetch failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text().catch(() => "(no response body)");
    throw new Error(`OpenAI GPT-4o-mini returned HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 1000)}`);
  }

  const data    = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) {
    throw new Error("OpenAI GPT-4o-mini returned an empty response (no content in choices[0].message.content)");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (parseErr) {
    throw new Error(`OpenAI GPT-4o-mini returned invalid JSON: ${content.slice(0, 500)} (parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)})`);
  }

  const clips = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)?.clips
      ?? (parsed as Record<string, unknown>)?.segments
      ?? Object.values(parsed).find((v): v is unknown[] => Array.isArray(v))
      ?? [];

  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error(`OpenAI GPT-4o-mini returned no clips. Response was: ${content.slice(0, 500)}`);
  }

  return clips as RawClip[];
}

function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    mp4:  "video/mp4",
    m4a:  "audio/mp4",
    mp3:  "audio/mpeg",
    mpeg: "video/mpeg",
    mpga: "audio/mpeg",
    ogg:  "audio/ogg",
    wav:  "audio/wav",
    webm: "video/webm",
    flac: "audio/flac",
    mov:  "video/quicktime",
    avi:  "video/x-msvideo",
  };
  return map[ext] ?? "video/mp4";
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
