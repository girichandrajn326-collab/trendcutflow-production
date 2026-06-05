import { useState, useCallback, useEffect, useRef } from 'react';
import type { VideoStatus } from '../types/database';
import type { AuthUser } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

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

// Maps processing_jobs.status → which pipeline step is currently active
const JOB_STATUS_TO_ACTIVE_STEP: Record<string, PipelineStepId> = {
  queued:            'download',
  downloading:       'download',
  audio_check:       'audio-check',
  extracting_audio:  'transcribe',
  transcribing:      'transcribe',
  detecting:         'detect',
  slicing:           'slice',
  completed:         'metadata',
};

function mapJobStatusToPipeline(
  current: PipelineStep[],
  status: string,
  stepDetail: string | null,
  hasAudio: boolean | null,
): PipelineStep[] {
  const activeId  = JOB_STATUS_TO_ACTIVE_STEP[status] ?? 'download';
  const activeIdx = PIPELINE_STEP_ORDER.indexOf(activeId);
  const allDone   = status === 'completed';

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
  hasAudio:          boolean;
  videoDurationSecs?: number;
  sourceTitle?:       string;
  clips: Array<{
    startTime:       number;
    endTime:         number;
    viralTitles:     string[];
    seoDescription:  string;
    hashtags:        string[];
    algorithmicTags: string[];
    transcriptWords: Array<{ id: number; word: string; start_ms: number; end_ms: number }>;
  }>;
}

