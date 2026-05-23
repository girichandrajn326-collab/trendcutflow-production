/**
 * AI processing service — Groq (Whisper) + OpenAI (GPT-4o-mini)
 *
 * In production these calls run server-side (Edge Function / API route) so
 * API keys are never shipped to the browser.  The functions here are written
 * as if they execute in that secure server context; the browser-side store
 * calls them via the simulated pipeline and will later proxy them through a
 * Supabase Edge Function.
 *
 * While real keys are absent the functions produce deterministic mock
 * responses that match the exact shape the rest of the app expects.
 */

import type { TranscriptWord } from '../types/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscriptResult {
  text: string;
  words: TranscriptWord[];
}

export interface ViralClipResult {
  startTime: number;
  endTime: number;
  viralTitles: string[];
  seoDescription: string;
  hashtags: string[];
  algorithmicTags: string[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Keys are injected at the Edge Function layer; absent in browser builds.
const GROQ_API_KEY = typeof process !== 'undefined' ? process.env.GROQ_API_KEY : undefined;
const OPENAI_API_KEY = typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : undefined;

// ─── Step 1: Transcribe ───────────────────────────────────────────────────────

/**
 * Submit an audio/video file (or a URL string) to Groq's Whisper-large-v3
 * endpoint and receive a word-level timestamped transcript.
 *
 * When GROQ_API_KEY is absent (browser preview / CI) the function returns a
 * realistic mock transcript after a simulated network delay.
 */
export async function transcribeVideo(videoFile: File | string): Promise<TranscriptResult> {
  if (!GROQ_API_KEY) {
    return simulateMockTranscription(videoFile);
  }

  const formData = new FormData();

  if (typeof videoFile === 'string') {
    // URL source: fetch the remote file and attach as a blob
    const res = await fetch(videoFile);
    const blob = await res.blob();
    formData.append('file', blob, 'audio.mp4');
  } else {
    formData.append('file', videoFile, videoFile.name);
  }

  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq transcription failed: ${err}`);
  }

  const data = await res.json();

  // Normalize Whisper verbose_json word timestamps to our internal shape
  const words: TranscriptWord[] = (data.words ?? []).map(
    (w: { word: string; start: number; end: number }, i: number) => ({
      id: i,
      word: w.word,
      start_ms: Math.round(w.start * 1000),
      end_ms: Math.round(w.end * 1000),
    }),
  );

  return { text: data.text ?? '', words };
}

// ─── Step 2: Find Viral Clips ─────────────────────────────────────────────────

/**
 * Send the full transcript to GPT-4o-mini with a structured prompt.
 * The model acts as a viral video producer and returns exactly 5 clip
 * candidates with timestamps, titles, description, hashtags, and SEO tags.
 *
 * When OPENAI_API_KEY is absent the function returns deterministic mock clips.
 */
export async function findViralClips(transcriptText: string): Promise<ViralClipResult[]> {
  if (!OPENAI_API_KEY) {
    return simulateMockViralClips(transcriptText);
  }

  const systemPrompt = `You are an elite viral video producer with a proven track record of creating short-form content that dominates TikTok, YouTube Shorts, and Instagram Reels. Your expertise lies in identifying the exact moments in long-form video that trigger emotional responses and maximum engagement.`;

  const userPrompt = `Analyze the following video transcript and extract EXACTLY 5 highly engaging segments suitable for viral short-form content.

For each segment you MUST provide:
- startTime: precise start timestamp in seconds (float)
- endTime: precise end timestamp in seconds (float, max 90 seconds per clip)
- viralTitles: array of exactly 3 attention-grabbing titles using proven viral hooks
- seoDescription: 2-3 sentence SEO-optimized description with primary keywords
- hashtags: array of 6-8 relevant hashtags including the # symbol
- algorithmicTags: array of 5-6 searchable keyword phrases (no # symbol)

Selection criteria — prioritize segments that contain:
1. Contrarian or surprising statements that challenge common beliefs
2. Specific numbers, percentages, or dollar amounts (social proof)
3. Personal failure or vulnerability followed by transformation
4. Actionable step-by-step advice that can be applied immediately
5. Emotional peaks — anger, inspiration, disbelief, or humor

Respond ONLY with a valid JSON array of exactly 5 objects. No prose, no markdown.

Transcript:
${transcriptText}`;

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI viral-clip detection failed: ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '[]';

  // GPT-4o-mini with json_object mode wraps the array in an object
  const parsed = JSON.parse(content);
  const clips: ViralClipResult[] = Array.isArray(parsed)
    ? parsed
    : (parsed.clips ?? parsed.segments ?? Object.values(parsed)[0] ?? []);

  return clips.slice(0, 5);
}

// ─── Mock helpers (used when API keys are absent) ─────────────────────────────

async function simulateMockTranscription(_source: File | string): Promise<TranscriptResult> {
  await delay(1800); // simulate Whisper latency

  const SAMPLE = `The single biggest shift I made was stop selling features and start selling outcomes. Nobody cares what your product does. They care about what their life looks like after they buy it. The moment I rewired my messaging around that one principle my conversion rate jumped from two percent to eleven percent in under sixty days. Most creators quit at exactly the wrong moment. They spend ninety days making content see no results and give up right before the algorithm would have rewarded them. I studied two hundred accounts that blew up. Here is the exact cold email structure. Line one is a hyper specific compliment about something they actually published. Line two is one sentence about your credibility. Line three is the offer framed as a result. When I started sharing my actual revenue numbers my following tripled in four months. At two in the morning I almost lost a ten thousand dollar client because my price was too low. They literally said you are too cheap to be credible.`;

  const words = buildTimestampedWords(SAMPLE);
  return { text: SAMPLE, words };
}

async function simulateMockViralClips(_transcript: string): Promise<ViralClipResult[]> {
  await delay(2200); // simulate GPT latency

  return [
    {
      startTime: 0,
      endTime: 58,
      viralTitles: [
        "I Changed ONE Thing & Made 5x More Revenue in 60 Days",
        "Stop Selling Features (Do This Instead)",
        "The Mindset That Took Me From 2% to 11% Conversion Rate",
      ],
      seoDescription: "Discover the single mindset shift that transformed my business revenue. Stop selling features and start selling outcomes — here's exactly how I did it and how you can too. Perfect for entrepreneurs, founders, and sales professionals looking to 10x their conversion rates.",
      hashtags: ["#BusinessGrowth", "#SalesTips", "#Entrepreneur", "#RevenueGrowth", "#MindsetShift", "#ConversionRate"],
      algorithmicTags: ["mindset shift business", "increase conversion rate", "sales strategy 2024", "entrepreneur tips", "business revenue growth"],
    },
    {
      startTime: 62,
      endTime: 124,
      viralTitles: [
        "Most Creators Quit RIGHT Before Going Viral (Here's Proof)",
        "The Algorithm Rewards This One Thing (It's Not Talent)",
        "I Studied 200 Viral Accounts — They All Did This",
      ],
      seoDescription: "After studying 200+ creator accounts that went viral, I found a shocking pattern. Most people quit between days 60-90 — the exact window before the algorithm rewards them. Here's what separates creators who blow up from those who give up.",
      hashtags: ["#ContentCreator", "#YouTubeTips", "#ViralContent", "#CreatorEconomy", "#SocialMediaGrowth", "#ConsistencyIsKey"],
      algorithmicTags: ["creator tips going viral", "youtube algorithm 2024", "content creator strategy", "grow on social media", "consistency content creation"],
    },
    {
      startTime: 130,
      endTime: 184,
      viralTitles: [
        "The 5-Line Cold Email That Gets 40% Reply Rates",
        "I Sent 10,000 Cold Emails — Here's What Actually Works",
        "Copy This Cold Email Formula (40% Response Rate)",
      ],
      seoDescription: "Cold email doesn't have to be painful. After 10,000+ cold emails sent, I've refined a 5-line formula that consistently achieves 40% reply rates. No long paragraphs, no formal greetings — just a proven structure that gets responses.",
      hashtags: ["#ColdEmail", "#EmailMarketing", "#LeadGeneration", "#SalesTips", "#OutreachStrategy", "#B2BSales"],
      algorithmicTags: ["cold email tips", "email outreach strategy", "b2b sales tactics", "lead generation emails", "sales email template"],
    },
    {
      startTime: 190,
      endTime: 255,
      viralTitles: [
        "I Shared My Real Revenue Numbers — My Following Tripled",
        "Build in Public: The Growth Strategy Nobody Talks About",
        "Why Showing Your Failures Online Is the Best Marketing",
      ],
      seoDescription: "Building in public transformed my online presence. By sharing real revenue, real failures, and real spreadsheets, I tripled my following in 4 months. Here's why radical transparency is the ultimate growth strategy for creators and founders.",
      hashtags: ["#BuildInPublic", "#CreatorEconomy", "#Transparency", "#PersonalBrand", "#StartupLife", "#ContentStrategy"],
      algorithmicTags: ["build in public strategy", "personal brand growth", "creator transparency", "grow following fast", "authentic content marketing"],
    },
    {
      startTime: 260,
      endTime: 311,
      viralTitles: [
        "A Client Said I Was 'Too Cheap to Be Credible' — So I Raised Prices",
        "Raising My Prices 40% Got Me MORE Clients (Here's Why)",
        "The 2AM Lesson That Changed My Entire Pricing Strategy",
      ],
      seoDescription: "A late-night conversation taught me the most important pricing lesson of my career. When a prospect said I was 'too cheap to be credible,' I raised my prices 40% and booked 3 new clients in 2 weeks. Price isn't just economics — it's positioning.",
      hashtags: ["#PricingStrategy", "#Freelance", "#BusinessTips", "#Consulting", "#ValueBasedPricing", "#Entrepreneurship"],
      algorithmicTags: ["pricing strategy business", "raise your prices", "value based pricing", "freelancer tips", "consulting pricing"],
    },
  ];
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function buildTimestampedWords(text: string): TranscriptWord[] {
  const tokens = text.split(' ');
  let ms = 0;
  return tokens.map((word, i) => {
    const duration = 220 + Math.random() * 280;
    const w: TranscriptWord = { id: i, word, start_ms: ms, end_ms: Math.round(ms + duration) };
    ms = Math.round(ms + duration + 60);
    return w;
  });
}
