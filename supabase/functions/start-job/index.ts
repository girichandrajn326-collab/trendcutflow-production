// Edge Function: start-job
//
// Receives a video file (multipart) or a YouTube URL (JSON), inserts a
// processing_jobs row, returns { jobId } immediately, then processes the
// video asynchronously inside EdgeRuntime.waitUntil().
//
// Background pipeline:
//   downloading → audio_check → extracting_audio → transcribing
//   → detecting → slicing → completed | failed
//
// This eliminates browser-side "Failed to fetch" timeouts: the client
// gets a jobId in seconds and polls processing_jobs for progress.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GROQ_TRANSCRIBE_URL   = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_CHAT_URL       = "https://api.openai.com/v1/chat/completions";
const MAX_UPLOAD_BYTES      = 300 * 1024 * 1024; // 300 MB hard cap

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  // ── Credit pre-check ────────────────────────────────────────────────────────
  const { data: canProcess } = await supabase.rpc("can_process_video", { uid: user.id });
  if (!canProcess) {
    return json({ error: "Credit limit reached. Please upgrade your plan." }, 402);
  }

  // ── Parse request ────────────────────────────────────────────────────────────
  let fileBytes: Uint8Array | null = null;
  let fileName    = "video.mp4";
  let fileType    = "video/mp4";
  let sourceUrl:  string | null = null;
  let sourceType  = "file";

  const ct = req.headers.get("Content-Type") ?? "";

  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); }
    catch { return json({ error: "Failed to parse multipart form data" }, 400); }

    const file = form.get("file") as File | null;
    if (!file) return json({ error: "No file field in form data" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return json({ error: `File too large (max 300 MB). Use a YouTube URL instead.` }, 413);
    }

    fileBytes = new Uint8Array(await file.arrayBuffer());
    fileName  = file.name || "video.mp4";
    fileType  = file.type || "video/mp4";
  } else {
    let body: Record<string, string>;
    try { body = await req.json(); }
    catch { return json({ error: "Invalid JSON body" }, 400); }

    sourceUrl  = body.sourceUrl?.trim() ?? null;
    sourceType = body.sourceType ?? "youtube";
    if (!sourceUrl) return json({ error: "sourceUrl is required for non-file jobs" }, 400);

    const isYT = /youtube\.com|youtu\.be/i.test(sourceUrl);
    if (!isYT) return json({ error: "Only YouTube URLs are supported via URL input" }, 400);
  }

  // ── Create job ───────────────────────────────────────────────────────────────
  const jobId = crypto.randomUUID();
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "mp4";

  // Upload file bytes to Storage so the job is resumable and auditable
  let storagePath: string | null = null;
  if (fileBytes) {
    storagePath = `uploads/${user.id}/${jobId}/${fileName}`;
    const { error: storageErr } = await supabase.storage
      .from("video-uploads")
      .upload(storagePath, fileBytes, { contentType: fileType, upsert: false });
    if (storageErr) {
      console.error("Storage upload error:", storageErr.message);
      storagePath = null; // will fall back to in-memory bytes
    }
  }

  await supabase.from("processing_jobs").insert({
    id:            jobId,
    user_id:       user.id,
    storage_path:  storagePath,
    source_type:   sourceType,
    source_url:    sourceUrl,
    original_name: fileName,
    status:        "queued",
    progress:      0,
  });

  // ── Kick off background work, return jobId immediately ───────────────────────
  const bgPromise = runJobBackground({
    jobId, userId: user.id,
    fileBytes, fileName, ext,
    storagePath, sourceUrl, sourceType,
    supabase,
  });

  // deno-lint-ignore no-explicit-any
  const ert = (globalThis as any).EdgeRuntime;
  if (ert?.waitUntil) {
    ert.waitUntil(bgPromise);
  } else {
    bgPromise.catch(console.error); // local dev fallback
  }

  return json({ jobId });
});

// ─── Background job runner ────────────────────────────────────────────────────

interface JobContext {
  jobId:       string;
  userId:      string;
  fileBytes:   Uint8Array | null;
  fileName:    string;
  ext:         string;
  storagePath: string | null;
  sourceUrl:   string | null;
  sourceType:  string;
  // deno-lint-ignore no-explicit-any
  supabase:    any;
}

