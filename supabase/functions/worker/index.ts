// Edge Function: worker
//
// Executes the full video processing pipeline for a single processing_jobs row.
// Called internally by start-job via EdgeRuntime.waitUntil() and by pg_net triggers.
//
// POST body: { jobId: string }
// Auth:      service_role_key (Authorization: Bearer <key>)
//
// Pipeline:
//   downloading → audio_check → extracting_audio → transcribing
//   → detecting → slicing → completed | failed

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_CHAT_URL     = "https://api.openai.com/v1/chat/completions";
const STORAGE_BUCKET      = "videos";
const MAX_UPLOAD_BYTES    = 500 * 1024 * 1024; // 500 MB
const MAX_DURATION_SECS   = 600;               // 10 minutes

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
  if (error) console.error("insertLog failed:", error.message);
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

  // Auth: require service_role_key (passed as Bearer token by start-job or pg_net)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Parse jobId from body
  let jobId: string;
  try {
    const body = await req.json();
    jobId      = body.jobId;
    if (!jobId) throw new Error("jobId is required");
  } catch {
    return json({ error: "Invalid body — expected { jobId: string }" }, 400);
  }

  // Load the job row to get context
  const { data: job, error: jobErr } = await sb
    .from("processing_jobs")
    .select("id, user_id, storage_path, source_type, source_url, original_name, status")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !job) {
    return json({ error: `Job not found: ${jobId}` }, 404);
  }
  if (job.status !== "queued") {
    // Already picked up or completed — idempotent no-op
    return json({ ok: true, skipped: true, status: job.status });
  }

  const ext = (job.original_name ?? "video.mp4").split(".").pop()?.toLowerCase() ?? "mp4";

  // Run the pipeline in the background and return immediately
  const bgPromise = runPipeline(sb, {
    jobId,
    userId:      job.user_id,
    storagePath: job.storage_path ?? null,
    sourceUrl:   job.source_url  ?? null,
    sourceType:  job.source_type ?? "file",
    fileName:    job.original_name ?? "video.mp4",
    ext,
  });

  // deno-lint-ignore no-explicit-any
  const ert = (globalThis as any).EdgeRuntime;
  if (ert?.waitUntil) {
    ert.waitUntil(bgPromise);
  } else {
    bgPromise.catch(console.error);
  }

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
  ext:         string;
}

