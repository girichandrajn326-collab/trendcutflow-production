// Edge Function: process-video
// Proxies AI calls (Groq Whisper + OpenAI GPT-4o-mini) server-side.
// Enforces credits via DB RPCs. Logs every step to processing_logs.
// check-audio action: detects audio streams via ffprobe (binary) or binary scan fallback.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GROQ_API_URL   = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

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
    message:     message     ?? null,
    error_code:  errorCode   ?? null,
    duration_ms: durationMs  ?? null,
    updated_at:  new Date().toISOString(),
  }).eq("id", logId);
}

// ─── Audio detection ──────────────────────────────────────────────────────────

interface AudioCheckResult {
  hasAudio: boolean;
  duration?: number;
  method: "ffprobe" | "binary-scan";
}

// Scan binary data for known audio codec / handler-type markers.
// Covers MP4 ('soun' handler, 'mp4a' codec) and WebM (A_OPUS, A_VORBIS, A_AAC).
function scanBinaryForAudio(data: Uint8Array): boolean {
  const markers: number[][] = [
    [0x73, 0x6F, 0x75, 0x6E],             // 'soun'  — MP4 audio handler type
    [0x6D, 0x70, 0x34, 0x61],             // 'mp4a'  — AAC in MP4
    [0x61, 0x63, 0x2D, 0x33],             // 'ac-3'  — AC3 audio
    [0x65, 0x63, 0x2D, 0x33],             // 'ec-3'  — Dolby Digital Plus
    [0x41, 0x5F, 0x4F, 0x50, 0x55, 0x53], // 'A_OPUS'
    [0x41, 0x5F, 0x56, 0x4F, 0x52],       // 'A_VOR' (A_VORBIS)
    [0x41, 0x5F, 0x41, 0x41, 0x43],       // 'A_AAC'
    [0x6F, 0x70, 0x75, 0x73],             // 'opus'  — Opus in WebM
    [0x76, 0x6F, 0x72, 0x62, 0x69, 0x73], // 'vorbis'
  ];

  // Only scan first 128 KB — audio headers appear early in the container
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

async function detectAudioWithFfprobe(
  fileBytes: Uint8Array,
): Promise<AudioCheckResult | null> {
  try {
    const child = new Deno.Command("ffprobe", {
      args: [
        "-v", "error",
        "-print_format", "json",
        "-show_streams",
        "-show_format",
        "-i", "pipe:0",
      ],
      stdin:  "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    const writer = child.stdin.getWriter();
    await writer.write(fileBytes);
    await writer.close();

    const { code, stdout } = await child.output();
    if (code !== 0) return null;

    const info = JSON.parse(new TextDecoder().decode(stdout));
    const streams: { codec_type: string }[] = info.streams ?? [];
    const hasAudio = streams.some(s => s.codec_type === "audio");
    const duration = parseFloat(info.format?.duration ?? "0") || undefined;

    return { hasAudio, duration, method: "ffprobe" };
  } catch {
    return null; // ffprobe not available
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
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

    const url    = new URL(req.url);
    const action = url.searchParams.get("action");

    // ── Route: check-audio ────────────────────────────────────────────────────
    // Receives the first ~512 KB of the video file and detects audio streams.
    // No credit check needed — this is a lightweight pre-flight call.
    if (action === "check-audio") {
      const logId = await insertLog(supabase, user.id, "audio-check", "pending");
      const start = Date.now();

      try {
        const formData  = await req.formData();
        const chunk     = formData.get("file") as File | null;
        if (!chunk) {
          await updateLog(supabase, logId, "error", "No file chunk provided", "MISSING_CHUNK");
          return json({ error: "No file chunk provided" }, 400);
        }

        const fileBytes = new Uint8Array(await chunk.arrayBuffer());

        // Try ffprobe first; fall back to binary scan
        let result = await detectAudioWithFfprobe(fileBytes);
        if (!result) {
          const hasAudio = scanBinaryForAudio(fileBytes);
          result = { hasAudio, method: "binary-scan" };
        }

        const durationMs = Date.now() - start;
        const logMsg = `Audio detected: ${result.hasAudio ? "Yes" : "No"} (method: ${result.method})`;
        await updateLog(supabase, logId, "success", logMsg, undefined, durationMs);

        return json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await updateLog(supabase, logId, "error", msg, "CHECK_AUDIO_FAILED", Date.now() - start).catch(() => {});
        // On any error, assume audio present so the normal pipeline runs
        return json({ hasAudio: true, method: "binary-scan", error: msg });
      }
    }

    // ── Credit guard (required for all processing actions) ────────────────────
    const { data: canProcess, error: guardError } = await supabase
      .rpc("can_process_video", { uid: user.id });

    if (guardError) return json({ error: "Credit check failed: " + guardError.message }, 500);
    if (!canProcess) return json({ error: "Credit limit reached. Please upgrade your plan." }, 402);

    // ── Route: transcribe ─────────────────────────────────────────────────────
    if (action === "transcribe") {
      const logId = await insertLog(supabase, user.id, "transcribe", "pending");
      const start = Date.now();

      try {
        const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
        if (!GROQ_KEY) {
          await updateLog(supabase, logId, "success", "mock response (no GROQ_API_KEY)", undefined, 0);
          return json(buildMockTranscript());
        }

        const formData  = await req.formData();
        const audioFile = formData.get("file") as File | null;
        if (!audioFile) {
          await updateLog(supabase, logId, "error", "No file provided", "MISSING_FILE");
          return json({ error: "No file provided" }, 400);
        }

        const groqForm = new FormData();
        groqForm.append("file", audioFile, audioFile.name || "audio.mp4");
        groqForm.append("model", "whisper-large-v3");
        groqForm.append("response_format", "verbose_json");
        groqForm.append("timestamp_granularities[]", "word");

        const groqRes = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_KEY}` },
          body: groqForm,
        });

        if (!groqRes.ok) {
          const err = await groqRes.text();
          await updateLog(supabase, logId, "error", `Groq error: ${err}`, String(groqRes.status), Date.now() - start);
          return json({ error: `Groq error: ${err}` }, 502);
        }

        const data  = await groqRes.json();
        const words = (data.words ?? []).map(
          (w: { word: string; start: number; end: number }, i: number) => ({
            id: i, word: w.word,
            start_ms: Math.round(w.start * 1000),
            end_ms:   Math.round(w.end   * 1000),
          }),
        );

        await updateLog(supabase, logId, "success", undefined, undefined, Date.now() - start);
        return json({ text: data.text ?? "", words });

      } catch (err) {
        const msg  = err instanceof Error ? err.message : String(err);
        await updateLog(supabase, logId, "error", msg, (err as { code?: string }).code, Date.now() - start).catch(() => {});
        return json({ error: `Transcription failed: ${msg}` }, 502);
      }
    }

    // ── Route: detect-clips (segment) ─────────────────────────────────────────
    if (action === "detect-clips") {
      const logId = await insertLog(supabase, user.id, "segment", "pending");
      const start = Date.now();

      try {
        const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
        if (!OPENAI_KEY) {
          await updateLog(supabase, logId, "success", "mock response (no OPENAI_API_KEY)", undefined, 0);
          return json(buildMockClips());
        }

        const body           = await req.json();
        const transcriptText = String(body.transcript ?? "");

        const systemPrompt = `You are an elite viral video producer. Identify the most engaging segments from the transcript for short-form content.`;
        const userPrompt   = `Analyze this transcript and extract EXACTLY 5 highly engaging segments for viral short-form content.

For each segment provide:
- startTime: start timestamp in seconds (float)
- endTime: end timestamp in seconds (float, max 90s per clip)
- viralTitles: array of exactly 3 attention-grabbing titles
- seoDescription: 2-3 sentence SEO-optimized description
- hashtags: array of 6-8 relevant hashtags (with # symbol)
- algorithmicTags: array of 5-6 searchable keyword phrases (no # symbol)

Respond ONLY with valid JSON array of exactly 5 objects.

Transcript:
${transcriptText}`;

        const openaiRes = await fetch(OPENAI_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user",   content: userPrompt },
            ],
          }),
        });

        if (!openaiRes.ok) {
          const err = await openaiRes.text();
          await updateLog(supabase, logId, "error", `OpenAI error: ${err}`, String(openaiRes.status), Date.now() - start);
          return json({ error: `OpenAI error: ${err}` }, 502);
        }

        const data    = await openaiRes.json();
        const content = data.choices?.[0]?.message?.content ?? "[]";
        const parsed  = JSON.parse(content);
        const clips   = Array.isArray(parsed)
          ? parsed
          : (parsed.clips ?? parsed.segments ?? Object.values(parsed)[0] ?? []);

        await updateLog(supabase, logId, "success", undefined, undefined, Date.now() - start);
        return json((clips as unknown[]).slice(0, 5));

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await updateLog(supabase, logId, "error", msg, (err as { code?: string }).code, Date.now() - start).catch(() => {});
        return json({ error: `Segment detection failed: ${msg}` }, 502);
      }
    }

    // ── Route: render-log — client posts FFmpeg render outcome ────────────────
    if (action === "render-log") {
      try {
        const body: { status: LogStatus; errorCode?: string; durationMs?: number; message?: string } =
          await req.json();
        const logId = await insertLog(supabase, user.id, "render", body.status, body.message);
        if (logId && body.status !== "pending") {
          await updateLog(supabase, logId, body.status, body.message, body.errorCode, body.durationMs);
        }
        return json({ ok: true });
      } catch (err) {
        return json({ error: "render-log failed: " + String(err) }, 500);
      }
    }

    // ── Route: complete — atomically consume one credit ───────────────────────
    if (action === "complete") {
      const { error: consumeError } = await supabase
        .rpc("consume_credit", { uid: user.id });
      if (consumeError) {
        return json({ error: "Failed to consume credit: " + consumeError.message }, 500);
      }
      return json({ ok: true });
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

// ── Mock responses when API keys are absent ───────────────────────────────────

function buildMockTranscript() {
  const SAMPLE = `The single biggest shift I made was stop selling features and start selling outcomes. Nobody cares what your product does. They care about what their life looks like after they buy it. The moment I rewired my messaging around that one principle my conversion rate jumped from two percent to eleven percent in under sixty days. Most creators quit at exactly the wrong moment. They spend ninety days making content see no results and give up right before the algorithm would have rewarded them. I studied two hundred accounts that blew up. Here is the exact cold email structure. Line one is a hyper specific compliment about something they actually published. Line two is one sentence about your credibility. Line three is the offer framed as a result. When I started sharing my actual revenue numbers my following tripled in four months. At two in the morning I almost lost a ten thousand dollar client because my price was too low. They literally said you are too cheap to be credible.`;
  const tokens = SAMPLE.split(" ");
  let ms = 0;
  const words = tokens.map((word: string, i: number) => {
    const dur = 220 + Math.random() * 280;
    const w = { id: i, word, start_ms: ms, end_ms: Math.round(ms + dur) };
    ms = Math.round(ms + dur + 60);
    return w;
  });
  return { text: SAMPLE, words };
}

function buildMockClips() {
  return [
    { startTime: 0,   endTime: 58,  viralTitles: ["I Changed ONE Thing & Made 5x More Revenue in 60 Days", "Stop Selling Features (Do This Instead)", "The Mindset That Took Me From 2% to 11% Conversion Rate"], seoDescription: "Discover the single mindset shift that transformed my business revenue.", hashtags: ["#BusinessGrowth","#SalesTips","#Entrepreneur","#RevenueGrowth","#MindsetShift","#ConversionRate"], algorithmicTags: ["mindset shift business","increase conversion rate","sales strategy 2024","entrepreneur tips","business revenue growth"] },
    { startTime: 62,  endTime: 124, viralTitles: ["Most Creators Quit RIGHT Before Going Viral (Here's Proof)", "The Algorithm Rewards This One Thing (It's Not Talent)", "I Studied 200 Viral Accounts — They All Did This"], seoDescription: "After studying 200+ creator accounts that went viral, I found a shocking pattern.", hashtags: ["#ContentCreator","#YouTubeTips","#ViralContent","#CreatorEconomy","#SocialMediaGrowth","#ConsistencyIsKey"], algorithmicTags: ["creator tips going viral","youtube algorithm 2024","content creator strategy","grow on social media","consistency content creation"] },
    { startTime: 130, endTime: 184, viralTitles: ["The 5-Line Cold Email That Gets 40% Reply Rates", "I Sent 10,000 Cold Emails — Here's What Actually Works", "Copy This Cold Email Formula (40% Response Rate)"], seoDescription: "After 10,000+ cold emails sent, I've refined a 5-line formula.", hashtags: ["#ColdEmail","#EmailMarketing","#LeadGeneration","#SalesTips","#OutreachStrategy","#B2BSales"], algorithmicTags: ["cold email tips","email outreach strategy","b2b sales tactics","lead generation emails","sales email template"] },
    { startTime: 190, endTime: 255, viralTitles: ["I Shared My Real Revenue Numbers — My Following Tripled", "Build in Public: The Growth Strategy Nobody Talks About", "Why Showing Your Failures Online Is the Best Marketing"], seoDescription: "By sharing real revenue and real failures, I tripled my following in 4 months.", hashtags: ["#BuildInPublic","#CreatorEconomy","#Transparency","#PersonalBrand","#StartupLife","#ContentStrategy"], algorithmicTags: ["build in public strategy","personal brand growth","creator transparency","grow following fast","authentic content marketing"] },
    { startTime: 260, endTime: 311, viralTitles: ["A Client Said I Was 'Too Cheap to Be Credible' — So I Raised Prices", "Raising My Prices 40% Got Me MORE Clients (Here's Why)", "The 2AM Lesson That Changed My Entire Pricing Strategy"], seoDescription: "When a prospect said I was 'too cheap to be credible,' I raised my prices 40%.", hashtags: ["#PricingStrategy","#Freelance","#BusinessTips","#Consulting","#ValueBasedPricing","#Entrepreneurship"], algorithmicTags: ["pricing strategy business","raise your prices","value based pricing","freelancer tips","consulting pricing"] },
  ];
}
