import { useState, useCallback, useEffect, useRef } from 'react';
import type { VideoStatus } from '../types/database';
import type { AuthUser } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { transcribeVideo, findViralClips } from '../lib/ai';

export type AppScreen = 'intake' | 'processing' | 'editor' | 'history';
export type SubtitlePreset = 'hormozi' | 'minimalist' | 'cyberpunk';
export type PlanTier = 'free' | 'creator' | 'pro';
export type QueuePlatform = 'youtube_shorts' | 'instagram_reels' | 'snapchat_spotlight';
export type QueueInterval = 12 | 24 | 48;

export interface QueueEntry {
  clipId: string;
  platform: QueuePlatform;
  intervalHours: QueueInterval;
  scheduledAt: Date;
}

export { VideoStatus };

// ─── Pipeline step tracking ────────────────────────────────────────────────────

export type PipelineStepId =
  | 'download'
  | 'audio-check'
  | 'transcribe'
  | 'detect'
  | 'slice'
  | 'subtitles'
  | 'metadata';

export type PipelineStepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped';

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  status: PipelineStepStatus;
  detail?: string;
}

// ─── User / Plan types ────────────────────────────────────────────────────────

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  plan: PlanTier;
  videosProcessed: number;
  totalCredits: number;
  credits: number;
  avatarInitials: string;
}

export interface PlanOption {
  id: PlanTier;
  name: string;
  price: string;
  priceRaw: number;
  videoLimit: number;
  features: string[];
}

// ─── Toast ────────────────────────────────────────────────────────────────────

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

// ─── Clip types ───────────────────────────────────────────────────────────────

export interface TranscriptWord {
  id: number;
  word: string;
  startMs: number;
  endMs: number;
}

export interface ClipMetadata {
  viralTitles: string[];
  seoDescription: string;
  hashtags: string[];
  algorithmicTags: string[];
}

export interface MockVideoSource {
  id: string;
  userId: string;
  title: string;
  sourceUrl: string;
  status: VideoStatus;
  duration: number;
}

export interface Clip {
  id: string;
  videoSourceId?: string;
  title: string;
  duration: string;
  thumbnail: string;
  startTime: number;
  endTime: number;
  transcript: TranscriptWord[];
  metadata: ClipMetadata;
  sourceVideoUrl?: string;
  scheduledAt?: Date;
  noAudio?: boolean;
}

// ─── App state ────────────────────────────────────────────────────────────────

export interface AppState {
  screen: AppScreen;
  user: UserAccount;
  activeClipIndex: number;
  clips: Clip[];
  subtitlePreset: SubtitlePreset;
  activeWordIndex: number;
  isUpgradeModalOpen: boolean;
  isAccountDropdownOpen: boolean;
  publishQueue: QueueEntry[];
  inputUrl: string;
  isDragging: boolean;
  uploadedFile: File | null;
  randomStyleSeed: number;
  enableIntroTransition: boolean;
  enableSubjectTracking: boolean;
  pipeline: PipelineStep[];
  pipelineError: string | null;
  toasts: Toast[];
}

// ─── Static data ──────────────────────────────────────────────────────────────

export const PLANS: PlanOption[] = [
  {
    id: 'free',
    name: 'Free',
    price: '₹0',
    priceRaw: 0,
    videoLimit: 1,
    features: ['1 video/month', '5 viral shorts per video', 'Watermarked export', 'Basic subtitle styles', 'Browser-side processing'],
  },
  {
    id: 'creator',
    name: 'Creator Flow',
    price: '₹499/mo',
    priceRaw: 499,
    videoLimit: 3,
    features: ['3 videos/month', '5 viral shorts per video', 'No watermark', 'All subtitle styles', 'Delayed publish queue', 'AI metadata generation'],
  },
  {
    id: 'pro',
    name: 'Pro Flow',
    price: '₹999/mo',
    priceRaw: 999,
    videoLimit: 5,
    features: ['5 videos/month', '5 viral shorts per video', 'Priority processing', 'Custom subtitle styles', 'Advanced scheduling', 'Analytics dashboard', 'API access'],
  },
];

export const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 1,
  creator: 3,
  pro: 5,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRandomStyleSeed(): number {
  return 0.97 + Math.random() * 0.03;
}