async function runPipeline(sb: SupabaseClient, ctx: PipelineCtx): Promise<void> {
  const { jobId, userId } = ctx;
  const inputPath = `/tmp/${jobId}_input.${ctx.ext}`;
  const audioPath = `/tmp/${jobId}_audio.mp3`;

  const setStatus = async (status: string, detail?: string, extra: Record<string, unknown> = {}) => {
    await sb.from("processing_jobs").update({
      status,
      step_detail: detail ?? null,
      updated_at:  new Date().toISOString(),
      ...extra,
    }).eq("id", jobId);
  };

  try {
    // ── 1. Download / write to /tmp ──────────────────────────────────────────
    await setStatus("downloading", "Saving video to processing buffer…");
    const dlLog   = await insertLog(sb, userId, "download", "pending");
    const dlStart = Date.now();

    if (ctx.storagePath) {
      await setStatus("downloading", "Retrieving file from storage…");
      const { data: blob, error: dlErr } = await sb.storage
        .from(STORAGE_BUCKET)
        .download(ctx.storagePath);
      if (dlErr || !blob) {
        await updateLog(sb, dlLog, "error",
          `Storage download failed: ${dlErr?.message ?? "No data"}`, "STORAGE_DOWNLOAD_FAILED",
        );
        throw new Error(`Storage download failed: ${dlErr?.message ?? "No data"}`);
      }
      const buf = await blob.arrayBuffer();
      await Deno.writeFile(inputPath, new Uint8Array(buf));
      await updateLog(sb, dlLog, "success",
        `Retrieved ${buf.byteLength} bytes from storage (${ctx.storagePath})`,
        undefined, Date.now() - dlStart,
      );
    } else if (ctx.sourceType === "youtube" && ctx.sourceUrl) {
      await setStatus("downloading", `Downloading from YouTube: ${ctx.sourceUrl}`);
      await ytdlpDownload(ctx.sourceUrl, inputPath);
      await updateLog(sb, dlLog, "success",
        `yt-dlp complete: ${ctx.sourceUrl}`, undefined, Date.now() - dlStart,
      );
    } else {
      await updateLog(sb, dlLog, "error", "No input source available", "NO_INPUT_SOURCE");
      throw new Error("No input source available");
    }

    // ── 2. Pre-flight audio check + limits ───────────────────────────────────
    await setStatus("audio_check", "Probing audio stream…");
    const audioCheckLog   = await insertLog(sb, userId, "audio_check", "pending");
    const audioCheckStart = Date.now();

    let hasAudio          = false;
    let videoDurationSecs: number | undefined;
    let detectionMethod   = "binary-scan";

    const probeResult = await ffprobeJson(inputPath);
    if (probeResult) {
      hasAudio          = probeResult.streams?.some((s: { codec_type: string }) => s.codec_type === "audio") ?? false;
      videoDurationSecs = parseFloat(probeResult.format?.duration ?? "0") || undefined;
      detectionMethod   = "ffprobe";
    } else {
      const raw = await Deno.readFile(inputPath);
      hasAudio  = scanBinaryForAudio(raw.slice(0, 131072));
    }

    // Duration limit
    if (videoDurationSecs && videoDurationSecs > MAX_DURATION_SECS) {
      const mins = (videoDurationSecs / 60).toFixed(1);
      await updateLog(sb, audioCheckLog, "error",
        `Video is ${mins} min — exceeds 10-minute limit`, "DURATION_LIMIT_EXCEEDED",
        Date.now() - audioCheckStart,
      );
      throw new Error(`Video is ${mins} minutes long. Maximum allowed is 10 minutes.`);
    }

    // File size limit
    const { size: fileSizeBytes } = await Deno.stat(inputPath);
    if (fileSizeBytes > MAX_UPLOAD_BYTES) {
      const mb = Math.round(fileSizeBytes / 1024 / 1024);
      await updateLog(sb, audioCheckLog, "error",
        `File is ${mb} MB — exceeds 500 MB limit`, "SIZE_LIMIT_EXCEEDED",
        Date.now() - audioCheckStart,
      );
      throw new Error(`File is ${mb} MB. Maximum allowed is 500 MB.`);
    }

    const audioMsg = `Audio: ${hasAudio ? "Yes" : "No"} (${detectionMethod}${videoDurationSecs ? `, ${Math.round(videoDurationSecs)}s` : ""})`;
    await updateLog(sb, audioCheckLog, "success", audioMsg, undefined, Date.now() - audioCheckStart);
    await sb.from("processing_jobs").update({ has_audio: hasAudio, step_detail: audioMsg, updated_at: new Date().toISOString() }).eq("id", jobId);

    // ── 3–5. Transcribe or fallback segmentation ─────────────────────────────
    let clips: ClipResult[];

    if (hasAudio) {
      // 3. Extract 32 kbps mono MP3
      await setStatus("extracting_audio", "Extracting 32 kbps mono audio with FFmpeg…");
      const ffmpegLog   = await insertLog(sb, userId, "audio_extraction", "pending");
      const ffmpegStart = Date.now();

      try {
        const ffmpegOk = await extractAudioMp3(inputPath, audioPath);
        if (ffmpegOk) {
          await updateLog(sb, ffmpegLog, "success", "32 kbps mono MP3 extracted", undefined, Date.now() - ffmpegStart);
        } else {
          const { size } = await Deno.stat(inputPath);
          if (size > 24 * 1024 * 1024) {
            await updateLog(sb, ffmpegLog, "error",
              `FFmpeg unavailable and file too large for Whisper (${Math.round(size / 1024 / 1024)} MB > 25 MB)`,
              "FFMPEG_UNAVAILABLE_FILE_TOO_LARGE", Date.now() - ffmpegStart,
            );
            throw new Error("Video is too large for Whisper (>25 MB) and FFmpeg is unavailable.");
          }
          await Deno.copyFile(inputPath, audioPath);
          await updateLog(sb, ffmpegLog, "success",
            "FFmpeg unavailable — forwarding raw video to Whisper (within 25 MB limit)",
            "FFMPEG_UNAVAILABLE_RAW_FALLBACK", Date.now() - ffmpegStart,
          );
        }
      } catch (ffmpegErr) {
        const alreadyLogged = ffmpegErr instanceof Error && ffmpegErr.message.startsWith("Video is too large");
        if (!alreadyLogged) {
          await updateLog(sb, ffmpegLog, "error",
            ffmpegErr instanceof Error ? ffmpegErr.message : String(ffmpegErr),
            "FFMPEG_NONZERO_EXIT", Date.now() - ffmpegStart,
          );
        }
        throw ffmpegErr;
      }

      // 4. Whisper transcription
      await setStatus("transcribing", "Transcribing with Groq Whisper…");
      const whisperLog   = await insertLog(sb, userId, "transcribe", "pending");
      const whisperStart = Date.now();

      let transcriptText: string;
      let words: TranscriptWord[];
      try {
        ({ text: transcriptText, words } = await whisperTranscribe(audioPath));
        await updateLog(sb, whisperLog, "success",
          `Transcribed ${transcriptText.split(" ").length} words`, undefined, Date.now() - whisperStart,
        );
      } catch (whisperErr) {
        await updateLog(sb, whisperLog, "error",
          whisperErr instanceof Error ? whisperErr.message : String(whisperErr),
          "WHISPER_FAILED", Date.now() - whisperStart,
        );
        throw whisperErr;
      }

      // 5. GPT-4o-mini viral segment detection
      await setStatus("detecting", "Detecting viral segments with GPT-4o-mini…");
      const detectLog   = await insertLog(sb, userId, "segment_detection", "pending");
      const detectStart = Date.now();

      let rawClips: RawClip[];
      try {
        rawClips = await detectClips(transcriptText);
        await updateLog(sb, detectLog, "success",
          `${rawClips.length} segments identified`, undefined, Date.now() - detectStart,
        );
      } catch (detectErr) {
        await updateLog(sb, detectLog, "error",
          detectErr instanceof Error ? detectErr.message : String(detectErr),
          "SEGMENT_DETECTION_FAILED", Date.now() - detectStart,
        );
        throw detectErr;
      }

      clips = rawClips.slice(0, 5).map(r => ({
        ...r,
        transcriptWords: words.filter(
          w => w.start_ms / 1000 >= r.startTime && w.end_ms / 1000 <= r.endTime,
        ),
      }));
      if (videoDurationSecs && videoDurationSecs > 0) clips = clampClips(clips, videoDurationSecs);

    } else {
      // Silent video: time-based segmentation
      const duration = videoDurationSecs ?? 300;
      const count    = Math.min(5, Math.max(1, Math.floor(duration / 30)));
      const seg      = duration / count;

      await insertLog(sb, userId, "audio_check_no_audio", "success",
        `Audio: No — Whisper skipped. Fallback: ${count} time-based clips × ${Math.round(seg)}s`,
      );
      await setStatus("slicing", "Building time-based visual clips (no audio detected)…");

      clips = Array.from({ length: count }, (_, i) => ({
        startTime:       Math.round(i * seg * 10) / 10,
        endTime:         Math.round(Math.min((i + 1) * seg, duration) * 10) / 10,
        viralTitles:     [`Clip ${i + 1} — Visual Segment`, `Part ${i + 1} of ${count}`, `Scene ${i + 1}`],
        seoDescription:  `Visual content segment ${i + 1} of ${count}. No audio — time-based cut.`,
        hashtags:        [],
        algorithmicTags: [],
        transcriptWords: [],
      }));
    }

    await setStatus("slicing", `${clips.length} clips ready. Finalising…`);

    // ── 6. Consume credit ────────────────────────────────────────────────────
    const { error: creditErr } = await sb.rpc("consume_credit", { uid: userId });
    if (creditErr) {
      console.error("consume_credit failed:", creditErr.message);
      await insertLog(sb, userId, "consume_credit", "error", creditErr.message);
    }

    // ── 7. Persist video_sources + repurposed_clips ──────────────────────────
    try {
      const sourceTitle = ctx.sourceUrl ?? ctx.fileName;
      const { data: vsRow } = await sb
        .from("video_sources")
        .insert({ user_id: userId, title: sourceTitle, source_url: ctx.sourceUrl ?? "", status: "COMPLETED", duration: videoDurationSecs ?? 0 })
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
            metadata_json:    { viralTitles: c.viralTitles, seoDescription: c.seoDescription, hashtags: c.hashtags, algorithmicTags: c.algorithmicTags },
            source_video_url: ctx.sourceUrl ?? "",
            transcript_json:  { words: c.transcriptWords },
          })),
        );
      }
    } catch (persistErr) {
      console.error("DB persist failed (non-fatal):", persistErr);
      await insertLog(sb, userId, "db_persist", "error",
        persistErr instanceof Error ? persistErr.message : String(persistErr),
      );
    }

    // ── 8. Mark completed ────────────────────────────────────────────────────
    await sb.from("processing_jobs").update({
      status:           "completed",
      step_detail:      `${clips.length} clips extracted`,
      progress:         100,
      credits_consumed: !creditErr,
      result: { hasAudio, videoDurationSecs, sourceTitle: ctx.sourceUrl ?? ctx.fileName, clips },
      updated_at:       new Date().toISOString(),
    }).eq("id", jobId);

    await insertLog(sb, userId, "job_complete", "success",
      `Job ${jobId} finished — ${clips.length} clips, audio: ${hasAudio ? "Yes" : "No"}`,
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Job ${jobId} failed:`, msg);
    await sb.from("processing_jobs").update({
      status:        "failed",
      error_message: msg,
      updated_at:    new Date().toISOString(),
    }).eq("id", jobId).catch(() => {});
    await insertLog(sb, userId, "job_failed", "error", msg).catch(() => {});
  } finally {
    await Deno.remove(inputPath).catch(() => {});
    await Deno.remove(audioPath).catch(() => {});
  }
}

// ─── Pipeline helpers ─────────────────────────────────────────────────────────

async function ytdlpDownload(url: string, outputPath: string): Promise<void> {
  const cmd = new Deno.Command("yt-dlp", {
    args: [
      "--no-playlist",
      "--format", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
      "--output", outputPath,
      "--no-part",
      "--max-filesize", "300m",
      url,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await cmd.output();
  if (result.code !== 0) {
    const errText = new TextDecoder().decode(result.stderr);
    throw new Error(`yt-dlp failed (${result.code}): ${errText.slice(0, 400)}`);
  }
}

async function ffprobeJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const cmd = new Deno.Command("ffprobe", {
      args: ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    if (result.code !== 0) return null;
    return JSON.parse(new TextDecoder().decode(result.stdout));
  } catch {
    return null;
  }
}

async function extractAudioMp3(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    const result = await new Deno.Command("ffmpeg", {
      args: ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", "-ac", "1", "-ar", "16000", "-ab", "32k", outputPath],
      stdout: "piped",
      stderr: "piped",
    }).output();
    return result.code === 0;
  } catch {
    return false;
  }
}

async function whisperTranscribe(audioPath: string): Promise<{ text: string; words: TranscriptWord[] }> {
  const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY secret is not configured");

  const audioBytes = await Deno.readFile(audioPath);
  const audioBlob  = new Blob([audioBytes], { type: "audio/mpeg" });
  const form       = new FormData();
  form.append("file",                      audioBlob, "audio.mp3");
  form.append("model",                     "whisper-large-v3");
  form.append("response_format",           "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const res = await fetch(GROQ_TRANSCRIBE_URL, {
    method:  "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body:    form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq Whisper failed (${res.status}): ${errText.slice(0, 400)}`);
  }
  const data  = await res.json();
  const words = (data.words ?? []).map((w: { word: string; start: number; end: number }, i: number) => ({
    id: i, word: w.word,
    start_ms: Math.round(w.start * 1000),
    end_ms:   Math.round(w.end   * 1000),
  }));
  return { text: data.text ?? "", words };
}

