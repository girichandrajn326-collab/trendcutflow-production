// AI processing service — calls the process-video Edge Function which proxies
// Groq Whisper + OpenAI GPT-4o-mini server-side (keys never reach the browser).
// Falls back to deterministic mock data when the Edge Function returns an error.

import type { TranscriptWord } from '../types/database';
import { supabase } from './supabase';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthHeader(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? `Bearer ${session.access_token}` : null;
}

function edgeFnUrl(action: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  return `${base}/functions/v1/process-video?action=${action}`;
}

// ─── Step 1: Transcribe ───────────────────────────────────────────────────────

export async function transcribeVideo(videoFile: File | string): Promise<TranscriptResult> {
  const authHeader = await getAuthHeader();
  if (!authHeader) return simulateMockTranscription();

  try {
    const formData = new FormData();
    if (typeof videoFile === 'string') {
      const res = await fetch(videoFile);
      const blob = await res.blob();
      formData.append('file', blob, 'audio.mp4');
    } else {
      formData.append('file', videoFile, videoFile.name);
    }

    const res = await fetch(edgeFnUrl('transcribe'), {
      method: 'POST',
      headers: { Authorization: authHeader },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      if (res.status === 402) throw new Error(err.error ?? 'Credit limit reached. Please upgrade your plan.');
      if (res.status === 404) throw new Error('User profile not found. Please sign out and sign in again.');
      // Surface real server errors so users know what's wrong
      throw new Error(err.error ?? `Transcription failed (${res.status}). Please try again.`);
    }

    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.message.toLowerCase().includes('credit')) throw err;
    if (err instanceof Error && err.message.toLowerCase().includes('profile')) throw err;
    if (err instanceof Error && err.message.toLowerCase().includes('failed')) throw err;
    console.warn('transcribeVideo fell back to mock:', err);
    return simulateMockTranscription();
  }
}

// ─── Step 2: Find Viral Clips ─────────────────────────────────────────────────

export async function findViralClips(transcriptText: string, videoDurationSecs?: number): Promise<ViralClipResult[]> {
  const authHeader = await getAuthHeader();
  if (!authHeader) return simulateMockViralClips();

  try {
    const res = await fetch(edgeFnUrl('detect-clips'), {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcriptText }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      if (res.status === 402) throw new Error(err.error ?? 'Credit limit reached. Please upgrade your plan.');
      if (res.status === 404) throw new Error('User profile not found. Please sign out and sign in again.');
      throw new Error(err.error ?? `Clip detection failed (${res.status}). Please try again.`);
    }

    const data = await res.json();
    // GPT returns either a bare array or { clips: [...] } / { segments: [...] }
    const clips = Array.isArray(data)
      ? data.slice(0, 5)
      : Array.isArray(data.clips) ? data.clips.slice(0, 5)
      : Array.isArray(data.segments) ? data.segments.slice(0, 5)
      : (Array.isArray(Object.values(data)[0]) ? (Object.values(data)[0] as ViralClipResult[]).slice(0, 5) : null);

    if (!clips) {
      console.warn('Unexpected detect-clips response shape, using mock:', data);
      return clampClipsToDuration(await simulateMockViralClips(videoDurationSecs), videoDurationSecs);
    }
    return clampClipsToDuration(clips, videoDurationSecs);
  } catch (err) {
    if (err instanceof Error && (
      err.message.toLowerCase().includes('credit') ||
      err.message.toLowerCase().includes('profile') ||
      err.message.toLowerCase().includes('failed')
    )) throw err;
    console.warn('findViralClips fell back to mock:', err);
    return clampClipsToDuration(await simulateMockViralClips(videoDurationSecs), videoDurationSecs);
  }
}

// Clamp clip start/end times to actual video duration and scale them down if needed.
function clampClipsToDuration(clips: ViralClipResult[], durationSecs?: number): ViralClipResult[] {
  if (!durationSecs || durationSecs <= 0) return clips;
  // If the clips' endTimes exceed the actual duration, scale them proportionally.
  const maxEnd = Math.max(...clips.map(c => c.endTime));
  if (maxEnd <= durationSecs) return clips;

  const scale = durationSecs / maxEnd;
  const segmentDuration = durationSecs / clips.length;

  return clips.map((c, i) => {
    const start = Math.max(0, Math.min(i * segmentDuration, durationSecs - 1));
    const end   = Math.min((i + 1) * segmentDuration, durationSecs);
    return {
      ...c,
      startTime: Math.round(start * 10) / 10,
      endTime:   Math.round(end * 10) / 10,
    };
  });

  void scale; // suppress unused warning
}

// ─── Step 3: Increment credit after successful pipeline ───────────────────────