function formatDuration(start: number, end: number): string {
  const secs = Math.round(end - start);
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Job-status → pipeline mapping ───────────────────────────────────────────

const PIPELINE_STEP_ORDER: PipelineStepId[] = [
  'download', 'audio-check', 'transcribe', 'detect', 'slice', 'subtitles', 'metadata',
];

const JOB_STATUS_TO_ACTIVE_STEP: Record<string, PipelineStepId> = {
  queued: 'download',
  processing: 'download',
  downloading: 'download',
  generating_url: 'audio-check',
  audio_check: 'audio-check',
  extracting_audio: 'transcribe',
  transcribing: 'transcribe',
  detecting: 'detect',
  slicing: 'slice',
  completed: 'metadata',
};

function mapJobStatusToPipeline(
  current: PipelineStep[],
  status: string,
  stepDetail: string | null,
  hasAudio: boolean | null,
): PipelineStep[] {
  const activeId = JOB_STATUS_TO_ACTIVE_STEP[status] ?? 'download';
  const activeIdx = PIPELINE_STEP_ORDER.indexOf(activeId);
  const allDone = status === 'completed';

  return current.map((step, i) => {
    const isPast = allDone ? true : i < activeIdx;

    if (isPast) {
      if (hasAudio === false && (step.id === 'transcribe' || step.id === 'subtitles')) {
        return { ...step, status: 'skipped', detail: 'Skipped — no audio stream' };
      }
      return { ...step, status: 'done' };
    }

    if (i === activeIdx && !allDone) {
      return { ...step, status: 'active', detail: stepDetail ?? undefined };
    }

    return { ...step, status: 'pending' };
  });
}

interface JobResult {
  hasAudio: boolean;
  videoDurationSecs?: number;
  sourceTitle?: string;
  sourceVideoUrl?: string;
  clips: Array<{
    startTime: number;
    endTime: number;
    viralTitles: string[];
    seoDescription: string;
    hashtags: string[];
    algorithmicTags: string[];
    transcriptWords: Array<{ id: number; word: string; start_ms: number; end_ms: number }>;
  }>;
}

function buildClipsFromResult(result: JobResult): Clip[] {
  return result.clips.map((r, i) => ({
    id: crypto.randomUUID(),
    title: r.viralTitles[0],
    duration: formatDuration(r.startTime, r.endTime),
    thumbnail: THUMBNAIL_POOL[i % THUMBNAIL_POOL.length],
    startTime: r.startTime,
    endTime: r.endTime,
    transcript: r.transcriptWords.map(w => ({
      id: w.id,
      word: w.word,
      startMs: w.start_ms,
      endMs: w.end_ms,
    })),
    metadata: {
      viralTitles: r.viralTitles,
      seoDescription: r.seoDescription,
      hashtags: r.hashtags,
      algorithmicTags: r.algorithmicTags,
    },
    sourceVideoUrl: result.sourceVideoUrl,
    noAudio: !result.hasAudio,
  }));
}

async function fetchClipsFromDb(userId: string): Promise<Clip[]> {
  const { data: sources } = await supabase
    .from('video_sources')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sources) return [];

  const { data: rows } = await supabase
    .from('repurposed_clips')
    .select('*')
    .eq('video_source_id', sources.id)
    .order('created_at', { ascending: true });

  if (!rows || rows.length === 0) return [];

  return rows.map((r, i) => {
    const meta = (r.metadata_json ?? {}) as Clip['metadata'];
    return {
      id: crypto.randomUUID(),
      title: r.ai_title ?? `Clip ${i + 1}`,
      duration: formatDuration(r.start_time, r.end_time),
      thumbnail: r.clip_storage_url || THUMBNAIL_POOL[i % THUMBNAIL_POOL.length],
      startTime: r.start_time,
      endTime: r.end_time,
      transcript: ((r.transcript_json?.words) ?? []).map((w: { id: number; word: string; start_ms: number; end_ms: number }) => ({
        id: w.id,
        word: w.word,
        startMs: w.start_ms,
        endMs: w.end_ms,
      })),
      metadata: {
        viralTitles: meta.viralTitles ?? [r.ai_title ?? `Clip ${i + 1}`],
        seoDescription: meta.seoDescription ?? r.ai_description ?? '',
        hashtags: meta.hashtags ?? [],
        algorithmicTags: meta.algorithmicTags ?? [],
      },
      noAudio: ((r.transcript_json?.words) ?? []).length === 0,
    } satisfies Clip;
  });
}

function setStepStatus(
  steps: PipelineStep[],
  id: PipelineStepId,
  status: PipelineStepStatus,
  detail?: string,
): PipelineStep[] {
  return steps.map(s =>
    s.id === id ? { ...s, status, ...(detail !== undefined ? { detail } : {}) } : s,
  );
}

