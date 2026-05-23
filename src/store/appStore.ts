import { useState, useCallback } from 'react';
import type { VideoStatus } from '../types/database';
import { transcribeVideo, findViralClips } from '../lib/ai';

export type AppScreen = 'intake' | 'processing' | 'editor';
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
  | 'transcribe'
  | 'detect'
  | 'slice'
  | 'subtitles'
  | 'metadata';

export type PipelineStepStatus = 'pending' | 'active' | 'done' | 'error';

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  status: PipelineStepStatus;
}

// ─── User / Plan types ────────────────────────────────────────────────────────

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  plan: PlanTier;
  videosProcessed: number;
  totalCredits: number;
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
  scheduledAt?: Date;
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
  return 0.5 + (Math.random() - 0.5) * 0.4;
}

function formatDuration(start: number, end: number): string {
  const secs = Math.round(end - start);
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

function setStepStatus(
  steps: PipelineStep[],
  id: PipelineStepId,
  status: PipelineStepStatus,
): PipelineStep[] {
  return steps.map(s => s.id === id ? { ...s, status } : s);
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
  avatarInitials: 'GU',
};

const MOCK_TRANSCRIPT: TranscriptWord[] = [
  { id: 0, word: 'The',         startMs: 0,    endMs: 220  },
  { id: 1, word: 'single',      startMs: 280,  endMs: 560  },
  { id: 2, word: 'biggest',     startMs: 620,  endMs: 940  },
  { id: 3, word: 'shift',       startMs: 1000, endMs: 1240 },
  { id: 4, word: 'I',           startMs: 1300, endMs: 1420 },
  { id: 5, word: 'made',        startMs: 1480, endMs: 1740 },
  { id: 6, word: 'was',         startMs: 1800, endMs: 1980 },
  { id: 7, word: 'stop',        startMs: 2040, endMs: 2320 },
  { id: 8, word: 'selling',     startMs: 2380, endMs: 2700 },
  { id: 9, word: 'features',    startMs: 2760, endMs: 3200 },
  { id: 10, word: 'and',        startMs: 3260, endMs: 3440 },
  { id: 11, word: 'start',      startMs: 3500, endMs: 3780 },
  { id: 12, word: 'selling',    startMs: 3840, endMs: 4160 },
  { id: 13, word: 'outcomes.',  startMs: 4220, endMs: 4680 },
];

const MOCK_CLIPS: Clip[] = [
  {
    id: 'clip-1',
    title: 'I Changed ONE Thing & Made 5x More Revenue in 60 Days',
    duration: '0:58',
    thumbnail: THUMBNAIL_POOL[0],
    startTime: 0,
    endTime: 58,
    transcript: MOCK_TRANSCRIPT,
    metadata: {
      viralTitles: [
        'I Changed ONE Thing & Made 5x More Revenue in 60 Days',
        'Stop Selling Features (Do This Instead)',
        'The Mindset That Took Me From 2% to 11% Conversion Rate',
      ],
      seoDescription: 'Discover the single mindset shift that transformed my business revenue. Stop selling features and start selling outcomes.',
      hashtags: ['#BusinessGrowth', '#SalesTips', '#Entrepreneur', '#RevenueGrowth', '#MindsetShift', '#ConversionRate'],
      algorithmicTags: ['mindset shift business', 'increase conversion rate', 'sales strategy 2024', 'entrepreneur tips', 'business revenue growth'],
    },
  },
  {
    id: 'clip-2',
    title: 'Most Creators Quit RIGHT Before Going Viral (Here\'s Proof)',
    duration: '1:02',
    thumbnail: THUMBNAIL_POOL[1],
    startTime: 62,
    endTime: 124,
    transcript: MOCK_TRANSCRIPT,
    metadata: {
      viralTitles: [
        'Most Creators Quit RIGHT Before Going Viral (Here\'s Proof)',
        'The Algorithm Rewards This One Thing (It\'s Not Talent)',
        'I Studied 200 Viral Accounts — They All Did This',
      ],
      seoDescription: 'After studying 200+ creator accounts that went viral, I found a shocking pattern. Most people quit between days 60-90.',
      hashtags: ['#ContentCreator', '#YouTubeTips', '#ViralContent', '#CreatorEconomy', '#SocialMediaGrowth'],
      algorithmicTags: ['creator tips going viral', 'youtube algorithm 2024', 'content creator strategy', 'grow on social media'],
    },
  },
  {
    id: 'clip-3',
    title: 'The 5-Line Cold Email That Gets 40% Reply Rates',
    duration: '0:54',
    thumbnail: THUMBNAIL_POOL[2],
    startTime: 130,
    endTime: 184,
    transcript: MOCK_TRANSCRIPT,
    metadata: {
      viralTitles: [
        'The 5-Line Cold Email That Gets 40% Reply Rates',
        'I Sent 10,000 Cold Emails — Here\'s What Actually Works',
        'Copy This Cold Email Formula (40% Response Rate)',
      ],
      seoDescription: 'Cold email doesn\'t have to be painful. After 10,000+ cold emails, I\'ve refined a 5-line formula that achieves 40% reply rates.',
      hashtags: ['#ColdEmail', '#EmailMarketing', '#LeadGeneration', '#SalesTips', '#OutreachStrategy'],
      algorithmicTags: ['cold email tips', 'email outreach strategy', 'b2b sales tactics', 'lead generation emails'],
    },
  },
  {
    id: 'clip-4',
    title: 'I Shared My Real Revenue Numbers — My Following Tripled',
    duration: '1:05',
    thumbnail: THUMBNAIL_POOL[3],
    startTime: 190,
    endTime: 255,
    transcript: MOCK_TRANSCRIPT,
    metadata: {
      viralTitles: [
        'I Shared My Real Revenue Numbers — My Following Tripled',
        'Build in Public: The Growth Strategy Nobody Talks About',
        'Why Showing Your Failures Online Is the Best Marketing',
      ],
      seoDescription: 'Building in public transformed my online presence. By sharing real revenue and real failures, I tripled my following in 4 months.',
      hashtags: ['#BuildInPublic', '#CreatorEconomy', '#Transparency', '#PersonalBrand', '#StartupLife'],
      algorithmicTags: ['build in public strategy', 'personal brand growth', 'creator transparency', 'grow following fast'],
    },
  },
  {
    id: 'clip-5',
    title: 'A Client Said I Was "Too Cheap to Be Credible" — So I Raised Prices',
    duration: '0:51',
    thumbnail: THUMBNAIL_POOL[4],
    startTime: 260,
    endTime: 311,
    transcript: MOCK_TRANSCRIPT,
    metadata: {
      viralTitles: [
        'A Client Said I Was "Too Cheap to Be Credible" — So I Raised Prices',
        'Raising My Prices 40% Got Me MORE Clients (Here\'s Why)',
        'The 2AM Lesson That Changed My Entire Pricing Strategy',
      ],
      seoDescription: 'A late-night conversation taught me the most important pricing lesson of my career. When a prospect said I was "too cheap to be credible", I raised my prices 40%.',
      hashtags: ['#PricingStrategy', '#Freelance', '#BusinessTips', '#Consulting', '#ValueBasedPricing'],
      algorithmicTags: ['pricing strategy business', 'raise your prices', 'value based pricing', 'freelancer tips'],
    },
  },
];

const INITIAL_PIPELINE: PipelineStep[] = [
  { id: 'transcribe', label: 'Transcribing audio (Whisper)',  status: 'pending' },
  { id: 'detect',     label: 'Detecting viral hooks (GPT-4o)', status: 'pending' },
  { id: 'slice',      label: 'Slicing video clips (FFmpeg)',  status: 'pending' },
  { id: 'subtitles',  label: 'Burning captions',             status: 'pending' },
  { id: 'metadata',   label: 'Generating metadata',          status: 'pending' },
];

// ─── useAppState hook ─────────────────────────────────────────────────────────

export function useAppState() {
  const [state, setState] = useState<AppState>({
    screen: 'intake',
    user: MOCK_USER,
    activeClipIndex: 0,
    clips: MOCK_CLIPS,
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

  const setScreen = useCallback((screen: AppScreen) => {
    setState(s => ({ ...s, screen }));
  }, []);

  const setActiveClipIndex = useCallback((i: number) => {
    setState(s => ({ ...s, activeClipIndex: i, activeWordIndex: 0, randomStyleSeed: generateRandomStyleSeed() }));
  }, []);

  const setSubtitlePreset = useCallback((preset: SubtitlePreset) => {
    setState(s => ({ ...s, subtitlePreset: preset, randomStyleSeed: generateRandomStyleSeed() }));
  }, []);

  const setActiveWordIndex = useCallback((i: number) => {
    setState(s => ({ ...s, activeWordIndex: i }));
  }, []);

  const openUpgradeModal = useCallback(() => {
    setState(s => ({ ...s, isUpgradeModalOpen: true, isAccountDropdownOpen: false }));
  }, []);

  const closeUpgradeModal = useCallback(() => {
    setState(s => ({ ...s, isUpgradeModalOpen: false }));
  }, []);

  const toggleAccountDropdown = useCallback(() => {
    setState(s => ({ ...s, isAccountDropdownOpen: !s.isAccountDropdownOpen }));
  }, []);

  const closeAccountDropdown = useCallback(() => {
    setState(s => ({ ...s, isAccountDropdownOpen: false }));
  }, []);

  const setInputUrl = useCallback((url: string) => {
    setState(s => ({ ...s, inputUrl: url }));
  }, []);

  const setIsDragging = useCallback((isDragging: boolean) => {
    setState(s => ({ ...s, isDragging }));
  }, []);

  const setUploadedFile = useCallback((file: File | null) => {
    setState(s => ({ ...s, uploadedFile: file }));
  }, []);

  const addToPublishQueue = useCallback((entry: QueueEntry) => {
    setState(s => ({
      ...s,
      publishQueue: s.publishQueue.some(e => e.clipId === entry.clipId)
        ? s.publishQueue
        : [...s.publishQueue, entry],
    }));
  }, []);

  const removeFromPublishQueue = useCallback((clipId: string) => {
    setState(s => ({ ...s, publishQueue: s.publishQueue.filter(e => e.clipId !== clipId) }));
  }, []);

  const selectPlan = useCallback((plan: PlanTier) => {
    setState(s => ({
      ...s,
      user: { ...s.user, plan, totalCredits: PLAN_LIMITS[plan] },
      isUpgradeModalOpen: false,
    }));
  }, []);

  const purchasePlan = useCallback((plan: PlanTier): Promise<void> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const planNames: Record<PlanTier, string> = {
          free: 'Free',
          creator: 'Creator Flow',
          pro: 'Pro Flow',
        };
        const newCredits = PLAN_LIMITS[plan];
        const toastId = `toast-${Date.now()}`;
        setState(s => ({
          ...s,
          user: { ...s.user, plan, totalCredits: newCredits },
          isUpgradeModalOpen: false,
          toasts: [...s.toasts, {
            id: toastId,
            type: 'success',
            title: 'Payment Verified via Razorpay!',
            message: `Welcome to your new Flow — ${newCredits} credit${newCredits > 1 ? 's' : ''}/month now active.`,
          }],
        }));
        setTimeout(() => {
          setState(s => ({ ...s, toasts: s.toasts.filter(t => t.id !== toastId) }));
        }, 4800);
        resolve();
      }, 2200);
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setState(s => ({ ...s, toasts: s.toasts.filter(t => t.id !== id) }));
  }, []);

  // Update user identity from external auth (AuthContext)
  const setAuthUser = useCallback((authUser: { id: string; email: string; name: string } | null) => {
    if (!authUser) {
      setState(s => ({
        ...s,
        user: { ...MOCK_USER },
        screen: 'intake',
        publishQueue: [],
      }));
      return;
    }
    const initials = authUser.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    setState(s => ({
      ...s,
      user: {
        ...s.user,
        id: authUser.id,
        email: authUser.email,
        name: authUser.name,
        avatarInitials: initials,
      },
    }));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}`;
    setState(s => ({ ...s, toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => {
      setState(s => ({ ...s, toasts: s.toasts.filter(t => t.id !== id) }));
    }, 4800);
  }, []);

  const runPipeline = useCallback(async () => {
    const source = state.uploadedFile ?? state.inputUrl;
    if (!source) return;

    setState(s => ({
      ...s,
      screen: 'processing',
      pipeline: INITIAL_PIPELINE.map(step => ({ ...step })),
      pipelineError: null,
    }));

    try {
      setState(s => ({ ...s, pipeline: setStepStatus(s.pipeline, 'transcribe', 'active') }));
      const { text: transcriptText, words } = await transcribeVideo(source);
      setState(s => ({ ...s, pipeline: setStepStatus(s.pipeline, 'transcribe', 'done') }));

      setState(s => ({ ...s, pipeline: setStepStatus(s.pipeline, 'detect', 'active') }));
      const viralResults = await findViralClips(transcriptText);
      setState(s => ({ ...s, pipeline: setStepStatus(s.pipeline, 'detect', 'done') }));

      setState(s => ({ ...s, pipeline: setStepStatus(s.pipeline, 'slice', 'active') }));
      await sleep(900);
      setState(s => ({ ...s, pipeline: setStepStatus(s.pipeline, 'slice', 'done') }));

      setState(s => ({ ...s, pipeline: setStepStatus(s.pipeline, 'subtitles', 'active') }));
      await sleep(700);
      setState(s => ({ ...s, pipeline: setStepStatus(s.pipeline, 'subtitles', 'done') }));

      setState(s => ({ ...s, pipeline: setStepStatus(s.pipeline, 'metadata', 'active') }));

      const videoSourceId = crypto.randomUUID();

      const clips: Clip[] = viralResults.map((r, i) => {
        const clipWords = words.filter(
          w => w.start_ms / 1000 >= r.startTime && w.end_ms / 1000 <= r.endTime,
        );
        const uiWords: TranscriptWord[] = clipWords.length > 0
          ? clipWords.map(w => ({ id: w.id, word: w.word, startMs: w.start_ms, endMs: w.end_ms }))
          : MOCK_TRANSCRIPT;

        return {
          id: crypto.randomUUID(),
          videoSourceId,
          title: r.viralTitles[0],
          duration: formatDuration(r.startTime, r.endTime),
          thumbnail: THUMBNAIL_POOL[i % THUMBNAIL_POOL.length],
          startTime: r.startTime,
          endTime: r.endTime,
          transcript: uiWords,
          metadata: {
            viralTitles: r.viralTitles,
            seoDescription: r.seoDescription,
            hashtags: r.hashtags,
            algorithmicTags: r.algorithmicTags,
          },
        };
      });

      setState(s => ({
        ...s,
        clips: clips.length > 0 ? clips : MOCK_CLIPS,
        activeClipIndex: 0,
        activeWordIndex: 0,
        pipeline: setStepStatus(s.pipeline, 'metadata', 'done'),
        screen: 'editor',
        randomStyleSeed: generateRandomStyleSeed(),
      }));

      // Update credit usage
      setState(s => ({
        ...s,
        user: { ...s.user, videosProcessed: s.user.videosProcessed + 1 },
      }));

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setState(s => ({
        ...s,
        pipelineError: msg,
        pipeline: s.pipeline.map(p => p.status === 'active' ? { ...p, status: 'error' } : p),
      }));
    }
  }, [state]);

  const updateClipTitle = useCallback((clipId: string, newTitle: string) => {
    setState(s => ({
      ...s,
      clips: s.clips.map(c => c.id === clipId ? { ...c, title: newTitle } : c),
    }));
  }, []);

  const updateMetadataTitle = useCallback((clipId: string, index: number, value: string) => {
    setState(s => ({
      ...s,
      clips: s.clips.map(c =>
        c.id === clipId
          ? { ...c, metadata: { ...c.metadata, viralTitles: c.metadata.viralTitles.map((t, i) => i === index ? value : t) } }
          : c
      ),
    }));
  }, []);

  const creditLabel = () => {
    const limit = PLAN_LIMITS[state.user.plan];
    return `${state.user.videosProcessed} / ${limit} Videos Processed`;
  };

  const hasCredits = () => state.user.videosProcessed < PLAN_LIMITS[state.user.plan];

  return {
    state,
    setScreen,
    setActiveClipIndex,
    setSubtitlePreset,
    setActiveWordIndex,
    openUpgradeModal,
    closeUpgradeModal,
    toggleAccountDropdown,
    closeAccountDropdown,
    setInputUrl,
    setIsDragging,
    setUploadedFile,
    addToPublishQueue,
    removeFromPublishQueue,
    selectPlan,
    purchasePlan,
    dismissToast,
    addToast,
    setAuthUser,
    runPipeline,
    updateClipTitle,
    updateMetadataTitle,
    creditLabel,
    hasCredits,
  };
}
