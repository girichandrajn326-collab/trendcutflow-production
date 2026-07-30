// TypeScript types mirroring the Supabase schema.
// Used for Supabase query typing via createClient<Database>.

// ─── Enums ────────────────────────────────────────────────────────────────────

export type Plan = 'FREE' | 'CREATOR' | 'PRO';
export type VideoStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type ProcessingJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type PublishQueueStatus = 'pending' | 'publishing' | 'published' | 'failed';

// ─── Row shapes (match DB column names) ──────────────────────────────────────

export interface DbUser {
  [key: string]: unknown;
  id: string;
  email: string;
  name: string;
  current_plan: Plan;
  total_credits: number;
  credits_used: number;
  credits: number;
  created_at: string;
}

export interface DbVideoSource {
  [key: string]: unknown;
  id: string;
  user_id: string;
  title: string;
  source_url: string;
  status: VideoStatus;
  duration: number;
  created_at?: string;
}

export interface DbRepurposedClip {
  [key: string]: unknown;
  id: string;
  video_source_id: string;
  start_time: number;
  end_time: number;
  clip_storage_url: string;
  source_video_url?: string;
  transcript_json: TranscriptJson;
  ai_title: string;
  ai_description: string;
  is_queued: boolean;
  metadata_json?: {
    viralTitles?: string[];
    seoDescription?: string;
    hashtags?: string[];
    algorithmicTags?: string[];
  };
  created_at?: string;
}

export interface DbIntegration {
  [key: string]: unknown;
  id: string;
  user_id: string;
  platform: string;
  encrypted_refresh_token: string;
  created_at?: string;
}

export interface DbProcessingJob {
  [key: string]: unknown;
  id: string;
  user_id: string;
  source_url?: string;
  storage_path?: string;
  status: ProcessingJobStatus;
  step_detail?: string | null;
  has_audio?: boolean | null;
  result?: unknown;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DbPublishQueue {
  [key: string]: unknown;
  id: string;
  user_id: string;
  clip_id: string;
  clip_title?: string;
  platform: string;
  interval_hours?: number;
  scheduled_at?: string;
  status: PublishQueueStatus;
  created_at?: string;
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
        Insert: Partial<DbUser>;
        Update: Partial<DbUser>;
        Relationships: [];
      };
      video_sources: {
        Row: DbVideoSource;
        Insert: Partial<DbVideoSource>;
        Update: Partial<DbVideoSource>;
        Relationships: [];
      };
      repurposed_clips: {
        Row: DbRepurposedClip;
        Insert: Partial<DbRepurposedClip>;
        Update: Partial<DbRepurposedClip>;
        Relationships: [];
      };
      integrations: {
        Row: DbIntegration;
        Insert: Partial<DbIntegration>;
        Update: Partial<DbIntegration>;
        Relationships: [];
      };
      processing_jobs: {
        Row: DbProcessingJob;
        Insert: Partial<DbProcessingJob>;
        Update: Partial<DbProcessingJob>;
        Relationships: [];
      };
      publish_queue: {
        Row: DbPublishQueue;
        Insert: Partial<DbPublishQueue>;
        Update: Partial<DbPublishQueue>;
        Relationships: [];
      };
    };
    Views: Record<string, { Row: Record<string, unknown>; Relationships: [] }>;
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
    Enums: {
      plan: Plan;
      video_status: VideoStatus;
    };
  };
}

// ─── Mappers: DB row → UI model ───────────────────────────────────────────────

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
    totalCredits: row.total_credits,
    credits: row.credits ?? Math.max(row.total_credits - row.credits_used, 0),
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
