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

// Stub: Add clip to publish queue (stores in Supabase)
export async function addClipToQueue(
  _clipId: string,
  _userId: string,
  _scheduledAt: Date,
  _platform: QueuedClip['platform'],
): Promise<void> {
  console.log('[PublishQueue] addClipToQueue stub called');
}

// Stub: Execute publish for a queued clip (called by Edge Function cron)
export async function executePublish(_queueItem: QueuedClip): Promise<void> {
  console.log('[PublishQueue] executePublish stub called');
}