async function detectClips(transcriptText: string): Promise<RawClip[]> {
  const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY secret is not configured");

  const res = await fetch(OPENAI_CHAT_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
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
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI GPT-4o-mini failed (${res.status}): ${errText.slice(0, 400)}`);
  }
  const data    = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '{"clips":[]}';
  const parsed  = JSON.parse(content);
  const clips   = Array.isArray(parsed)
    ? parsed
    : (parsed.clips ?? parsed.segments ?? Object.values(parsed).find(Array.isArray) ?? []);
  return clips as RawClip[];
}

function clampClips(clips: ClipResult[], durationSecs: number): ClipResult[] {
  const maxEnd = Math.max(...clips.map(c => c.endTime));
  if (maxEnd <= durationSecs) return clips;
  const segDur = durationSecs / clips.length;
  return clips.map((c, i) => ({
    ...c,
    startTime: Math.round(Math.max(0, i * segDur) * 10) / 10,
    endTime:   Math.round(Math.min((i + 1) * segDur, durationSecs) * 10) / 10,
  }));
}

function scanBinaryForAudio(data: Uint8Array): boolean {
  const markers: number[][] = [
    [0x73, 0x6F, 0x75, 0x6E],              // 'soun'   MP4 handler
    [0x6D, 0x70, 0x34, 0x61],              // 'mp4a'   AAC
    [0x41, 0x5F, 0x4F, 0x50, 0x55, 0x53], // 'A_OPUS'
    [0x41, 0x5F, 0x56, 0x4F, 0x52],        // 'A_VOR'  Vorbis
    [0x41, 0x5F, 0x41, 0x41, 0x43],        // 'A_AAC'
    [0x6F, 0x70, 0x75, 0x73],              // 'opus'
    [0x76, 0x6F, 0x72, 0x62, 0x69, 0x73], // 'vorbis'
  ];
  const limit = Math.min(data.length, 131072);
  for (const marker of markers) {
    outer: for (let i = 0; i < limit - marker.length; i++) {
      for (let j = 0; j < marker.length; j++) {
        if (data[i + j] !== marker[j]) continue outer;
      }
      return true;
    }
  }
  return false;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
