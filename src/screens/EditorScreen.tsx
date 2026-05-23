import { useCallback, useEffect, useRef, useState, memo } from 'react';
import {
  Play, Pause, ChevronLeft, ChevronRight, Clock, Copy,
  CheckCheck, Send, CalendarClock, Plus, Trash2, Tag,
  FileText, Hash, Wand2, LayoutGrid, Pencil, Check,
  Youtube, Instagram, Ghost, ChevronUp, CheckCircle2,
} from 'lucide-react';
import type { AppState, SubtitlePreset, TranscriptWord, QueueEntry, QueuePlatform, QueueInterval } from '../store/appStore';
import { getStyleSeedVariation } from '../lib/ffmpegClient';
import { calculateSchedule, formatScheduledTime, formatScheduledShort } from '../lib/publishQueue';
import { trimVideoClip } from '../lib/videoProcessor';

interface EditorScreenProps {
  state: AppState;
  onSetClip: (i: number) => void;
  onSetPreset: (p: SubtitlePreset) => void;
  onSetActiveWord: (i: number) => void;
  onAddToQueue: (entry: QueueEntry) => void;
  onRemoveFromQueue: (clipId: string) => void;
  onUpdateTitle: (clipId: string, i: number, val: string) => void;
}

const PRESET_LABELS: Record<SubtitlePreset, string> = {
  hormozi:    'Hormozi',
  minimalist: 'Minimalist',
  cyberpunk:  'Cyberpunk',
};
const PRESET_DESC: Record<SubtitlePreset, string> = {
  hormozi:    'Bold caps · lime highlight · black stroke',
  minimalist: 'White center · fade-out inactive words',
  cyberpunk:  'Cyan badge · scale pulse on activation',
};

// ─── Root screen ──────────────────────────────────────────────────────────────

