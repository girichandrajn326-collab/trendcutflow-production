// Edge Function: process-video
// Proxies AI calls (Groq Whisper transcription + OpenAI viral clip detection)
// keeping API keys server-side. Also enforces credits before running.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── Credit check ─────────────────────────────────────────────────────────
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("credits_used, total_credits")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return json({ error: "User profile not found" }, 404);
    }
    if (profile.credits_used >= profile.total_credits) {
      return json({ error: "Credit limit reached. Please upgrade your plan." }, 402);
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // ── Route: transcribe ─────────────────────────────────────────────────────
    if (action === "transcribe") {
      const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
      if (!GROQ_KEY) {
        // Return mock when key not configured
        return json(buildMockTranscript());
      }

      const formData = await req.formData();
      const audioFile = formData.get("file") as File | null;
      if (!audioFile) return json({ error: "No file provided" }, 400);

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
        return json({ error: `Groq error: ${err}` }, 502);
      }

      const data = await groqRes.json();
      const words = (data.words ?? []).map(
        (w: { word: string; start: number; end: number }, i: number) => ({
          id: i,
          word: w.word,
          start_ms: Math.round(w.start * 1000),
          end_ms: Math.round(w.end * 1000),
        }),
      );
      return json({ text: data.text ?? "", words });
    }

    // ── Route: detect-clips ───────────────────────────────────────────────────
    if (action === "detect-clips") {
      const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_KEY) {
        return json(buildMockClips());
      }

      const body = await req.json();
      const transcriptText: string = body.transcript ?? "";

      const systemPrompt = `You are an elite viral video producer. Identify the most engaging segments from the transcript for short-form content.`;
      const userPrompt = `Analyze this transcript and extract EXACTLY 5 highly engaging segments for viral short-form content.

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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.7,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!openaiRes.ok) {
        const err = await openaiRes.text();
        return json({ error: `OpenAI error: ${err}` }, 502);
      }

      const data = await openaiRes.json();
      const content = data.choices?.[0]?.message?.content ?? "[]";
      const parsed = JSON.parse(content);
      const clips = Array.isArray(parsed)
        ? parsed
        : (parsed.clips ?? parsed.segments ?? Object.values(parsed)[0] ?? []);

      return json(clips.slice(0, 5));
    }

    // ── Route: complete (transcribe + detect + increment credit) ──────────────
    if (action === "complete") {
      // Increment credits_used now that we know processing succeeded
      await supabase
        .from("users")
        .update({ credits_used: profile.credits_used + 1 })
        .eq("id", user.id);

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
    {
      startTime: 0, endTime: 58,
      viralTitles: ["I Changed ONE Thing & Made 5x More Revenue in 60 Days", "Stop Selling Features (Do This Instead)", "The Mindset That Took Me From 2% to 11% Conversion Rate"],
      seoDescription: "Discover the single mindset shift that transformed my business revenue. Stop selling features and start selling outcomes.",
      hashtags: ["#BusinessGrowth", "#SalesTips", "#Entrepreneur", "#RevenueGrowth", "#MindsetShift", "#ConversionRate"],
      algorithmicTags: ["mindset shift business", "increase conversion rate", "sales strategy 2024", "entrepreneur tips", "business revenue growth"],
    },
    {
      startTime: 62, endTime: 124,
      viralTitles: ["Most Creators Quit RIGHT Before Going Viral (Here's Proof)", "The Algorithm Rewards This One Thing (It's Not Talent)", "I Studied 200 Viral Accounts — They All Did This"],
      seoDescription: "After studying 200+ creator accounts that went viral, I found a shocking pattern. Most people quit between days 60-90.",
      hashtags: ["#ContentCreator", "#YouTubeTips", "#ViralContent", "#CreatorEconomy", "#SocialMediaGrowth", "#ConsistencyIsKey"],
      algorithmicTags: ["creator tips going viral", "youtube algorithm 2024", "content creator strategy", "grow on social media", "consistency content creation"],
    },
    {
      startTime: 130, endTime: 184,
      viralTitles: ["The 5-Line Cold Email That Gets 40% Reply Rates", "I Sent 10,000 Cold Emails — Here's What Actually Works", "Copy This Cold Email Formula (40% Response Rate)"],
      seoDescription: "After 10,000+ cold emails sent, I've refined a 5-line formula that consistently achieves 40% reply rates.",
      hashtags: ["#ColdEmail", "#EmailMarketing", "#LeadGeneration", "#SalesTips", "#OutreachStrategy", "#B2BSales"],
      algorithmicTags: ["cold email tips", "email outreach strategy", "b2b sales tactics", "lead generation emails", "sales email template"],
    },
    {
      startTime: 190, endTime: 255,
      viralTitles: ["I Shared My Real Revenue Numbers — My Following Tripled", "Build in Public: The Growth Strategy Nobody Talks About", "Why Showing Your Failures Online Is the Best Marketing"],
      seoDescription: "By sharing real revenue, real failures, and real spreadsheets, I tripled my following in 4 months.",
      hashtags: ["#BuildInPublic", "#CreatorEconomy", "#Transparency", "#PersonalBrand", "#StartupLife", "#ContentStrategy"],
      algorithmicTags: ["build in public strategy", "personal brand growth", "creator transparency", "grow following fast", "authentic content marketing"],
    },
    {
      startTime: 260, endTime: 311,
      viralTitles: ["A Client Said I Was 'Too Cheap to Be Credible' — So I Raised Prices", "Raising My Prices 40% Got Me MORE Clients (Here's Why)", "The 2AM Lesson That Changed My Entire Pricing Strategy"],
      seoDescription: "When a prospect said I was 'too cheap to be credible,' I raised my prices 40% and booked 3 new clients in 2 weeks.",
      hashtags: ["#PricingStrategy", "#Freelance", "#BusinessTips", "#Consulting", "#ValueBasedPricing", "#Entrepreneurship"],
      algorithmicTags: ["pricing strategy business", "raise your prices", "value based pricing", "freelancer tips", "consulting pricing"],
    },
  ];
}
