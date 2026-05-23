// TypeScript types mirroring the Prisma schema exactly.
// These are used for Supabase query typing until `prisma generate` produces
// the Prisma Client types (which live in node_modules/.prisma/client).

// ─── Enums ────────────────────────────────────────────────────────────────────

export type Plan = 'FREE' | 'CREATOR' | 'PRO';
export type VideoStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

// ─── Row shapes (match DB column names) ──────────────────────────────────────

export interface DbUser {
  id: string;
  email: string;
  name: string;
  current_plan: Plan;
  total_credits: number;
  credits_used: number;
  created_at: string;
}

export interface DbVideoSource {
  id: string;
  user_id: string;
  title: string;
  source_url: string;
  status: VideoStatus;
  duration: number; // seconds
}

export interface DbRepurposedClip {
  id: string;
  video_source_id: string;
  start_time: number;
  end_time: number;
  clip_storage_url: string;
  transcript_json: TranscriptJson;
  ai_title: string;
  ai_description: string;
  is_queued: boolean;
}

export interface DbIntegration {
  id: string;
  user_id: string;
  platform: string;
  encrypted_refresh_token: string;
}

// ─── transcript_json shape stored in RepurposedClip ──────────────────────────

export interface TranscriptWord {
  id: number;
  word: string;
  start_ms: number;
  end_ms: number;
}

export interface TranscriptJson {
  words: TranscriptWord[];
}

// ─── Supabase Database generic type (for createClient<Database>) ─────────────

export interface Database {
  public: {
    Tables: {
      users: {
        Row: DbUser;
        Insert: Omit<DbUser, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<DbUser, 'id'>>;
      };
      video_sources: {
        Row: DbVideoSource;
        Insert: Omit<DbVideoSource, 'id'> & { id?: string };
        Update: Partial<Omit<DbVideoSource, 'id'>>;
      };
      repurposed_clips: {
        Row: DbRepurposedClip;
        Insert: Omit<DbRepurposedClip, 'id'> & { id?: string };
        Update: Partial<Omit<DbRepurposedClip, 'id'>>;
      };
      integrations: {
        Row: DbIntegration;
        Insert: Omit<DbIntegration, 'id'> & { id?: string };
        Update: Partial<Omit<DbIntegration, 'id'>>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      plan: Plan;
      video_status: VideoStatus;
    };
  };
}

// ─── Mappers: DB row → UI model ───────────────────────────────────────────────
// These translate snake_case DB columns to the camelCase UI types in appStore.ts
// so the swap from mock → real data only requires changing the data source.

import type { Clip, UserAccount, TranscriptWord as UITranscriptWord } from '../store/appStore';

export function dbUserToAccount(row: DbUser): UserAccount {
  const planMap: Record<Plan, UserAccount['plan']> = {
    FREE: 'free',
    CREATOR: 'creator',
    PRO: 'pro',
  };
  const initials = row.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    plan: planMap[row.current_plan],
    videosProcessed: row.credits_used,
    avatarInitials: initials,
  };
}

export function dbClipToUiClip(
  row: DbRepurposedClip,
  metadata: Clip['metadata'],
): Clip {
  const words: UITranscriptWord[] = (row.transcript_json.words ?? []).map((w) => ({
    id: w.id,
    word: w.word,
    startMs: w.start_ms,
    endMs: w.end_ms,
  }));

  const durationSec = Math.round(row.end_time - row.start_time);
  const mins = Math.floor(durationSec / 60);
  const secs = String(durationSec % 60).padStart(2, '0');

  return {
    id: row.id,
    title: row.ai_title,
    duration: `${mins}:${secs}`,
    thumbnail: row.clip_storage_url,
    startTime: row.start_time,
    endTime: row.end_time,
    transcript: words,
    metadata,
  };
}
