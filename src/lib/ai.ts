// AI processing service — calls the process-video Edge Function which proxies
// Groq Whisper + OpenAI GPT-4o-mini server-side (keys never reach the browser).
// Throws real errors — no mock/sample fallback data.

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

export interface AudioCheckResult {
  hasAudio: boolean;
  duration?: number;
  method: 'ffprobe' | 'binary-scan' | 'assumed';
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

// ─── Step 0: Pre-flight audio check ──────────────────────────────────────────

export async function checkVideoAudio(videoFile: File): Promise<AudioCheckResult> {
  const authHeader = await getAuthHeader();
  if (!authHeader) return { hasAudio: true, method: 'assumed' };

  try {
    const chunk    = videoFile.slice(0, 524288);
    const formData = new FormData();
    formData.append('file', chunk, videoFile.name);

    const res = await fetch(edgeFnUrl('check-audio'), {
      method: 'POST',
      headers: { Authorization: authHeader },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `Audio check failed (${res.status})`);
    }

    return await res.json() as AudioCheckResult;
  } catch (err) {
    throw new Error(`Audio check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Step 1: Transcribe ───────────────────────────────────────────────────────

export async function transcribeVideo(videoFile: File | string): Promise<TranscriptResult> {
  const authHeader = await getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated — please sign in.');

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
      throw new Error(err.error ?? `Transcription failed (${res.status}). Please try again.`);
    }

    return await res.json();
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(`Transcription failed: ${String(err)}`);
  }
}

// ─── Step 2: Find Viral Clips ─────────────────────────────────────────────────

export async function findViralClips(transcriptText: string, videoDurationSecs?: number): Promise<ViralClipResult[]> {
  const authHeader = await getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated — please sign in.');

  let res: Response;
  try {
    res = await fetch(edgeFnUrl('detect-clips'), {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcriptText }),
    });
  } catch (fetchErr) {
    throw new Error(`Clip detection request failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 402) throw new Error(err.error ?? 'Credit limit reached. Please upgrade your plan.');
    if (res.status === 404) throw new Error('User profile not found. Please sign out and sign in again.');
    throw new Error(err.error ?? `Clip detection failed (${res.status}). Please try again.`);
  }

  const data = await res.json();
  const clips = Array.isArray(data)
    ? data.slice(0, 5)
    : Array.isArray(data.clips) ? data.clips.slice(0, 5)
    : Array.isArray(data.segments) ? data.segments.slice(0, 5)
    : (Array.isArray(Object.values(data)[0]) ? (Object.values(data)[0] as ViralClipResult[]).slice(0, 5) : null);

  if (!clips) {
    throw new Error(`Clip detection returned unexpected response shape: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return clampClipsToDuration(clips, videoDurationSecs);
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