function buildUserFromAuth(authUser: AuthUser): UserAccount {
  const initials = authUser.name
    .split(' ')
    .map(n => n[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || (authUser.email?.[0]?.toUpperCase() ?? '?');
  return {
    id: authUser.id,
    email: authUser.email,
    name: authUser.name,
    plan: 'free',
    videosProcessed: 0,
    totalCredits: 1,
    credits: 1,
    avatarInitials: initials,
  };
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const THUMBNAIL_POOL = [
  'https://images.pexels.com/photos/3184291/pexels-photo-3184291.jpeg?auto=compress&cs=tinysrgb&w=800',
  'https://images.pexels.com/photos/3184338/pexels-photo-3184338.jpeg?auto=compress&cs=tinysrgb&w=800',
  'https://images.pexels.com/photos/3184360/pexels-photo-3184360.jpeg?auto=compress&cs=tinysrgb&w=800',
  'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg?auto=compress&cs=tinysrgb&w=800',
  'https://images.pexels.com/photos/3184639/pexels-photo-3184639.jpeg?auto=compress&cs=tinysrgb&w=800',
];

const MOCK_USER: UserAccount = {
  id: 'guest',
  email: 'guest@trendcutflow.com',
  name: 'Guest User',
  plan: 'free',
  videosProcessed: 0,
  totalCredits: 1,
  credits: 1,
  avatarInitials: 'GU',
};



const INITIAL_PIPELINE: PipelineStep[] = [
  { id: 'download', label: 'Downloading video (server-side)', status: 'pending' },
  { id: 'audio-check', label: 'Analysing audio stream', status: 'pending' },
  { id: 'transcribe', label: 'Transcribing audio (Whisper)', status: 'pending' },
  { id: 'detect', label: 'Detecting viral hooks (GPT-4o)', status: 'pending' },
  { id: 'slice', label: 'Slicing video clips (FFmpeg)', status: 'pending' },
  { id: 'subtitles', label: 'Burning captions', status: 'pending' },
  { id: 'metadata', label: 'Generating metadata', status: 'pending' },
];

// ─── useAppState hook ─────────────────────────────────────────────────────────

export function useAppState() {
  const [state, setState] = useState<AppState>({
    screen: 'intake',
    user: MOCK_USER,
    activeClipIndex: 0,
    clips: [],
    subtitlePreset: 'hormozi',
    activeWordIndex: 0,
    isUpgradeModalOpen: false,
    isAccountDropdownOpen: false,
    publishQueue: [] as QueueEntry[],
    inputUrl: '',
    isDragging: false,
    uploadedFile: null,
    randomStyleSeed: generateRandomStyleSeed(),
    enableIntroTransition: true,
    enableSubjectTracking: true,
    pipeline: INITIAL_PIPELINE.map(s => ({ ...s })),
    pipelineError: null,
    toasts: [],
  });

  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auth sync ──────────────────────────────────────────────────────────────

  const setAuthUser = useCallback((authUser: AuthUser | null) => {
    setState(s => ({
      ...s,
      user: authUser ? buildUserFromAuth(authUser) : MOCK_USER,
      ...(authUser ? {} : {
        screen: 'intake' as AppScreen,
        clips: [],
        publishQueue: [],
        activeClipIndex: 0,
        activeWordIndex: 0,
        inputUrl: '',
        uploadedFile: null,
        isDragging: false,
        pipeline: INITIAL_PIPELINE.map(p => ({ ...p })),
        pipelineError: null,
        toasts: [],
        isUpgradeModalOpen: false,
        isAccountDropdownOpen: false,
      }),
    }));

    if (authUser) {
      supabase
        .from('users')
        .select('current_plan, total_credits, credits_used, credits')
        .eq('id', authUser.id)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const planMap: Record<string, PlanTier> = { free: 'free', creator: 'creator', pro: 'pro' };
          const planKey = (data.current_plan ?? '').toLowerCase();
          setState(s => ({
            ...s,
            user: {
              ...s.user,
              plan: planMap[planKey] ?? 'free',
              totalCredits: data.total_credits ?? 1,
              videosProcessed: data.credits_used ?? 0,
              credits: data.credits ?? Math.max((data.total_credits ?? 1) - (data.credits_used ?? 0), 0),
            },
          }));
        });

      realtimeChannelRef.current?.unsubscribe();
      realtimeChannelRef.current = supabase
        .channel(`user-credits-${authUser.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${authUser.id}` },
          (payload) => {
            const d = payload.new as {
              current_plan: string;
              total_credits: number;
              credits_used: number;
              credits: number;
            };
            const planMap: Record<string, PlanTier> = { free: 'free', creator: 'creator', pro: 'pro' };
            const planKey = (d.current_plan ?? '').toLowerCase();
            setState(s => ({
              ...s,
              user: {
                ...s.user,
                plan: planMap[planKey] ?? s.user.plan,
                totalCredits: d.total_credits ?? s.user.totalCredits,
                videosProcessed: d.credits_used ?? s.user.videosProcessed,
                credits: d.credits ?? s.user.credits,
              },
            }));
          },
        )
        .subscribe();

      supabase
        .from('publish_queue')
        .select('clip_id, clip_title, platform, interval_hours, scheduled_at')
        .eq('user_id', authUser.id)
        .eq('status', 'pending')
        .then(({ data }) => {
          if (!data || data.length === 0) return;
          const entries: QueueEntry[] = data.map(row => ({
            clipId: row.clip_id ?? '',
            platform: row.platform as QueuePlatform,
            intervalHours: row.interval_hours as QueueInterval,
            scheduledAt: new Date(row.scheduled_at ?? Date.now()),
          })).filter(e => e.clipId);
          if (entries.length > 0) setState(s => ({ ...s, publishQueue: entries }));
        });
    } else {
      realtimeChannelRef.current?.unsubscribe();
      realtimeChannelRef.current = null;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      realtimeChannelRef.current?.unsubscribe();
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, []);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const setScreen = useCallback((screen: AppScreen) => {
    setState(s => ({ ...s, screen }));
  }, []);

  // ── Clip management ────────────────────────────────────────────────────────

  const setActiveClipIndex = useCallback((i: number) => {
    setState(s => ({ ...s, activeClipIndex: i, activeWordIndex: 0 }));
  }, []);

  const setSubtitlePreset = useCallback((preset: SubtitlePreset) => {
    setState(s => ({ ...s, subtitlePreset: preset }));
  }, []);

  const setEnableIntroTransition = useCallback((enabled: boolean) => {
    setState(s => ({ ...s, enableIntroTransition: enabled }));
  }, []);

  const setEnableSubjectTracking = useCallback((enabled: boolean) => {
    setState(s => ({ ...s, enableSubjectTracking: enabled }));
  }, []);

  const setActiveWordIndex = useCallback((i: number) => {
    setState(s => ({ ...s, activeWordIndex: i }));
  }, []);

  const updateMetadataTitle = useCallback((clipId: string, titleIndex: number, value: string) => {
    setState(s => ({
      ...s,
      clips: s.clips.map(c =>
        c.id === clipId
          ? { ...c, metadata: { ...c.metadata, viralTitles: (c.metadata?.viralTitles ?? []).map((t, i) => i === titleIndex ? value : t) } }
          : c,
      ),
    }));
  }, []);

  // ── Upload / URL ───────────────────────────────────────────────────────────

  const setInputUrl = useCallback((url: string) => {
    setState(s => ({ ...s, inputUrl: url }));
  }, []);

  const setIsDragging = useCallback((isDragging: boolean) => {
    setState(s => ({ ...s, isDragging }));
  }, []);

  const setUploadedFile = useCallback((file: File | null) => {
    setState(s => ({ ...s, uploadedFile: file, inputUrl: '' }));
  }, []);

  // ── Upgrade modal ──────────────────────────────────────────────────────────

  const openUpgradeModal = useCallback(() => setState(s => ({ ...s, isUpgradeModalOpen: true })), []);
  const closeUpgradeModal = useCallback(() => setState(s => ({ ...s, isUpgradeModalOpen: false })), []);

  const selectPlan = useCallback((plan: PlanTier) => {
    setState(s => ({ ...s, user: { ...s.user, plan, totalCredits: PLAN_LIMITS[plan] } }));
  }, []);

  const purchasePlan = useCallback((plan: PlanTier) => {
    setState(s => ({
      ...s,
      user: { ...s.user, plan, totalCredits: PLAN_LIMITS[plan] },
      isUpgradeModalOpen: false,
    }));
    setState(s => {
      if (s.user.id) {
        const planDbMap: Record<PlanTier, string> = { free: 'FREE', creator: 'CREATOR', pro: 'PRO' };
        supabase.from('users').update({
          current_plan: planDbMap[plan] as 'FREE' | 'CREATOR' | 'PRO',
          total_credits: PLAN_LIMITS[plan],
          credits_used: 0,
          credits: PLAN_LIMITS[plan],
        }).eq('id', s.user.id).then(({ error }) => {
          if (error) console.error('purchasePlan DB write failed:', error.message);
        });
      }
      return s;
    });
  }, []);

  // ── Account dropdown ───────────────────────────────────────────────────────

  const toggleAccountDropdown = useCallback(() => {
    setState(s => ({ ...s, isAccountDropdownOpen: !s.isAccountDropdownOpen }));
  }, []);

  const closeAccountDropdown = useCallback(() => {
    setState(s => ({ ...s, isAccountDropdownOpen: false }));
  }, []);

  // ── Publish queue ──────────────────────────────────────────────────────────

  const addToPublishQueue = useCallback((entry: QueueEntry) => {
    setState(s => {
      const next = [...s.publishQueue.filter(e => e.clipId !== entry.clipId), entry];
      if (s.user.id) {
        const clip = s.clips.find(c => c.id === entry.clipId);
        supabase.from('publish_queue').upsert({
          user_id: s.user.id,
          clip_id: entry.clipId,
          clip_title: clip?.title ?? '',
          platform: entry.platform,
          interval_hours: entry.intervalHours,
          scheduled_at: entry.scheduledAt.toISOString(),
          status: 'pending',
        }, { onConflict: 'user_id,clip_id' }).then(({ error }) => {
          if (error) console.error('addToPublishQueue DB write failed:', error.message);
        });
      }
      return { ...s, publishQueue: next };
    });
  }, []);

  const removeFromPublishQueue = useCallback((clipId: string) => {
    setState(s => {
      if (s.user.id) {
        supabase.from('publish_queue')
          .delete().eq('user_id', s.user.id).eq('clip_id', clipId)
          .then(({ error }) => {
            if (error) console.error('removeFromPublishQueue DB delete failed:', error.message);
          });
      }
      return { ...s, publishQueue: s.publishQueue.filter(e => e.clipId !== clipId) };
    });
  }, []);

  // ── Toasts ─────────────────────────────────────────────────────────────────

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setState(s => ({ ...s, toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => setState(s => ({ ...s, toasts: s.toasts.filter(t => t.id !== id) })), 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setState(s => ({ ...s, toasts: s.toasts.filter(t => t.id !== id) }));
  }, []);

  // ── Pipeline ───────────────────────────────────────────────────────────────

  const updateJobStatus = useCallback(async (
    jobId: string,
    status: string,
    stepDetail?: string,
    extra: Record<string, unknown> = {},
  ) => {
    await supabase.from('processing_jobs').update({
      status,
      step_detail: stepDetail ?? null,
      updated_at: new Date().toISOString(),
      ...extra,
    }).eq('id', jobId);
  }, []);

  const insertLog = useCallback(async (
    userId: string,
    step: string,
    status: 'pending' | 'success' | 'error',
    message?: string,
  ) => {
    await supabase.from('processing_logs').insert({
      user_id: userId,
      step,
      status,
      message: message ?? null,
    });
  }, []);

  const runPipeline = useCallback(async () => {
    const source = state.uploadedFile ?? state.inputUrl;
    if (!source) return;
    if (state.user.credits <= 0) {
      setState(s => ({ ...s, isUpgradeModalOpen: true }));
      return;
    }

    setState(s => ({
      ...s,
      screen: 'processing',
      clips: [],
      pipeline: INITIAL_PIPELINE.map(step => ({ ...step })),
      pipelineError: null,
    }));

    setState(s => ({
      ...s,
      pipeline: setStepStatus(s.pipeline, 'download', 'active', 'Uploading your video…'),
    }));

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      setState(s => ({
        ...s,
        pipelineError: 'Not authenticated. Please sign in again.',
        pipeline: setStepStatus(s.pipeline, 'download', 'error'),
      }));
      return;
    }

    // ── Credit pre-check ──────────────────────────────────────────────────────
    const { data: canProcess } = await supabase.rpc('can_process_video', { uid: userId });
    if (!canProcess) {
      setState(s => ({
        ...s,
        screen: 'intake',
        pipeline: INITIAL_PIPELINE.map(p => ({ ...p })),
        pipelineError: null,
        isUpgradeModalOpen: true,
      }));
      return;
    }

    let jobId: string;
    let storagePath: string;
    let sourceUrl: string | null = null;
    let sourceType: 'file' | 'url' = 'file';
    let fileName: string;

    try {
      if (source instanceof File) {
        if (source.size > 500 * 1024 * 1024) {
          throw new Error('File too large (max 500 MB). Please compress the video or paste a YouTube URL instead.');
        }

        const ext = source.name.split('.').pop()?.toLowerCase() ?? 'mp4';
        const uploadPath = `${userId}/${crypto.randomUUID()}.${ext}`;
        fileName = source.name || 'video.mp4';
        sourceType = 'file';

        setState(s => ({
          ...s,
          pipeline: setStepStatus(s.pipeline, 'download', 'active',
            `Uploading ${(source.size / 1024 / 1024).toFixed(1)} MB…`),
        }));

        const { data: uploadData, error: storageErr } = await supabase.storage
          .from('videos')
          .upload(uploadPath, source, { contentType: source.type || 'video/mp4' });

        if (storageErr) throw new Error(`Upload failed: ${storageErr.message}`);
        // Use the exact path returned by Supabase Storage — never reconstruct it
        storagePath = uploadData?.path ?? uploadPath;
        if (!storagePath) throw new Error('Upload succeeded but no storage path was returned. Please try again.');
      } else {
        sourceUrl = source;
        sourceType = 'url';

        const isYouTube = /youtube\.com|youtu\.be/i.test(source);
        const isInstagram = /instagram\.com/i.test(source);

        if (!isYouTube && !isInstagram) {
          throw new Error('Only YouTube and Instagram URLs are supported. Please paste a valid video URL.');
        }

        setState(s => ({
          ...s,
          pipeline: setStepStatus(s.pipeline, 'download', 'active', 'Downloading video from URL…'),
        }));

        // Use the official supabase-js client to invoke the download-video edge
        // function. The client routes through the Supabase API gateway which
        // handles CORS correctly — no direct browser fetch to the video URL.
        const { data: fnData, error: fnErr } = await supabase.functions.invoke('download-video', {
          body: { url: source },
        });

        if (fnErr) {
          throw new Error(fnErr.message || 'Could not download the video. Please check the URL and try again.');
        }

        // The edge function returns the video as a binary stream; supabase-js
        // exposes it as a Blob/ArrayBuffer in `data`.
        let videoBlob: Blob;
        if (fnData instanceof Blob) {
          videoBlob = fnData;
        } else if (fnData instanceof ArrayBuffer) {
          videoBlob = new Blob([fnData], { type: 'video/mp4' });
        } else if (fnData && typeof fnData === 'object' && 'error' in fnData) {
          throw new Error((fnData as { error: string }).error);
        } else {
          throw new Error('Download returned an unexpected format. Please try again.');
        }

        if (videoBlob.size === 0) throw new Error('Downloaded video is empty.');

        if (videoBlob.size > 500 * 1024 * 1024) {
          throw new Error('Video too large (max 500 MB). Please try a shorter video.');
        }

        fileName = 'video.mp4';
        const uploadPath = `${userId}/${crypto.randomUUID()}.mp4`;

        setState(s => ({
          ...s,
          pipeline: setStepStatus(s.pipeline, 'download', 'active',
            `Uploading ${(videoBlob.size / 1024 / 1024).toFixed(1)} MB…`),
        }));

        const { data: uploadData, error: storageErr } = await supabase.storage
          .from('videos')
          .upload(uploadPath, videoBlob, { contentType: 'video/mp4' });

        if (storageErr) throw new Error(`Upload failed: ${storageErr.message}`);
        storagePath = uploadData?.path ?? uploadPath;
        if (!storagePath) throw new Error('Upload succeeded but no storage path was returned. Please try again.');
      }

      // ── Insert processing_jobs row directly via supabase-js ──────────────────
      jobId = crypto.randomUUID();
      const { error: insertErr } = await supabase.from('processing_jobs').insert({
        id: jobId,
        user_id: userId,
        storage_path: storagePath,
        source_type: sourceType,
        source_url: sourceUrl,
        original_name: fileName,
        status: 'queued',
        progress: 0,
      });

      if (insertErr) throw new Error(`Failed to create job: ${insertErr.message}`);

      setState(s => ({
        ...s,
        pipeline: setStepStatus(s.pipeline, 'download', 'done', 'Video uploaded — starting AI analysis…'),
      }));

    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to start processing job';
      const msg = rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError')
        ? 'Could not connect to the server. Please check your internet connection and try again.'
        : rawMsg;
      console.error('[pipeline] Setup failed:', err);
      setState(s => ({
        ...s,
        pipelineError: msg,
        pipeline: setStepStatus(s.pipeline, 'download', 'error', msg),
      }));
      return;
    }

    // ── Run the pipeline client-side ──────────────────────────────────────────
    (async () => {
      try {
        // Step 1: Generate signed URL to download the video from storage
        await updateJobStatus(jobId, 'generating_url', 'Preparing video for processing…');
        await insertLog(userId, 'generate_signed_url', 'pending', 'Generating signed URL for storage path');

        if (!storagePath || storagePath.trim() === '') {
          throw new Error('No storage path was saved for this upload. Please go back and try uploading the file again.');
        }

        const { data: signedData, error: signedErr } = await supabase.storage
          .from('videos')
          .createSignedUrl(storagePath, 600);

        if (signedErr || !signedData?.signedUrl) {
          const detail = signedErr?.message ?? 'No URL returned';
          throw new Error(
            detail.includes('not found') || detail.includes('404')
              ? `The uploaded video could not be found in storage (path: ${storagePath}). Please go back and re-upload your file.`
              : `Failed to generate signed URL: ${detail}`
          );
        }

        const videoUrl = signedData.signedUrl;
        await insertLog(userId, 'generate_signed_url', 'success', 'Signed URL generated');

        // Step 2: Download video bytes
        await updateJobStatus(jobId, 'downloading', 'Downloading video file…');
        await insertLog(userId, 'download_video', 'pending', 'Downloading video from storage');

        const dlRes = await fetch(videoUrl);
        if (!dlRes.ok) throw new Error(`Download failed: HTTP ${dlRes.status}`);
        const videoArrayBuffer = await dlRes.arrayBuffer();
        const videoBytes = new Uint8Array(videoArrayBuffer);

        await insertLog(userId, 'download_video', 'success',
          `Downloaded ${Math.round(videoBytes.length / 1024 / 1024)} MB`);

        // Step 3: Transcribe with Groq Whisper
        setState(s => ({
          ...s,
          pipeline: setStepStatus(s.pipeline, 'transcribe', 'active', 'Transcribing audio with Groq Whisper…'),
        }));
        await updateJobStatus(jobId, 'transcribing', 'Transcribing audio with Groq Whisper…');
        await insertLog(userId, 'transcribe', 'pending', `Sending ${Math.round(videoBytes.length / 1024 / 1024)} MB to Groq Whisper`);

        const videoBlob = new Blob([videoBytes], { type: 'video/mp4' });
        const videoFile = new File([videoBlob], fileName, { type: 'video/mp4' });
        const { text: transcriptText, words } = await transcribeVideo(videoFile);

        await insertLog(userId, 'transcribe', 'success',
          `Transcribed ${transcriptText.split(/\s+/).filter(Boolean).length} words`);

        // Step 4: Detect viral clips with GPT-4o-mini
        setState(s => ({
          ...s,
          pipeline: setStepStatus(s.pipeline, 'detect', 'active', 'Detecting viral segments with GPT-4o-mini…'),
        }));
        await updateJobStatus(jobId, 'detecting', 'Detecting viral segments with GPT-4o-mini…');
        await insertLog(userId, 'segment_detection', 'pending', 'Sending transcript to GPT-4o-mini');

        const rawClips = await findViralClips(transcriptText);

        await insertLog(userId, 'segment_detection', 'success',
          `${rawClips.length} segments identified by GPT-4o-mini`);

        // Step 5: Build clip results with transcript words
        const clips = rawClips.slice(0, 5).map(r => ({
          ...r,
          transcriptWords: words.filter(
            (w: { start_ms: number; end_ms: number }) =>
              w.start_ms / 1000 >= r.startTime && w.end_ms / 1000 <= r.endTime
          ),
        }));

        setState(s => ({
          ...s,
          pipeline: setStepStatus(s.pipeline, 'detect', 'done', `${clips.length} clips ready. Finalising…`),
        }));
        await updateJobStatus(jobId, 'slicing', `${clips.length} clips ready. Finalising…`);

        // Step 6: Consume credit
        let creditConsumed = false;
        const { error: creditErr } = await supabase.rpc('consume_credit', { uid: userId });
        if (creditErr) {
          await insertLog(userId, 'consume_credit', 'error', creditErr.message);
        } else {
          creditConsumed = true;
        }

        // Step 7: Persist video_sources + repurposed_clips
        try {
          const sourceTitle = sourceUrl ?? fileName;
          const { data: vsRow } = await supabase
            .from('video_sources')
            .insert({
              user_id: userId,
              title: sourceTitle,
              source_url: sourceUrl ?? '',
              status: 'COMPLETED',
              duration: 0,
            })
            .select('id')
            .maybeSingle();

          if (vsRow) {
            await supabase.from('repurposed_clips').insert(
              clips.map(c => ({
                video_source_id: vsRow.id,
                start_time: c.startTime,
                end_time: c.endTime,
                clip_storage_url: '',
                ai_title: c.viralTitles[0],
                ai_description: c.seoDescription,
                is_queued: false,
                metadata_json: {
                  viralTitles: c.viralTitles,
                  seoDescription: c.seoDescription,
                  hashtags: c.hashtags,
                  algorithmicTags: c.algorithmicTags,
                },
                source_video_url: sourceUrl ?? '',
                transcript_json: { words: c.transcriptWords },
              })),
            );
          }
        } catch (persistErr) {
          console.error('[pipeline] DB persist failed (non-fatal):', persistErr);
          await insertLog(userId, 'db_persist', 'error',
            persistErr instanceof Error ? persistErr.message : String(persistErr));
        }

        // Step 8: Mark job completed
        await updateJobStatus(jobId, 'completed', `${clips.length} clips extracted from transcript`, {
          progress: 100,
          credits_consumed: creditConsumed,
          result: {
            hasAudio: true,
            videoDurationSecs: 0,
            sourceTitle: sourceUrl ?? fileName,
            sourceVideoUrl: sourceUrl ?? '',
            clips,
            transcriptPreview: transcriptText.slice(0, 500),
          },
        });
        await insertLog(userId, 'job_complete', 'success',
          `Job finished — ${clips.length} clips from transcript`);

      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        const msg = rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError')
          ? 'Could not reach the AI processing service. Please check your connection and try again.'
          : rawMsg;
        console.error('[pipeline] FAILED:', msg);
        await updateJobStatus(jobId, 'failed', undefined, { error_message: msg });
        await insertLog(userId, 'job_failed', 'error', msg).catch(() => {});

        setState(s => ({
          ...s,
          pipelineError: msg,
          pipeline: s.pipeline.map(step =>
            step.status === 'active' ? { ...step, status: 'error' as const, detail: msg } : step
          ),
        }));
      }
    })();

    // ── Poll processing_jobs every 2 seconds for status updates ───────────────
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const { data: jobRow, error: jobErr } = await supabase
          .from('processing_jobs')
          .select('status, step_detail, has_audio, error_message, result')
          .eq('id', jobId)
          .single();

        if (jobErr || !jobRow) return;

        setState(s => ({
          ...s,
          pipeline: mapJobStatusToPipeline(
            s.pipeline,
            jobRow.status,
            jobRow.step_detail ?? null,
            jobRow.has_audio ?? null
          ),
        }));

        if (jobRow.status === 'completed') {
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;

          let finalClips: Clip[] = [];
          if (jobRow.result) {
            finalClips = buildClipsFromResult(jobRow.result as JobResult);
          } else {
            finalClips = await fetchClipsFromDb(userId);
          }

          if (finalClips.length === 0) {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;

            setState(s => ({
              ...s,
              pipelineError: 'Processing completed but no clips were generated. The video may have no speech, or the AI services returned empty results. Check processing logs for details.',
              pipeline: s.pipeline.map(step =>
                step.status === 'active' ? { ...step, status: 'error' as const, detail: 'No clips generated' } : step
              ),
            }));
            return;
          }

          setState(s => ({
            ...s,
            clips: finalClips,
            activeClipIndex: 0,
            screen: 'editor',
            user: {
              ...s.user,
              videosProcessed: s.user.videosProcessed + 1,
              credits: Math.max(s.user.credits - 1, 0),
            },
          }));

          addToast({
            type: 'success',
            title: 'Processing Complete!',
            message: `Successfully generated ${finalClips.length} viral shorts from your video.`,
          });
        } else if (jobRow.status === 'failed') {
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;

          setState(s => ({
            ...s,
            pipelineError: jobRow.error_message ?? 'An error occurred during AI processing.',
            pipeline: s.pipeline.map(step =>
              step.status === 'active' ? { ...step, status: 'error' as const, detail: jobRow.error_message ?? undefined } : step
            ),
          }));
        }
      } catch (pollErr) {
        console.error('Polling error:', pollErr);
      }
    }, 2000);

  }, [state.uploadedFile, state.inputUrl, state.user.credits, addToast, updateJobStatus, insertLog]);

  return {
    state,
    setAuthUser,
    setScreen,
    setActiveClipIndex,
    setSubtitlePreset,
    setEnableIntroTransition,
    setEnableSubjectTracking,
    setActiveWordIndex,
    updateMetadataTitle,
    setInputUrl,
    setIsDragging,
    setUploadedFile,
    openUpgradeModal,
    closeUpgradeModal,
    selectPlan,
    purchasePlan,
    toggleAccountDropdown,
    closeAccountDropdown,
    addToPublishQueue,
    removeFromPublishQueue,
    addToast,
    dismissToast,
    runPipeline,
  };
}