function buildClipsFromResult(result: JobResult): Clip[] {
  return result.clips.map((r, i) => ({
    id:        crypto.randomUUID(),
    title:     r.viralTitles[0],
    duration:  formatDuration(r.startTime, r.endTime),
    thumbnail: THUMBNAIL_POOL[i % THUMBNAIL_POOL.length],
    startTime: r.startTime,
    endTime:   r.endTime,
    transcript: r.transcriptWords.map(w => ({
      id:      w.id,
      word:    w.word,
      startMs: w.start_ms,
      endMs:   w.end_ms,
    })),
    metadata: {
      viralTitles:     r.viralTitles,
      seoDescription:  r.seoDescription,
      hashtags:        r.hashtags,
      algorithmicTags: r.algorithmicTags,
    },
    noAudio: !result.hasAudio,
  }));
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
    .slice(0, 2) || authUser.email[0].toUpperCase();
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

const MOCK_TRANSCRIPT: TranscriptWord[] = [
  { id: 0,  word: 'The',       startMs: 0,    endMs: 220  },
  { id: 1,  word: 'single',    startMs: 280,  endMs: 560  },
  { id: 2,  word: 'biggest',   startMs: 620,  endMs: 940  },
  { id: 3,  word: 'shift',     startMs: 1000, endMs: 1240 },
  { id: 4,  word: 'I',         startMs: 1300, endMs: 1420 },
  { id: 5,  word: 'made',      startMs: 1480, endMs: 1740 },
  { id: 6,  word: 'was',       startMs: 1800, endMs: 1980 },
  { id: 7,  word: 'stop',      startMs: 2040, endMs: 2320 },
  { id: 8,  word: 'selling',   startMs: 2380, endMs: 2700 },
  { id: 9,  word: 'features',  startMs: 2760, endMs: 3200 },
  { id: 10, word: 'and',       startMs: 3260, endMs: 3440 },
  { id: 11, word: 'start',     startMs: 3500, endMs: 3780 },
  { id: 12, word: 'selling',   startMs: 3840, endMs: 4160 },
  { id: 13, word: 'outcomes.', startMs: 4220, endMs: 4680 },
];

const MOCK_CLIPS: Clip[] = [
  {
    id: 'clip-1',
    title: 'I Changed ONE Thing & Made 5x More Revenue in 60 Days',
    duration: '0:58',
    thumbnail: THUMBNAIL_POOL[0],
    startTime: 0, endTime: 58,
    transcript: MOCK_TRANSCRIPT,
    metadata: {
      viralTitles: ['I Changed ONE Thing & Made 5x More Revenue in 60 Days', 'Stop Selling Features (Do This Instead)', 'The Mindset That Took Me From 2% to 11% Conversion Rate'],
      seoDescription: 'Discover the single mindset shift that transformed my business revenue.',
      hashtags: ['#BusinessGrowth', '#SalesTips', '#Entrepreneur', '#RevenueGrowth', '#MindsetShift', '#ConversionRate'],
      algorithmicTags: ['mindset shift business', 'increase conversion rate', 'sales strategy 2024', 'entrepreneur tips', 'business revenue growth'],
    },
  },
  {
    id: 'clip-2',
    title: 'Most Creators Quit RIGHT Before Going Viral',
    duration: '1:02',
    thumbnail: THUMBNAIL_POOL[1],
    startTime: 62, endTime: 124,
    transcript: MOCK_TRANSCRIPT.map(w => ({ ...w })),
    metadata: {
      viralTitles: ["Most Creators Quit RIGHT Before Going Viral (Here's Proof)", "The Algorithm Rewards This One Thing (It's Not Talent)", 'I Studied 200 Viral Accounts — They All Did This'],
      seoDescription: 'After studying 200+ creator accounts that went viral, I found a shocking pattern.',
      hashtags: ['#ContentCreator', '#YouTubeTips', '#ViralContent', '#CreatorEconomy', '#SocialMediaGrowth', '#ConsistencyIsKey'],
      algorithmicTags: ['creator tips going viral', 'youtube algorithm 2024', 'content creator strategy', 'grow on social media', 'consistency content creation'],
    },
  },
  {
    id: 'clip-3',
    title: 'The 5-Line Cold Email That Gets 40% Reply Rates',
    duration: '0:54',
    thumbnail: THUMBNAIL_POOL[2],
    startTime: 130, endTime: 184,
    transcript: MOCK_TRANSCRIPT.map(w => ({ ...w })),
    metadata: {
      viralTitles: ['The 5-Line Cold Email That Gets 40% Reply Rates', "I Sent 10,000 Cold Emails — Here's What Actually Works", 'Copy This Cold Email Formula (40% Response Rate)'],
      seoDescription: "After 10,000+ cold emails sent, I've refined a 5-line formula that consistently achieves 40% reply rates.",
      hashtags: ['#ColdEmail', '#EmailMarketing', '#LeadGeneration', '#SalesTips', '#OutreachStrategy', '#B2BSales'],
      algorithmicTags: ['cold email tips', 'email outreach strategy', 'b2b sales tactics', 'lead generation emails', 'sales email template'],
    },
  },
  {
    id: 'clip-4',
    title: 'I Shared My Real Revenue Numbers — My Following Tripled',
    duration: '1:05',
    thumbnail: THUMBNAIL_POOL[3],
    startTime: 190, endTime: 255,
    transcript: MOCK_TRANSCRIPT.map(w => ({ ...w })),
    metadata: {
      viralTitles: ['I Shared My Real Revenue Numbers — My Following Tripled', 'Build in Public: The Growth Strategy Nobody Talks About', 'Why Showing Your Failures Online Is the Best Marketing'],
      seoDescription: 'By sharing real revenue, real failures, and real spreadsheets, I tripled my following in 4 months.',
      hashtags: ['#BuildInPublic', '#CreatorEconomy', '#Transparency', '#PersonalBrand', '#StartupLife', '#ContentStrategy'],
      algorithmicTags: ['build in public strategy', 'personal brand growth', 'creator transparency', 'grow following fast', 'authentic content marketing'],
    },
  },
  {
    id: 'clip-5',
    title: 'A Client Said I Was Too Cheap to Be Credible — So I Raised Prices',
    duration: '0:51',
    thumbnail: THUMBNAIL_POOL[4],
    startTime: 260, endTime: 311,
    transcript: MOCK_TRANSCRIPT.map(w => ({ ...w })),
    metadata: {
      viralTitles: ["A Client Said I Was 'Too Cheap to Be Credible' — So I Raised Prices", "Raising My Prices 40% Got Me MORE Clients (Here's Why)", 'The 2AM Lesson That Changed My Entire Pricing Strategy'],
      seoDescription: "When a prospect said I was 'too cheap to be credible,' I raised my prices 40% and booked 3 new clients in 2 weeks.",
      hashtags: ['#PricingStrategy', '#Freelance', '#BusinessTips', '#Consulting', '#ValueBasedPricing', '#Entrepreneurship'],
      algorithmicTags: ['pricing strategy business', 'raise your prices', 'value based pricing', 'freelancer tips', 'consulting pricing'],
    },
  },
];

const INITIAL_PIPELINE: PipelineStep[] = [
  { id: 'download',    label: 'Downloading video (server-side)',   status: 'pending' },
  { id: 'audio-check', label: 'Analysing audio stream',            status: 'pending' },
  { id: 'transcribe',  label: 'Transcribing audio (Whisper)',      status: 'pending' },
  { id: 'detect',      label: 'Detecting viral hooks (GPT-4o)',    status: 'pending' },
  { id: 'slice',       label: 'Slicing video clips (FFmpeg)',      status: 'pending' },
  { id: 'subtitles',   label: 'Burning captions',                  status: 'pending' },
  { id: 'metadata',    label: 'Generating metadata',               status: 'pending' },
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
    pipeline: INITIAL_PIPELINE.map(s => ({ ...s })),
    pipelineError: null,
    toasts: [],
  });

  // Keep a ref for the realtime channel so we can unsubscribe on logout
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Interval that polls processing_jobs while a job is running
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
      // Initial credits/plan fetch
      supabase
        .from('users')
        .select('current_plan, total_credits, credits_used, credits')
        .eq('id', authUser.id)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const planMap: Record<string, PlanTier> = { FREE: 'free', CREATOR: 'creator', PRO: 'pro' };
          setState(s => ({
            ...s,
            user: {
              ...s.user,
              plan:            planMap[data.current_plan] ?? 'free',
              totalCredits:    data.total_credits,
              videosProcessed: data.credits_used,
              credits:         data.credits ?? Math.max(data.total_credits - data.credits_used, 0),
            },
          }));
        });

      // Realtime subscription — update credit counter instantly after consume/grant
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
            const planMap: Record<string, PlanTier> = { FREE: 'free', CREATOR: 'creator', PRO: 'pro' };
            setState(s => ({
              ...s,
              user: {
                ...s.user,
                plan:            planMap[d.current_plan] ?? s.user.plan,
                totalCredits:    d.total_credits,
                videosProcessed: d.credits_used,
                credits:         d.credits ?? Math.max(d.total_credits - d.credits_used, 0),
              },
            }));
          },
        )
        .subscribe();

      // Publish queue restore
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
            scheduledAt: new Date(row.scheduled_at),
          })).filter(e => e.clipId);
          if (entries.length > 0) setState(s => ({ ...s, publishQueue: entries }));
        });
    } else {
      // Cleanup realtime on logout
      realtimeChannelRef.current?.unsubscribe();
      realtimeChannelRef.current = null;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, []);

  // Cleanup on unmount
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

  const setActiveWordIndex = useCallback((i: number) => {
    setState(s => ({ ...s, activeWordIndex: i }));
  }, []);

  const updateMetadataTitle = useCallback((clipId: string, titleIndex: number, value: string) => {
    setState(s => ({
      ...s,
      clips: s.clips.map(c =>
        c.id === clipId
          ? { ...c, metadata: { ...c.metadata, viralTitles: c.metadata.viralTitles.map((t, i) => i === titleIndex ? value : t) } }
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

  const openUpgradeModal  = useCallback(() => setState(s => ({ ...s, isUpgradeModalOpen: true  })), []);
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
          current_plan:  planDbMap[plan] as 'FREE' | 'CREATOR' | 'PRO',
          total_credits: PLAN_LIMITS[plan],
          credits_used:  0,
          credits:       PLAN_LIMITS[plan],
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
          user_id:       s.user.id,
          clip_id:       entry.clipId,
          clip_title:    clip?.title ?? '',
          platform:      entry.platform,
          interval_hours: entry.intervalHours,
          scheduled_at:  entry.scheduledAt.toISOString(),
          status:        'pending',
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
  //
  // New architecture: upload file (or send YouTube URL) to the start-job edge
  // function which returns a jobId immediately.  Processing runs server-side
  // inside EdgeRuntime.waitUntil().  The browser polls processing_jobs every
  // 2 seconds and maps the server status to pipeline steps.
  //
  // This eliminates "Failed to fetch" browser timeouts on long videos.

  const runPipeline = useCallback(async () => {
    const source = state.uploadedFile ?? state.inputUrl;
    if (!source) return;
    if (state.user.videosProcessed >= state.user.totalCredits) return;

    // Reset UI immediately
    setState(s => ({
      ...s,
      screen:        'processing',
      clips:         [],
      pipeline:      INITIAL_PIPELINE.map(step => ({ ...step })),
      pipelineError: null,
    }));

    setState(s => ({
      ...s,
      pipeline: setStepStatus(s.pipeline, 'download', 'active', 'Uploading your video…'),
    }));

    // ── Auth token ──────────────────────────────────────────────────────────
    const { data: { session } } = await supabase.auth.getSession();
    const token  = session?.access_token;
    const userId = session?.user?.id;
    if (!token || !userId) {
      setState(s => ({
        ...s,
        pipelineError: 'Not authenticated. Please sign in again.',
        pipeline: setStepStatus(s.pipeline, 'download', 'error'),
      }));
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

    // ── Call start-job → get jobId ──────────────────────────────────────────
    let jobId: string;
    try {
      let body: string;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      if (source instanceof File) {
        // Enforce 500 MB hard cap before touching the network
        if (source.size > 500 * 1024 * 1024) {
          throw new Error('File too large (max 500 MB). Please compress the video or paste a YouTube URL instead.');
        }

        // Upload directly to Supabase Storage first.
        // Path must start with the userId UUID so Supabase Storage can set
        // owner_id correctly (it derives it from the first path segment).
        const safeName    = source.name.replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
        const uploadPath  = `${userId}/${Date.now()}_${safeName}`;

        setState(s => ({
          ...s,
          pipeline: setStepStatus(s.pipeline, 'download', 'active',
            `Uploading ${(source.size / 1024 / 1024).toFixed(1)} MB…`),
        }));

        const { error: storageErr } = await supabase.storage
          .from('videos')
          .upload(uploadPath, source, { contentType: source.type || 'video/mp4' });

        if (storageErr) throw new Error(`Upload failed: ${storageErr.message}`);

        body = JSON.stringify({ storagePath: uploadPath, fileName: source.name, fileType: source.type || 'video/mp4' });
      } else {
        body = JSON.stringify({ sourceUrl: source, sourceType: 'youtube' });
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/start-job`, {
        method: 'POST',
        headers,
        body,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to start job' }));
        if (res.status === 402) throw new Error(err.error ?? 'Credit limit reached. Please upgrade your plan.');
        if (res.status === 413) throw new Error(err.error ?? 'File too large. Please use a YouTube URL or trim the video.');
        throw new Error(err.error ?? `Failed to start job (${res.status})`);
      }

      const data = await res.json();
      jobId = data.jobId;
      if (!jobId) throw new Error('Server did not return a job ID');

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start processing job';
      setState(s => ({
        ...s,
        pipelineError: msg,
        pipeline: setStepStatus(s.pipeline, 'download', 'error', msg),
      }));
      return;
    }

    // Job started — mark download as done while server-side work begins
    setState(s => ({
      ...s,
      pipeline: setStepStatus(s.pipeline, 'download', 'done', 'Queued for processing'),
    }));

    // ── Poll processing_jobs every 2 seconds ────────────────────────────────
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

    pollingIntervalRef.current = setInterval(async () => {
      const { data: job } = await supabase
        .from('processing_jobs')
        .select('id, status, step_detail, has_audio, result, error_message')
        .eq('id', jobId)
        .maybeSingle();

      if (!job) return;

      // Mirror job status into the visual pipeline
      setState(s => ({
        ...s,
        pipeline: mapJobStatusToPipeline(s.pipeline, job.status, job.step_detail, job.has_audio),
      }));

      if (job.status === 'completed' && job.result) {
        clearInterval(pollingIntervalRef.current!);
        pollingIntervalRef.current = null;

        const newClips = buildClipsFromResult(job.result as JobResult);
        setState(s => ({
          ...s,
          clips:           newClips,
          activeClipIndex: 0,
          activeWordIndex: 0,
          screen:          'editor',
          randomStyleSeed: generateRandomStyleSeed(),
          pipeline:        mapJobStatusToPipeline(s.pipeline, 'completed', null, (job.result as JobResult).hasAudio),
          user:            { ...s.user, videosProcessed: s.user.videosProcessed + 1 },
        }));
      }

      if (job.status === 'failed') {
        clearInterval(pollingIntervalRef.current!);
        pollingIntervalRef.current = null;

        setState(s => ({
          ...s,
          pipelineError: job.error_message ?? 'Processing failed. Please try again.',
          pipeline: s.pipeline.map(p =>
            p.status === 'active' ? { ...p, status: 'error' as const } : p,
          ),
        }));
      }
    }, 2000);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.uploadedFile, state.inputUrl, state.user.videosProcessed, state.user.totalCredits]);

  return {
    state,
    setAuthUser,
    setScreen,
    setActiveClipIndex,
    setSubtitlePreset,
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
    getMockClips: () => MOCK_CLIPS,
  };
}