async function runJobBackground(ctx: JobContext): Promise<void> {
  const { jobId, userId, supabase } = ctx;

  const setStatus = async (
    status: string,
    detail?: string,
    extra: Record<string, unknown> = {},
  ) => {
    await supabase.from("processing_jobs").update({
      status,
      step_detail:  detail ?? null,
      updated_at:   new Date().toISOString(),
      ...extra,
    }).eq("id", jobId);
  };

  const inputPath = `/tmp/${jobId}_input.${ctx.ext}`;
  const audioPath = `/tmp/${jobId}_audio.mp3`;

  try {
    // ── 1. Download / write to /tmp ─────────────────────────────────────────
    await setStatus("downloading", "Saving video to processing buffer…");

    if (ctx.fileBytes) {
      await Deno.writeFile(inputPath, ctx.fileBytes);
    } else if (ctx.sourceType === "youtube" && ctx.sourceUrl) {
      await setStatus("downloading", `Downloading from YouTube: ${ctx.sourceUrl}`);
      await ytdlpDownload(ctx.sourceUrl, inputPath);
    } else {
      throw new Error("No input source available");
    }

    // ── 2. Audio detection ──────────────────────────────────────────────────
    await setStatus("audio_check", "Probing audio stream…");

    let hasAudio = false;
    let videoDurationSecs: number | undefined;

    const probeResult = await ffprobeJson(inputPath);
    if (probeResult) {
      hasAudio         = probeResult.streams?.some((s: { codec_type: string }) => s.codec_type === "audio") ?? false;
      videoDurationSecs = parseFloat(probeResult.format?.duration ?? "0") || undefined;
    } else {
      // ffprobe not available — binary scan
      const raw = await Deno.readFile(inputPath);
      hasAudio  = scanBinaryForAudio(raw.slice(0, 131072));
    }

    await supabase.from("processing_jobs").update({
      has_audio:   hasAudio,
      step_detail: `Audio detected: ${hasAudio ? "Yes" : "No"}`,
      updated_at:  new Date().toISOString(),
    }).eq("id", jobId);

    // ── 3–5. Transcribe → Detect (audio path) OR time-based (silent path) ──
    let clips: ClipResult[];

    if (hasAudio) {
      // ── 3. Extract 32 kbps mono MP3 with FFmpeg ─────────────────────────
      await setStatus("extracting_audio", "Extracting 32 kbps mono audio with FFmpeg…");

      const ffmpegOk = await extractAudioMp3(inputPath, audioPath);
      if (!ffmpegOk) {
        // FFmpeg absent — send raw video to Whisper if ≤ 25 MB
        const { size } = await Deno.stat(inputPath);
        if (size > 24 * 1024 * 1024) {
          throw new Error(
            "Video is too large for Whisper (>25 MB) and FFmpeg is unavailable. " +
            "Please trim the video to under 10 minutes before uploading.",
          );
        }
        await Deno.copyFile(inputPath, audioPath);
      }

      // ── 4. Whisper transcription ─────────────────────────────────────────
      await setStatus("transcribing", "Transcribing with Groq Whisper…");

      const { text: transcriptText, words } = await whisperTranscribe(audioPath);

      // ── 5. GPT-4o-mini viral segment detection ───────────────────────────
      await setStatus("detecting", "Detecting viral segments with GPT-4o-mini…");

      const rawClips = await detectClips(transcriptText);

      // Attach matching transcript words to each clip
      clips = rawClips.slice(0, 5).map(r => ({
        ...r,
        transcriptWords: words.filter(
          w => w.start_ms / 1000 >= r.startTime && w.end_ms / 1000 <= r.endTime,
        ),
      }));

      // Clamp/scale clip timestamps to actual video duration
      if (videoDurationSecs && videoDurationSecs > 0) {
        clips = clampClips(clips, videoDurationSecs);
      }
    } else {
      // ── Silent video: time-based 30-second segmentation ──────────────────
      await setStatus("slicing", "Building time-based visual clips…");

      const duration = videoDurationSecs ?? 300;
      const count    = Math.min(5, Math.max(1, Math.floor(duration / 30)));
      const seg      = duration / count;

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

    // ── 6. Slicing step UI marker ────────────────────────────────────────────
    await setStatus("slicing", `${clips.length} clips ready. Finalising…`);

    // ── 7. Consume one credit (atomic RPC) ───────────────────────────────────
    const { error: creditErr } = await supabase.rpc("consume_credit", { uid: userId });
    if (creditErr) console.error("consume_credit failed:", creditErr.message);

    // ── 8. Persist: video_sources + repurposed_clips ─────────────────────────
    try {
      const sourceTitle = ctx.sourceUrl ?? ctx.fileName;
      const { data: vsRow } = await supabase
        .from("video_sources")
        .insert({ user_id: userId, title: sourceTitle, source_url: ctx.sourceUrl ?? "", status: "COMPLETED", duration: videoDurationSecs ?? 0 })
        .select("id")
        .maybeSingle();

      if (vsRow) {
        await supabase.from("repurposed_clips").insert(
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
    }

    // ── 9. Mark completed ────────────────────────────────────────────────────
    await supabase.from("processing_jobs").update({
      status:           "completed",
      step_detail:      `${clips.length} clips extracted`,
      progress:         100,
      credits_consumed: !creditErr,
      result: {
        hasAudio,
        videoDurationSecs,
        sourceTitle:   ctx.sourceUrl ?? ctx.fileName,
        clips,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Job ${jobId} failed:`, msg);
    await supabase.from("processing_jobs").update({
      status:        "failed",
      error_message: msg,
      updated_at:    new Date().toISOString(),
    }).eq("id", jobId).catch(() => {});
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
    const cmd = new Deno.Command("ffmpeg", {
      args: [
        "-y",
        "-i",        inputPath,
        "-vn",
        "-acodec",   "libmp3lame",
        "-ac",       "1",          // mono
        "-ar",       "16000",      // 16 kHz — optimal for speech
        "-ab",       "32k",        // 32 kbps — keeps well under 25 MB
        outputPath,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    return result.code === 0;
  } catch {
    return false; // ffmpeg not in PATH
  }
}

interface TranscriptWord {
  id:       number;
  word:     string;
  start_ms: number;
  end_ms:   number;
}

async function whisperTranscribe(audioPath: string): Promise<{ text: string; words: TranscriptWord[] }> {
  const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY secret is not configured");

  const audioBytes = await Deno.readFile(audioPath);
  const audioBlob  = new Blob([audioBytes], { type: "audio/mpeg" });

  const form = new FormData();
  form.append("file",                  audioBlob, "audio.mp3");
  form.append("model",                 "whisper-large-v3");
  form.append("response_format",       "verbose_json");
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
  const text: string = data.text ?? "";
  const words: TranscriptWord[] = (data.words ?? []).map(
    (w: { word: string; start: number; end: number }, i: number) => ({
      id:       i,
      word:     w.word,
      start_ms: Math.round(w.start * 1000),
      end_ms:   Math.round(w.end   * 1000),
    }),
  );
  return { text, words };
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

async function detectClips(transcriptText: string): Promise<RawClip[]> {
  const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY secret is not configured");

  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
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

  const segmentDuration = durationSecs / clips.length;
  return clips.map((c, i) => ({
    ...c,
    startTime: Math.round(Math.max(0, i * segmentDuration) * 10) / 10,
    endTime:   Math.round(Math.min((i + 1) * segmentDuration, durationSecs) * 10) / 10,
  }));
}

// Scan first 128 KB for audio codec markers (MP4 / WebM container formats)
function scanBinaryForAudio(data: Uint8Array): boolean {
  const markers: number[][] = [
    [0x73, 0x6F, 0x75, 0x6E],              // 'soun'   MP4 handler type
    [0x6D, 0x70, 0x34, 0x61],              // 'mp4a'   AAC
    [0x41, 0x5F, 0x4F, 0x50, 0x55, 0x53], // 'A_OPUS'
    [0x41, 0x5F, 0x56, 0x4F, 0x52],        // 'A_VOR'  Vorbis prefix
    [0x41, 0x5F, 0x41, 0x41, 0x43],        // 'A_AAC'
    [0x6F, 0x70, 0x75, 0x73],              // 'opus'
    [0x76, 0x6F, 0x72, 0x62, 0x69, 0x73], // 'vorbis'
  ];

  outer: for (const marker of markers) {
    for (let i = 0; i < data.length - marker.length; i++) {
      let match = true;
      for (let j = 0; j < marker.length; j++) {
        if (data[i + j] !== marker[j]) { match = false; break; }
      }
      if (match) return true;
      continue outer;
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