export default function EditorScreen({
  state,
  onSetClip,
  onSetPreset,
  onSetActiveWord,
  onAddToQueue,
  onRemoveFromQueue,
  onUpdateTitle,
}: EditorScreenProps) {
  const { activeClipIndex, clips, subtitlePreset, activeWordIndex, publishQueue, randomStyleSeed } = state;
  const clip = clips[activeClipIndex];

  const [isPlaying, setIsPlaying]               = useState(false);
  const [copied, setCopied]                     = useState<string | null>(null);
  const [editingTitleIdx, setEditingTitleIdx]   = useState<number | null>(null);
  const [wordEdits, setWordEdits]               = useState<Record<number, string>>({});
  const [editingWordIdx, setEditingWordIdx]     = useState<number | null>(null);
  // Client-side trimmed clip: blob URL produced by FFmpeg.wasm, keyed per clip id
  const [clipBlobUrls, setClipBlobUrls]         = useState<Record<string, string>>({});
  const [trimming, setTrimming]                 = useState(false);

  // ── Scheduling UI state ──────────────────────────────────────────────────────
  const [schedDropOpen, setSchedDropOpen]       = useState(false);
  const [schedPlatform, setSchedPlatform]       = useState<QueuePlatform>('youtube_shorts');
  const [schedInterval, setSchedInterval]       = useState<QueueInterval>(24);
  const [queueDrawerOpen, setQueueDrawerOpen]   = useState(false);
  const schedDropRef                            = useRef<HTMLDivElement>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const playRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  // drag-scrub state
  const scrubbing     = useRef(false);

  // ── Playback interval ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      playRef.current = setInterval(() => {
        onSetActiveWord((state.activeWordIndex + 1) % clip.transcript.length);
      }, 340);
    } else {
      if (playRef.current) clearInterval(playRef.current);
    }
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [isPlaying, state.activeWordIndex, clip.transcript.length, onSetActiveWord]);

  // Reset on clip switch
  useEffect(() => {
    setIsPlaying(false);
    onSetActiveWord(0);
    setWordEdits({});
    setEditingWordIdx(null);
  }, [activeClipIndex, onSetActiveWord]);

  // Trim current clip client-side when an uploaded file is available.
  // Runs once per clip id; skips if we already have a blob URL for it.
  useEffect(() => {
    const uploadedFile = state.uploadedFile;
    if (!uploadedFile) return;
    if (clipBlobUrls[clip.id]) return;

    let cancelled = false;
    setTrimming(true);
    trimVideoClip(uploadedFile, clip.startTime, clip.endTime)
      .then((blobUrl) => {
        if (cancelled) { URL.revokeObjectURL(blobUrl); return; }
        setClipBlobUrls(prev => ({ ...prev, [clip.id]: blobUrl }));
      })
      .catch(() => { /* silently fall back to thumbnail */ })
      .finally(() => { if (!cancelled) setTrimming(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, state.uploadedFile]);

  // Revoke all blob URLs when the component unmounts to free memory.
  useEffect(() => {
    return () => {
      Object.values(clipBlobUrls).forEach(URL.revokeObjectURL);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close schedule dropdown on outside click.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (schedDropRef.current && !schedDropRef.current.contains(e.target as Node)) {
        setSchedDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Scroll active word into transcript view
  useEffect(() => {
    const el = transcriptRef.current?.querySelector<HTMLElement>(`[data-word-idx="${activeWordIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeWordIndex]);

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  }, []);

  // ── Scrub-drag: click or drag across transcript updates active word ─────────
  const handleTranscriptPointerDown = useCallback((e: React.PointerEvent) => {
    scrubbing.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleTranscriptPointerMove = useCallback((e: React.PointerEvent) => {
    if (!scrubbing.current) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const idx = target?.getAttribute('data-word-idx');
    if (idx !== null && idx !== undefined) onSetActiveWord(Number(idx));
  }, [onSetActiveWord]);

  const handleTranscriptPointerUp = useCallback(() => {
    scrubbing.current = false;
  }, []);

  // ── Word inline edit handlers ───────────────────────────────────────────────
  const commitWordEdit = useCallback((idx: number, val: string) => {
    if (val.trim() === clip.transcript[idx]?.word) {
      setWordEdits(prev => { const n = { ...prev }; delete n[idx]; return n; });
    } else {
      setWordEdits(prev => ({ ...prev, [idx]: val.trim() }));
    }
    setEditingWordIdx(null);
  }, [clip.transcript]);

  const styleSeedCss = getStyleSeedVariation(randomStyleSeed);

  // Build display words (with any inline edits applied)
  const displayTranscript: TranscriptWord[] = clip.transcript.map((w, i) =>
    wordEdits[i] ? { ...w, word: wordEdits[i] } : w,
  );

  const progressPct = (activeWordIndex / Math.max(displayTranscript.length - 1, 1)) * 100;

  return (
    <div className="min-h-screen pt-16 flex flex-col">

      {/* ── Clip selector strip ────────────────────────────────────────────── */}
      <div className="border-b border-white/[0.06] bg-slate-950/80 backdrop-blur-sm">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center gap-3 overflow-x-auto no-scrollbar">
          <span className="text-xs text-slate-500 font-medium flex-shrink-0 uppercase tracking-wider">Clips:</span>
          {clips.map((c, i) => (
            <button
              key={c.id}
              onClick={() => onSetClip(i)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition-all duration-200 ${
                i === activeClipIndex
                  ? 'bg-sky-500/20 border border-sky-500/40 text-sky-300'
                  : 'bg-white/[0.04] border border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.07]'
              }`}
            >
              <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                i === activeClipIndex ? 'bg-sky-500 text-white' : 'bg-white/[0.08] text-slate-500'
              }`}>{i + 1}</span>
              <span className="max-w-[140px] truncate">{c.title}</span>
              <span className="text-slate-600 ml-1">{c.duration}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Twin-panel workspace ───────────────────────────────────────────── */}
      <div className="flex-1 max-w-screen-xl mx-auto w-full px-4 py-6 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">

        {/* ══ LEFT PANEL: 9:16 Preview + Preset Cards ══ */}
        <div className="flex flex-col gap-4">

          {/* Phone preview */}
          <div className="flex flex-col items-center">
            <div className="relative w-[220px] flex-shrink-0">
              {/* Phone bezel */}
              <div
                className="relative rounded-[2rem] border-[6px] border-slate-700 bg-black overflow-hidden shadow-2xl shadow-black/60"
                style={{ aspectRatio: '9/16' }}
              >
                {/* Notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-5 bg-slate-700 rounded-b-2xl z-10" />

                {/* Background: trimmed blob video if available, else thumbnail */}
                {clipBlobUrls[clip.id] ? (
                  <video
                    src={clipBlobUrls[clip.id]}
                    className="absolute inset-0 w-full h-full object-cover"
                    autoPlay={isPlaying}
                    loop
                    muted
                    playsInline
                  />
                ) : (
                  <img
                    src={clip.thumbnail}
                    alt={clip.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                {/* Trimming indicator */}
                {trimming && (
                  <div className="absolute top-8 left-0 right-0 flex justify-center z-20">
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/70 text-[9px] text-cyan-300 font-medium">
                      <span className="w-2 h-2 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      Trimming…
                    </span>
                  </div>
                )}
                {/* Scrim */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

                {/* ── Subtitle overlay ── */}
                <div
                  className="absolute bottom-10 left-0 right-0 px-3 text-center"
                  style={styleSeedCss}
                >
                  <SubtitleDisplay
                    words={displayTranscript}
                    activeIdx={activeWordIndex}
                    preset={subtitlePreset}
                  />
                </div>

                {/* Play/pause tap area */}
                <button
                  onClick={() => setIsPlaying(p => !p)}
                  className="absolute inset-0 flex items-center justify-center"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  <div className={`w-12 h-12 rounded-full bg-black/50 flex items-center justify-center transition-opacity duration-200 ${
                    isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'
                  }`}>
                    {isPlaying
                      ? <Pause size={20} className="text-white" />
                      : <Play size={20} className="text-white ml-0.5" />
                    }
                  </div>
                </button>

                {/* Duration badge */}
                <div className="absolute top-7 right-3 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-bold">
                  {clip.duration}
                </div>
              </div>

              {/* Left / right clip nav */}
              <button
                onClick={() => onSetClip(Math.max(0, activeClipIndex - 1))}
                disabled={activeClipIndex === 0}
                className="absolute left-[-36px] top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-800 border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-20 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => onSetClip(Math.min(clips.length - 1, activeClipIndex + 1))}
                disabled={activeClipIndex === clips.length - 1}
                className="absolute right-[-36px] top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-800 border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-20 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Progress bar */}
            <div className="w-[220px] mt-3">
              <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progressPct}%`,
                    background: subtitlePreset === 'hormozi'
                      ? 'linear-gradient(90deg, #FFD700, #AAFF00)'
                      : subtitlePreset === 'cyberpunk'
                      ? 'linear-gradient(90deg, #22D3EE, #06B6D4)'
                      : 'linear-gradient(90deg, #e2e8f0, #94a3b8)',
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                <span>0:00</span>
                <span>{clip.duration}</span>
              </div>
            </div>
          </div>

          {/* ── Preset style cards ── */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <LayoutGrid size={12} className="text-slate-500" />
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Subtitle Style</span>
            </div>
            <div className="space-y-2">
              {(['hormozi', 'minimalist', 'cyberpunk'] as SubtitlePreset[]).map((preset) => {
                const active = subtitlePreset === preset;
                return (
                  <button
                    key={preset}
                    onClick={() => onSetPreset(preset)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 text-left group ${
                      active
                        ? preset === 'hormozi'
                          ? 'border-yellow-400/50 bg-yellow-500/[0.07] shadow-[0_0_14px_rgba(250,204,21,0.12)]'
                          : preset === 'minimalist'
                          ? 'border-white/25 bg-white/[0.05]'
                          : 'border-cyan-400/50 bg-cyan-500/[0.07] shadow-[0_0_14px_rgba(34,211,238,0.12)]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]'
                    }`}
                  >
                    <PresetPreview preset={preset} active={active} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-semibold ${
                        active
                          ? preset === 'hormozi' ? 'text-yellow-300'
                          : preset === 'cyberpunk' ? 'text-cyan-300'
                          : 'text-white'
                          : 'text-white'
                      }`}>
                        {PRESET_LABELS[preset]}
                      </div>
                      <div className="text-slate-500 text-[10px] mt-0.5 leading-tight">{PRESET_DESC[preset]}</div>
                    </div>
                    {active && (
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                        preset === 'hormozi' ? 'bg-yellow-400' :
                        preset === 'cyberpunk' ? 'bg-cyan-400' : 'bg-white'
                      }`}>
                        <Check size={10} className="text-black" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-700 mt-2 text-center">
              Style seed {randomStyleSeed.toFixed(4)} · ±{((1 - randomStyleSeed) * 100).toFixed(1)}% variance per export
            </p>
          </div>
        </div>

        {/* ══ RIGHT PANEL: Transcript + Metadata + Queue ══ */}
        <div className="flex flex-col gap-5 min-h-0">

          {/* ── Interactive transcript timeline ── */}
          <div className="bg-slate-900/50 border border-white/[0.07] rounded-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={14} className="text-slate-400" />
                <span className="text-sm font-semibold text-white">Live Transcript</span>
                <span className="text-[10px] text-slate-600 ml-1">· click word to scrub · double-click to edit</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPlaying(p => !p)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    isPlaying
                      ? 'bg-sky-500/20 text-sky-300'
                      : 'bg-white/[0.06] text-slate-400 hover:text-white'
                  }`}
                >
                  {isPlaying ? <Pause size={11} /> : <Play size={11} />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  onClick={() => copyToClipboard(displayTranscript.map(w => w.word).join(' '), 'transcript')}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                  title="Copy full transcript"
                >
                  {copied === 'transcript'
                    ? <CheckCheck size={11} className="text-cyan-400" />
                    : <Copy size={11} />
                  }
                </button>
              </div>
            </div>

            {/* Word chips — with scrub drag + inline edit */}
            <div
              ref={transcriptRef}
              className="p-4 max-h-44 overflow-y-auto leading-loose text-sm select-none cursor-crosshair"
              onPointerDown={handleTranscriptPointerDown}
              onPointerMove={handleTranscriptPointerMove}
              onPointerUp={handleTranscriptPointerUp}
              onPointerCancel={handleTranscriptPointerUp}
            >
              {displayTranscript.map((w, i) => (
                <TranscriptWordChip
                  key={w.id}
                  word={w.word}
                  idx={i}
                  isActive={i === activeWordIndex}
                  isEditing={editingWordIdx === i}
                  isEdited={i in wordEdits}
                  preset={subtitlePreset}
                  onScrubClick={() => onSetActiveWord(i)}
                  onDoubleClick={() => {
                    setIsPlaying(false);
                    onSetActiveWord(i);
                    setEditingWordIdx(i);
                  }}
                  onCommit={(val) => commitWordEdit(i, val)}
                />
              ))}
            </div>
          </div>

          {/* ── AI Metadata panel ── */}
          <div className="flex-1 bg-slate-900/50 border border-white/[0.07] rounded-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <Wand2 size={14} className="text-sky-400" />
              <span className="text-sm font-semibold text-white">AI-Generated Metadata</span>
              <span className="ml-auto text-[10px] text-slate-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                Auto-generated
              </span>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-5">
              {/* Viral Titles */}
              <div>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Tag size={12} className="text-sky-400" />
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">3 Viral Titles</span>
                </div>
                <div className="space-y-2">
                  {clip.metadata.viralTitles.map((title, i) => (
                    <TitleEditor
                      key={i}
                      title={title}
                      index={i}
                      isEditing={editingTitleIdx === i}
                      onEdit={() => setEditingTitleIdx(i)}
                      onBlur={() => setEditingTitleIdx(null)}
                      onChange={(val) => onUpdateTitle(clip.id, i, val)}
                      onCopy={() => copyToClipboard(title, `title-${i}`)}
                      copied={copied === `title-${i}`}
                    />
                  ))}
                </div>
              </div>

              {/* SEO Description */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <FileText size={12} className="text-cyan-400" />
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">SEO Description</span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(clip.metadata.seoDescription, 'seo')}
                    className="text-slate-500 hover:text-white transition-colors"
                  >
                    {copied === 'seo'
                      ? <CheckCheck size={12} className="text-cyan-400" />
                      : <Copy size={12} />
                    }
                  </button>
                </div>
                <p className="text-slate-300 text-xs leading-relaxed bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
                  {clip.metadata.seoDescription}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {clip.metadata.hashtags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300 font-medium">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Algorithmic tags */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Hash size={12} className="text-cyan-400" />
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Algorithmic Tags</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {clip.metadata.algorithmicTags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-medium">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Publish queue footer ── */}
          <PublishQueueFooter
            clips={clips}
            publishQueue={publishQueue}
            activeClipId={clip.id}
            activeClipTitle={clip.title}
            schedDropOpen={schedDropOpen}
            setSchedDropOpen={setSchedDropOpen}
            schedPlatform={schedPlatform}
            setSchedPlatform={setSchedPlatform}
            schedInterval={schedInterval}
            setSchedInterval={setSchedInterval}
            schedDropRef={schedDropRef}
            queueDrawerOpen={queueDrawerOpen}
            setQueueDrawerOpen={setQueueDrawerOpen}
            onAddToQueue={onAddToQueue}
            onRemoveFromQueue={onRemoveFromQueue}
          />
        </div>
      </div>
    </div>
  );
}

// ─── SubtitleDisplay ─────────────────────────────────────────────────────────
// Renders a sliding 5-word window over the 9:16 preview.
// Memoized — only re-renders when activeIdx or preset changes.

const SubtitleDisplay = memo(function SubtitleDisplay({
  words,
  activeIdx,
  preset,
}: {
  words: { word: string; startMs: number; endMs: number }[];
  activeIdx: number;
  preset: SubtitlePreset;
}) {
  const WINDOW   = 5;
  const start    = Math.max(0, activeIdx - 2);
  const visible  = words.slice(start, start + WINDOW);
  const relActive = activeIdx - start;

  if (preset === 'hormozi') {
    return (
      <div className="flex flex-wrap justify-center gap-x-1 gap-y-0.5">
        {visible.map((w, i) => (
          <span
            key={w.startMs}
            className={i === relActive ? 'hormozi-text-active' : 'hormozi-text'}
            style={{ fontSize: 13 }}
          >
            {w.word}
          </span>
        ))}
      </div>
    );
  }

  if (preset === 'minimalist') {
    return (
      <div className="flex flex-wrap justify-center gap-x-1 gap-y-0.5">
        {visible.map((w, i) => (
          <span
            key={w.startMs}
            className={i === relActive ? 'minimalist-text-active' : 'minimalist-text'}
            style={{ fontSize: 13 }}
          >
            {w.word}
          </span>
        ))}
      </div>
    );
  }

  // Cyberpunk: solid neon-cyan badge on active word, transparent on others
  return (
    <div className="flex flex-wrap justify-center gap-x-1 gap-y-1">
      {visible.map((w, i) => (
        <span
          key={w.startMs}
          className={i === relActive ? 'cyberpunk-badge-active' : 'cyberpunk-badge'}
          style={{ fontSize: 13 }}
        >
          {w.word}
        </span>
      ))}
    </div>
  );
});

// ─── TranscriptWordChip ───────────────────────────────────────────────────────
// Single word chip in the timeline. Supports:
// - click  → scrub to that word (via onScrubClick)
// - double-click → open inline edit input
// - drag (pointer events on parent) → continuous scrub

const TranscriptWordChip = memo(function TranscriptWordChip({
  word, idx, isActive, isEditing, isEdited, preset,
  onScrubClick, onDoubleClick, onCommit,
}: {
  word: string;
  idx: number;
  isActive: boolean;
  isEditing: boolean;
  isEdited: boolean;
  preset: SubtitlePreset;
  onScrubClick: () => void;
  onDoubleClick: () => void;
  onCommit: (val: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(word);

  // Sync draft when word changes from outside (e.g. clip switch)
  useEffect(() => { setDraft(word); }, [word]);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const activeClass =
    preset === 'hormozi'    ? 'chip-hormozi-active' :
    preset === 'minimalist' ? 'chip-minimalist-active' :
                              'chip-cyberpunk-active';

  if (isEditing) {
    return (
      <span className="inline-flex items-center mx-0.5 my-0.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => onCommit(draft)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onCommit(draft); }
            if (e.key === 'Escape') { setDraft(word); onCommit(word); }
          }}
          // Stop pointer events from propagating to the scrub handler
          onPointerDown={e => e.stopPropagation()}
          className="text-xs bg-slate-700 border border-sky-500/60 rounded px-1 py-0.5 text-white outline-none w-[80px] focus:ring-1 focus:ring-sky-500/40"
          style={{ minWidth: `${Math.max(draft.length * 7, 40)}px`, maxWidth: 120 }}
        />
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={() => onCommit(draft)}
          className="ml-1 text-cyan-400 hover:text-cyan-300 flex-shrink-0"
        >
          <Check size={10} strokeWidth={3} />
        </button>
      </span>
    );
  }

  return (
    <span
      data-word-idx={idx}
      onClick={onScrubClick}
      onDoubleClick={onDoubleClick}
      className={`inline mx-0.5 px-0.5 py-0.5 text-sm rounded cursor-pointer transition-all duration-100 ${
        isActive
          ? activeClass
          : isEdited
          ? 'text-amber-300/80 hover:text-amber-200'
          : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {word}{' '}
      {isEdited && !isActive && (
        <Pencil size={8} className="inline text-amber-400/60 mb-0.5" />
      )}
    </span>
  );
});

// ─── TitleEditor ──────────────────────────────────────────────────────────────

function TitleEditor({
  title, index, isEditing, onEdit, onBlur, onChange, onCopy, copied,
}: {
  title: string; index: number; isEditing: boolean;
  onEdit: () => void; onBlur: () => void;
  onChange: (v: string) => void; onCopy: () => void; copied: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  return (
    <div className={`flex items-center gap-2 group p-2.5 rounded-xl border transition-all duration-200 ${
      isEditing
        ? 'border-sky-500/40 bg-sky-500/[0.06]'
        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
    }`}>
      <span className="text-[10px] font-bold text-slate-600 w-4 flex-shrink-0">#{index + 1}</span>
      {isEditing ? (
        <input
          ref={inputRef}
          value={title}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={e => e.key === 'Enter' && onBlur()}
          className="flex-1 bg-transparent text-white text-xs outline-none"
        />
      ) : (
        <span
          onClick={onEdit}
          className="flex-1 text-white text-xs cursor-text leading-snug"
        >
          {title}
        </span>
      )}
      <button
        onClick={onCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-white flex-shrink-0"
      >
        {copied ? <CheckCheck size={12} className="text-cyan-400" /> : <Copy size={12} />}
      </button>
    </div>
  );
}

// ─── PresetPreview ────────────────────────────────────────────────────────────
// Miniature style swatch shown on each preset card

function PresetPreview({ preset, active }: { preset: SubtitlePreset; active: boolean }) {
  if (preset === 'hormozi') {
    return (
      <div className={`w-16 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-black/50' : 'bg-black/30'}`}>
        <span
          className="text-[11px] font-black uppercase"
          style={{
            color: '#AAFF00',
            WebkitTextStroke: '1px #000',
            textShadow: '1px 1px 0 #000',
            letterSpacing: '0.05em',
          }}
        >
          VIRAL
        </span>
      </div>
    );
  }
  if (preset === 'minimalist') {
    return (
      <div className={`w-16 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-white/10' : 'bg-black/30'}`}>
        <span className="text-[11px] font-medium text-white/90 tracking-wide">viral</span>
      </div>
    );
  }
  // Cyberpunk
  return (
    <div className={`w-16 h-9 rounded-lg flex items-center justify-center flex-shrink-0 gap-0.5 ${active ? 'bg-black/50' : 'bg-black/30'}`}>
      {'VIR'.split('').map((ch, i) => (
        <span
          key={i}
          className="text-[11px] font-bold px-0.5 rounded"
          style={{
            background: i === 1 ? '#22D3EE' : 'transparent',
            color: i === 1 ? '#000' : '#22D3EE',
            fontSize: i === 1 ? 12 : 10,
          }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

// ─── PublishQueueFooter ───────────────────────────────────────────────────────

const PLATFORM_OPTIONS: { id: QueuePlatform; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'youtube_shorts',    label: 'YouTube Shorts',    icon: <Youtube size={13} />,   color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  { id: 'instagram_reels',  label: 'Instagram Reels',  icon: <Instagram size={13} />, color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
  { id: 'snapchat_spotlight',label: 'Snapchat Spotlight', icon: <Ghost size={13} />,     color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
];

const INTERVAL_OPTIONS: { value: QueueInterval; label: string }[] = [
  { value: 12, label: 'Every 12 Hours' },
  { value: 24, label: 'Every 24 Hours' },
  { value: 48, label: 'Every 48 Hours' },
];

interface PublishQueueFooterProps {
  clips: { id: string; title: string; duration: string }[];
  publishQueue: QueueEntry[];
  activeClipId: string;
  activeClipTitle: string;
  schedDropOpen: boolean;
  setSchedDropOpen: (v: boolean) => void;
  schedPlatform: QueuePlatform;
  setSchedPlatform: (v: QueuePlatform) => void;
  schedInterval: QueueInterval;
  setSchedInterval: (v: QueueInterval) => void;
  schedDropRef: React.RefObject<HTMLDivElement>;
  queueDrawerOpen: boolean;
  setQueueDrawerOpen: (v: boolean) => void;
  onAddToQueue: (entry: QueueEntry) => void;
  onRemoveFromQueue: (clipId: string) => void;
}

function PublishQueueFooter({
  clips,
  publishQueue,
  activeClipId,
  activeClipTitle,
  schedDropOpen,
  setSchedDropOpen,
  schedPlatform,
  setSchedPlatform,
  schedInterval,
  setSchedInterval,
  schedDropRef,
  queueDrawerOpen,
  setQueueDrawerOpen,
  onAddToQueue,
  onRemoveFromQueue,
}: PublishQueueFooterProps) {
  const isQueued     = publishQueue.some(e => e.clipId === activeClipId);
  const activeEntry  = publishQueue.find(e => e.clipId === activeClipId);
  const queuedCount  = publishQueue.length;
  const platformInfo = PLATFORM_OPTIONS.find(p => p.id === schedPlatform)!;

  function confirmSchedule() {
    // Build staggered schedule from now for all clips based on queue position
    const baseTime     = new Date();
    const queuePos     = publishQueue.length; // index of the new entry
    const scheduledAt  = new Date(baseTime.getTime() + queuePos * schedInterval * 60 * 60 * 1000);

    onAddToQueue({ clipId: activeClipId, platform: schedPlatform, intervalHours: schedInterval, scheduledAt });
    setSchedDropOpen(false);
  }

  const clipIndex = (id: string) => clips.findIndex(c => c.id === id);

  return (
    <div className="bg-slate-900/50 border border-white/[0.07] rounded-2xl overflow-hidden">

      {/* ── Main row ── */}
      <div className="p-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock size={14} className="text-cyan-400" />
            <span className="text-sm font-semibold text-white">One-Click Publishing Queue</span>
            {queuedCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/20">
                {queuedCount} scheduled
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 leading-snug">
            Posts are spaced {schedInterval}h apart to stay under platform spam filters.
          </p>

          {/* Scheduled badge for active clip */}
          {isQueued && activeEntry && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 size={12} className="text-emerald-400" />
              <span className="font-medium">
                Clip #{clipIndex(activeClipId) + 1}: Scheduled for{' '}
                <span className="text-white font-semibold">
                  {formatScheduledTime(new Date(activeEntry.scheduledAt))}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Queue drawer toggle */}
          {queuedCount > 0 && (
            <button
              onClick={() => setQueueDrawerOpen(!queueDrawerOpen)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
                queueDrawerOpen
                  ? 'bg-slate-700/60 border-white/[0.12] text-white'
                  : 'bg-white/[0.04] border-white/[0.07] text-slate-400 hover:text-white hover:bg-white/[0.07]'
              }`}
            >
              <Clock size={12} />
              Active Queue
              <ChevronUp size={11} className={`transition-transform duration-200 ${queueDrawerOpen ? '' : 'rotate-180'}`} />
            </button>
          )}

          {/* Add / remove button with scheduling dropdown */}
          {isQueued ? (
            <button
              onClick={() => onRemoveFromQueue(activeClipId)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-all"
            >
              <Trash2 size={12} />
              Remove
            </button>
          ) : (
            <div className="relative" ref={schedDropRef}>
              <button
                onClick={() => setSchedDropOpen(!schedDropOpen)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 text-xs font-semibold transition-all hover:shadow-[0_0_12px_rgba(6,182,212,0.2)]"
              >
                <Plus size={12} />
                Add to Queue
                <ChevronUp size={11} className={`transition-transform duration-200 ${schedDropOpen ? '' : 'rotate-180'}`} />
              </button>

              {/* Scheduling dropdown */}
              {schedDropOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-72 glass border border-white/[0.1] rounded-xl shadow-2xl shadow-black/60 overflow-hidden z-30">
                  <div className="px-4 pt-3.5 pb-1 border-b border-white/[0.06]">
                    <p className="text-white text-xs font-semibold">Schedule "{activeClipTitle.split(' ').slice(0, 5).join(' ')}…"</p>
                    <p className="text-slate-500 text-[10px] mt-0.5">Select platform and posting interval</p>
                  </div>

                  {/* Platform picker */}
                  <div className="px-4 pt-3 pb-2">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Platform</p>
                    <div className="space-y-1.5">
                      {PLATFORM_OPTIONS.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setSchedPlatform(opt.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                            schedPlatform === opt.id
                              ? opt.color + ' ring-1 ring-inset ring-white/10'
                              : 'text-slate-400 bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.07] hover:text-white'
                          }`}
                        >
                          {opt.icon}
                          {opt.label}
                          {schedPlatform === opt.id && <Check size={11} className="ml-auto" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interval picker */}
                  <div className="px-4 pt-1 pb-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Posting Interval</p>
                    <div className="flex gap-2">
                      {INTERVAL_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setSchedInterval(opt.value)}
                          className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border transition-all ${
                            schedInterval === opt.value
                              ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                              : 'bg-white/[0.03] border-white/[0.06] text-slate-500 hover:text-white hover:bg-white/[0.07]'
                          }`}
                        >
                          {opt.value}h
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1.5 text-center">
                      {INTERVAL_OPTIONS.find(o => o.value === schedInterval)?.label} spacing
                    </p>
                  </div>

                  {/* Confirm */}
                  <div className="px-4 pb-4">
                    <button
                      onClick={confirmSchedule}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-500 text-white text-xs font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 shadow-lg shadow-cyan-900/30"
                    >
                      <CalendarClock size={13} />
                      Confirm Schedule · {platformInfo.label}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Export */}
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600/80 text-white hover:bg-sky-600 text-xs font-semibold transition-all hover:shadow-[0_0_12px_rgba(14,165,233,0.4)] border border-sky-500/40">
            <Send size={12} />
            Export
          </button>
        </div>
      </div>

      {/* ── Active Flow Queue drawer ── */}
      {queueDrawerOpen && queuedCount > 0 && (
        <div className="border-t border-white/[0.06] bg-slate-950/60">
          <div className="px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-xs font-semibold text-slate-300">Active Flow Queue</span>
              <span className="text-[10px] text-slate-600">— {queuedCount} clip{queuedCount > 1 ? 's' : ''} pending</span>
            </div>
            <span className="text-[10px] text-slate-600 italic">{schedInterval}h interval · auto-staggered</span>
          </div>

          <div className="px-4 pb-4 space-y-2">
            {publishQueue.map((entry, qi) => {
              const entryClip  = clips.find(c => c.id === entry.clipId);
              const platform   = PLATFORM_OPTIONS.find(p => p.id === entry.platform);
              const isActive   = entry.clipId === activeClipId;
              const schedDate  = new Date(entry.scheduledAt);

              return (
                <div
                  key={entry.clipId}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-cyan-500/[0.07] border-cyan-500/30'
                      : 'bg-white/[0.02] border-white/[0.06]'
                  }`}
                >
                  {/* Position badge */}
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                    isActive ? 'bg-cyan-500 text-white' : 'bg-white/[0.08] text-slate-500'
                  }`}>
                    {qi + 1}
                  </div>

                  {/* Title */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isActive ? 'text-white' : 'text-slate-300'}`}>
                      {entryClip?.title ?? 'Unknown Clip'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`flex items-center gap-1 text-[10px] ${platform?.color ?? ''}`}>
                        {platform?.icon}
                        {platform?.label}
                      </span>
                      <span className="text-slate-700">·</span>
                      <span className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Clock size={9} />
                        {formatScheduledShort(schedDate)}
                      </span>
                    </div>
                  </div>

                  {/* Full timestamp */}
                  <span className="text-[10px] text-slate-600 hidden sm:block flex-shrink-0 max-w-[120px] text-right leading-tight">
                    {schedDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    <br />
                    {schedDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>

                  {/* Remove */}
                  <button
                    onClick={() => onRemoveFromQueue(entry.clipId)}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                    title="Remove from queue"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
