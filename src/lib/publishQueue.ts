// Delayed Publishing Queue — schedules clip delivery at a user-selected
// fixed interval to prevent platform spam detection.

import type { QueueInterval } from '../store/appStore';

export interface QueuedClip {
  id: string;
  clipId: string;
  userId: string;
  title: string;
  scheduledAt: Date;
  status: 'pending' | 'processing' | 'published' | 'failed';
  platform: 'youtube_shorts' | 'instagram_reels' | 'snapchat_spotlight';
  retryCount: number;
}

/**
 * Calculate staggered publish dates for a batch of clips.
 * First clip is scheduled immediately (or from startDate).
 * Each subsequent clip is offset by exactly `intervalHours`.
 */
export function calculateSchedule(
  clipCount: number,
  startDate: Date = new Date(),
  intervalHours: QueueInterval = 24,
): Date[] {
  const schedule: Date[] = [];
  for (let i = 0; i < clipCount; i++) {
    schedule.push(new Date(startDate.getTime() + i * intervalHours * 60 * 60 * 1000));
  }
  return schedule;
}

/**
 * Human-readable relative time label for a scheduled date.
 * e.g. "Tomorrow at 5:00 PM", "In 2 days at 3:30 PM", "Publishing soon"
 */
export function formatScheduledTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays  = Math.floor(diffHours / 24);

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (diffMs < 0)        return 'Overdue';
  if (diffHours < 1)     return 'Publishing soon';
  if (diffHours < 24)    return `Today at ${timeStr}`;
  if (diffDays === 1)    return `Tomorrow at ${timeStr}`;
  return `In ${diffDays} days at ${timeStr}`;
}

/** Short label for the queue strip badge (e.g. "Tomorrow 5:00 PM") */
export function formatScheduledShort(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays  = Math.floor(diffHours / 24);
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (diffMs < 0)     return 'Overdue';
  if (diffHours < 1)  return 'Soon';
  if (diffHours < 24) return timeStr;
  if (diffDays === 1) return `Tmr ${timeStr}`;
  return `+${diffDays}d ${timeStr}`;
}

import { supabase } from './supabase';

// Add clip to publish queue in Supabase
export async function addClipToQueue(
  clipId: string,
  userId: string,
  scheduledAt: Date,
  platform: QueuedClip['platform'],
): Promise<void> {
  const { error } = await supabase.from('publish_queue').upsert({
    user_id: userId,
    clip_id: clipId,
    platform,
    scheduled_at: scheduledAt.toISOString(),
    status: 'pending',
  }, { onConflict: 'user_id,clip_id' });

  if (error) throw new Error(`addClipToQueue failed: ${error.message}`);
}

// Execute a YouTube Shorts upload for a queued clip
export async function executePublish(queueItem: QueuedClip): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  // Load clip data
  const { data: clip, error: clipErr } = await supabase
    .from('repurposed_clips')
    .select('clip_storage_url, ai_title, ai_description, metadata_json')
    .eq('id', queueItem.clipId)
    .maybeSingle();

  if (clipErr || !clip) throw new Error('Clip not found');

  if (queueItem.platform === 'youtube_shorts') {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    // Fetch the video blob from storage URL
    const videoRes = await fetch(clip.clip_storage_url);
    if (!videoRes.ok) throw new Error('Could not fetch clip video');
    const videoBlob = await videoRes.blob();
    const videoFile = new File([videoBlob], 'clip.mp4', { type: 'video/mp4' });

    const meta = (clip.metadata_json as { hashtags?: string[] }) ?? {};
    const tags = (meta.hashtags ?? []).join(',');

    const form = new FormData();
    form.append('video', videoFile);
    form.append('title', clip.ai_title);
    form.append('description', clip.ai_description);
    form.append('tags', tags);

    const res = await fetch(`${supabaseUrl}/functions/v1/youtube-oauth?action=upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Apikey': anonKey,
      },
      body: form,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? 'YouTube upload failed');
    }
  } else {
    // Instagram Reels / Snapchat — log pending platform support
    console.warn(`[PublishQueue] Platform ${queueItem.platform} not yet supported for direct publishing.`);
  }

  // Mark as published in DB
  await supabase
    .from('publish_queue')
    .update({ status: 'published' })
    .eq('clip_id', queueItem.clipId)
    .eq('user_id', queueItem.userId);

  await supabase
    .from('repurposed_clips')
    .update({ is_queued: false })
    .eq('id', queueItem.clipId);
}
