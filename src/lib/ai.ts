// AI processing service — calls Groq Whisper + OpenAI GPT-4o-mini directly
// from the browser. API keys are read from Vite env vars.
// Throws real errors — no mock/sample fallback data.

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

export interface AudioCheckResult {
  hasAudio: boolean;
  duration?: number;
  method: 'ffprobe' | 'binary-scan' | 'assumed';
}

// ─── Config ───────────────────────────────────────────────────────────────────

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const GROQ_TIMEOUT_MS = 300_000;
const OPENAI_TIMEOUT_MS = 120_000;

function getGroqKey(): string {
  const key = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
  if (!key) throw new Error('Groq API key is not configured. Add VITE_GROQ_API_KEY to your environment.');
  return key;
}

function getOpenAIKey(): string {
  const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!key) throw new Error('OpenAI API key is not configured. Add VITE_OPENAI_API_KEY to your environment.');
  return key;
}

// ─── Step 0: Pre-flight audio check ──────────────────────────────────────────
// Browser cannot run ffprobe, so we assume audio is present and let the
// transcription step determine the real answer.

export async function checkVideoAudio(_videoFile: File): Promise<AudioCheckResult> {
  return { hasAudio: true, method: 'assumed' };
}

// ─── Step 1: Transcribe ───────────────────────────────────────────────────────

export async function transcribeVideo(videoFile: File | string): Promise<TranscriptResult> {
  try {
    let file: File | Blob;
    let fileName: string;

    if (typeof videoFile === 'string') {
      const res = await fetch(videoFile);
      if (!res.ok) throw new Error(`Could not download video from storage (HTTP ${res.status})`);
      const blob = await res.blob();
      file = blob;
      fileName = 'audio.mp4';
    } else {
      file = videoFile;
      fileName = videoFile.name;
    }

    const groqKey = getGroqKey();
    const form = new FormData();
    form.append('file', file, fileName);
    form.append('model', 'whisper-large-v3');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(GROQ_TRANSCRIBE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        throw new Error(`Groq Whisper timed out after ${GROQ_TIMEOUT_MS / 1000}s`);
      }
      throw new Error(`Groq Whisper request failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
    }
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => '(no response body)');
      throw new Error(`Groq Whisper returned HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = await res.json();
    const words: TranscriptWord[] = (data.words ?? []).map(
      (w: { word: string; start: number; end: number }, i: number) => ({
        id: i,
        word: w.word,
        start_ms: Math.round(w.start * 1000),
        end_ms: Math.round(w.end * 1000),
      }),
    );
    const text: string = data.text ?? '';

    if (!text && words.length === 0) {
      throw new Error('Groq Whisper returned an empty transcript — the video may have no audio track.');
    }

    return { text, words };
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(`Transcription failed: ${String(err)}`);
  }
}

// ─── Step 2: Find Viral Clips ─────────────────────────────────────────────────

export async function findViralClips(transcriptText: string, videoDurationSecs?: number): Promise<ViralClipResult[]> {
  const openAIKey = getOpenAIKey();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are an elite viral video producer.' },
          {
            role: 'user',
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
    if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
      throw new Error(`OpenAI GPT-4o-mini timed out after ${OPENAI_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`OpenAI request failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text().catch(() => '(no response body)');
    throw new Error(`OpenAI GPT-4o-mini returned HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content) {
    throw new Error('OpenAI GPT-4o-mini returned an empty response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (parseErr) {
    throw new Error(`OpenAI returned invalid JSON: ${content.slice(0, 300)} (parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)})`);
  }

  const clips = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)?.clips
      ?? (parsed as Record<string, unknown>)?.segments
      ?? Object.values(parsed).find((v): v is unknown[] => Array.isArray(v))
      ?? [];

  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error(`OpenAI GPT-4o-mini returned no clips. Response: ${content.slice(0, 300)}`);
  }

  return clampClipsToDuration(clips as ViralClipResult[], videoDurationSecs);
}

function clampClipsToDuration(clips: ViralClipResult[], durationSecs?: number): ViralClipResult[] {
  if (!durationSecs || durationSecs <= 0) return clips;
  const maxEnd = Math.max(...clips.map(c => c.endTime));
  if (maxEnd <= durationSecs) return clips;

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
}