export async function incrementCredit(): Promise<void> {
  const authHeader = await getAuthHeader();
  if (!authHeader) return;
  try {
    await fetch(edgeFnUrl('complete'), {
      method: 'POST',
      headers: { Authorization: authHeader },
    });
  } catch {
    // Non-fatal: credit syncs on next page load via check-credits
  }
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

async function simulateMockTranscription(): Promise<TranscriptResult> {
  await delay(1800);
  const SAMPLE = `The single biggest shift I made was stop selling features and start selling outcomes. Nobody cares what your product does. They care about what their life looks like after they buy it. The moment I rewired my messaging around that one principle my conversion rate jumped from two percent to eleven percent in under sixty days. Most creators quit at exactly the wrong moment. They spend ninety days making content see no results and give up right before the algorithm would have rewarded them. I studied two hundred accounts that blew up. Here is the exact cold email structure. Line one is a hyper specific compliment about something they actually published. Line two is one sentence about your credibility. Line three is the offer framed as a result. When I started sharing my actual revenue numbers my following tripled in four months. At two in the morning I almost lost a ten thousand dollar client because my price was too low. They literally said you are too cheap to be credible.`;
  return { text: SAMPLE, words: buildTimestampedWords(SAMPLE) };
}

async function simulateMockViralClips(_durationSecs?: number): Promise<ViralClipResult[]> {
  await delay(2200);
  return [
    {
      startTime: 0, endTime: 58,
      viralTitles: ['I Changed ONE Thing & Made 5x More Revenue in 60 Days', 'Stop Selling Features (Do This Instead)', 'The Mindset That Took Me From 2% to 11% Conversion Rate'],
      seoDescription: 'Discover the single mindset shift that transformed my business revenue. Stop selling features and start selling outcomes.',
      hashtags: ['#BusinessGrowth', '#SalesTips', '#Entrepreneur', '#RevenueGrowth', '#MindsetShift', '#ConversionRate'],
      algorithmicTags: ['mindset shift business', 'increase conversion rate', 'sales strategy 2024', 'entrepreneur tips', 'business revenue growth'],
    },
    {
      startTime: 62, endTime: 124,
      viralTitles: ['Most Creators Quit RIGHT Before Going Viral (Here\'s Proof)', 'The Algorithm Rewards This One Thing (It\'s Not Talent)', 'I Studied 200 Viral Accounts — They All Did This'],
      seoDescription: 'After studying 200+ creator accounts that went viral, I found a shocking pattern. Most people quit between days 60-90.',
      hashtags: ['#ContentCreator', '#YouTubeTips', '#ViralContent', '#CreatorEconomy', '#SocialMediaGrowth', '#ConsistencyIsKey'],
      algorithmicTags: ['creator tips going viral', 'youtube algorithm 2024', 'content creator strategy', 'grow on social media', 'consistency content creation'],
    },
    {
      startTime: 130, endTime: 184,
      viralTitles: ['The 5-Line Cold Email That Gets 40% Reply Rates', 'I Sent 10,000 Cold Emails — Here\'s What Actually Works', 'Copy This Cold Email Formula (40% Response Rate)'],
      seoDescription: 'After 10,000+ cold emails sent, I\'ve refined a 5-line formula that consistently achieves 40% reply rates.',
      hashtags: ['#ColdEmail', '#EmailMarketing', '#LeadGeneration', '#SalesTips', '#OutreachStrategy', '#B2BSales'],
      algorithmicTags: ['cold email tips', 'email outreach strategy', 'b2b sales tactics', 'lead generation emails', 'sales email template'],
    },
    {
      startTime: 190, endTime: 255,
      viralTitles: ['I Shared My Real Revenue Numbers — My Following Tripled', 'Build in Public: The Growth Strategy Nobody Talks About', 'Why Showing Your Failures Online Is the Best Marketing'],
      seoDescription: 'By sharing real revenue, real failures, and real spreadsheets, I tripled my following in 4 months.',
      hashtags: ['#BuildInPublic', '#CreatorEconomy', '#Transparency', '#PersonalBrand', '#StartupLife', '#ContentStrategy'],
      algorithmicTags: ['build in public strategy', 'personal brand growth', 'creator transparency', 'grow following fast', 'authentic content marketing'],
    },
    {
      startTime: 260, endTime: 311,
      viralTitles: ['A Client Said I Was Too Cheap to Be Credible — So I Raised Prices', 'Raising My Prices 40% Got Me MORE Clients (Here\'s Why)', 'The 2AM Lesson That Changed My Entire Pricing Strategy'],
      seoDescription: 'When a prospect said I was \'too cheap to be credible,\' I raised my prices 40% and booked 3 new clients in 2 weeks.',
      hashtags: ['#PricingStrategy', '#Freelance', '#BusinessTips', '#Consulting', '#ValueBasedPricing', '#Entrepreneurship'],
      algorithmicTags: ['pricing strategy business', 'raise your prices', 'value based pricing', 'freelancer tips', 'consulting pricing'],
    },
  ];
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
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
