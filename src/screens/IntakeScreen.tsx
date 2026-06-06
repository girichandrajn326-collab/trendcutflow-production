import { useRef } from 'react';
import { Upload, Link, Youtube, Instagram, Video, Sparkles, AlertCircle, ArrowRight, Zap, Download } from 'lucide-react';
import type { AppState } from '../store/appStore';

interface IntakeScreenProps {
  state: AppState;
  onGenerate: () => void;
  onSetUrl: (url: string) => void;
  onSetDragging: (d: boolean) => void;
  onSetFile: (f: File | null) => void;
  onOpenUpgrade: () => void;
}

type UrlSource = 'youtube' | 'instagram' | null;

function detectUrlSource(url: string): UrlSource {
  if (/youtube\.com|youtu\.be/i.test(url))  return 'youtube';
  if (/instagram\.com/i.test(url))           return 'instagram';
  return null;
}

export default function IntakeScreen({
  state,
  onGenerate,
  onSetUrl,
  onSetDragging,
  onSetFile,
  onOpenUpgrade,
}: IntakeScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { inputUrl, isDragging, uploadedFile, user } = state;

  const creditsUsed  = user.videosProcessed;
  const totalCredits = user.totalCredits;
  const noCredits    = user.credits <= 0;

  const urlSource    = inputUrl ? detectUrlSource(inputUrl) : null;
  // Both YouTube and Instagram are valid inputs (server-side download will handle them)
  const hasUrlInput  = urlSource !== null;
  const hasInput     = !!uploadedFile || hasUrlInput;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    onSetDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) onSetFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onSetFile(file);
  }

  const UrlIcon = urlSource === 'youtube'   ? Youtube
    : urlSource === 'instagram' ? Instagram
    : Link;

  const urlBadgeStyle = urlSource === 'youtube'
    ? 'bg-red-500/20 text-red-400'
    : urlSource === 'instagram'
    ? 'bg-pink-500/20 text-pink-400'
    : '';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 pt-16 pb-12">
      {/* Ambient glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-sky-600/[0.06] rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-2/3 left-1/3 w-[300px] h-[300px] bg-cyan-500/[0.05] rounded-full blur-[80px] pointer-events-none" />

      <div className="relative w-full max-w-2xl">

        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-500/[0.10] border border-sky-500/20 text-sky-300 text-xs font-medium mb-4">
            <Sparkles size={12} />
            AI-Powered Short Video Generator
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight">
            Turn Long Videos Into{' '}
            <span className="bg-gradient-to-r from-sky-400 to-cyan-400 bg-clip-text text-transparent">
              Viral Shorts
            </span>
          </h1>
          <p className="text-slate-400 text-base mt-3 leading-relaxed">
            Drop a raw video or paste a YouTube / Instagram URL. Our AI extracts the 5 most viral 9:16 clips — subtitled, titled, and ready to post.
          </p>
        </div>

        {/* ── Drop Zone ── */}
        <div
          className={`relative rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden group ${
            noCredits
              ? 'border-red-500/20 bg-red-500/[0.02] cursor-not-allowed'
              : isDragging
              ? 'drag-active border-sky-500 cursor-copy'
              : uploadedFile
              ? 'border-cyan-500/60 bg-cyan-500/[0.05] cursor-pointer'
              : 'border-white/[0.12] hover:border-sky-500/50 bg-white/[0.02] hover:bg-sky-500/[0.03] cursor-pointer'
          }`}
          onDragOver={(e) => { if (!noCredits) { e.preventDefault(); onSetDragging(true); } }}
          onDragLeave={() => onSetDragging(false)}
          onDrop={noCredits ? undefined : handleDrop}
          onClick={() => !noCredits && !uploadedFile && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileChange}
            disabled={noCredits}
          />
          <div className="px-8 py-12 flex flex-col items-center text-center">
            {noCredits ? (
              <div className="flex flex-col items-center gap-3 opacity-40 select-none">
                <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <Upload size={22} className="text-red-400/50" />
                </div>
                <p className="text-slate-500 text-sm">Upload disabled — no credits remaining</p>
              </div>
            ) : uploadedFile ? (
              <>
                <div className="w-14 h-14 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mb-4">
                  <Video size={24} className="text-cyan-400" />
                </div>
                <p className="text-white font-semibold text-base">{uploadedFile.name}</p>
                <p className="text-slate-400 text-sm mt-1">
                  {(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB
                </p>
                <button
                  onClick={(e) => { e.stopPropagation(); onSetFile(null); }}
                  className="mt-3 text-xs text-slate-500 hover:text-red-400 underline underline-offset-2 transition-colors"
                >
                  Remove file
                </button>
              </>
            ) : (
              <>
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 ${
                  isDragging
                    ? 'bg-sky-500/30 border border-sky-500/50 shadow-[0_0_20px_rgba(14,165,233,0.3)]'
                    : 'bg-white/[0.05] border border-white/[0.1] group-hover:bg-sky-500/10 group-hover:border-sky-500/30'
                }`}>
                  <Upload size={22} className={isDragging ? 'text-sky-300' : 'text-slate-400 group-hover:text-sky-400'} />
                </div>
                <p className="text-white font-semibold text-base">
                  {isDragging ? 'Drop it here' : 'Drag & drop your video'}
                </p>
                <p className="text-slate-500 text-sm mt-1">MP4, MOV, WebM — max 10 minutes</p>
                <span className="mt-3 text-xs text-sky-400/70 font-medium">or click to browse</span>
              </>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-white/[0.06]" />
          <span className="text-slate-600 text-xs font-medium">OR PASTE A LINK</span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>

        {/* URL Input */}
        <div className="relative">
          <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
            urlSource ? 'text-cyan-400' : 'text-slate-500'
          }`}>
            <UrlIcon size={16} />
          </div>
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => onSetUrl(e.target.value)}
            placeholder="Paste YouTube or Instagram URL..."
            disabled={noCredits}
            className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-slate-800/60 border border-white/[0.08] focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/20 text-white placeholder-slate-500 text-sm transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          {urlSource && !noCredits && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${urlBadgeStyle}`}>
                {urlSource}
              </span>
            </div>
          )}
        </div>

        {/* URL processing info — shown when YouTube or Instagram URL is pasted */}
        {hasUrlInput && !noCredits && (
          <div className="mt-3 flex items-start gap-3 p-3.5 rounded-xl bg-sky-500/[0.07] border border-sky-500/20">
            <Download size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sky-200 text-xs font-semibold">
                {urlSource === 'youtube' ? 'YouTube' : 'Instagram'} URL detected — server-side download ready
              </p>
              <p className="text-sky-400/70 text-[11px] mt-0.5 leading-snug">
                Click "Generate Viral Shorts" to start. The video will be downloaded securely on our servers, then processed through the AI pipeline.
              </p>
            </div>
          </div>
        )}

        {/* Supported platforms note */}
        {!hasUrlInput && (
          <div className="flex items-center justify-center gap-5 mt-3 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <Youtube size={12} className="text-red-500/60" /> YouTube
            </span>
            <span className="flex items-center gap-1.5">
              <Instagram size={12} className="text-pink-500/60" /> Instagram
            </span>
            <span className="text-slate-700">— or upload an MP4/MOV directly</span>
          </div>
        )}

        {/* Credit limit warning banner */}
        {noCredits && (
          <div className="mt-5 flex items-start gap-4 p-4 rounded-xl bg-red-500/[0.07] border border-red-500/25 shadow-[0_0_20px_rgba(239,68,68,0.08)]">
            <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
              <AlertCircle size={18} className="text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-red-200 text-sm font-semibold leading-tight">
                Credit limit reached — {creditsUsed}/{totalCredits} videos used
              </p>
              <p className="text-red-400/70 text-xs mt-1 leading-snug">
                You've used all {totalCredits} processing credit{totalCredits > 1 ? 's' : ''} on your current plan.
                Upgrade to unlock more videos and remove the watermark.
              </p>
              <button
                onClick={onOpenUpgrade}
                className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 px-3 py-1.5 rounded-lg transition-all"
              >
                <Zap size={11} />
                View upgrade options
              </button>
            </div>
          </div>
        )}

        {/* Primary CTA */}
        {noCredits ? (
          <button
            onClick={onOpenUpgrade}
            className="relative w-full mt-5 py-4 rounded-xl text-base font-bold transition-all duration-300 flex items-center justify-center gap-2 overflow-hidden group bg-gradient-to-r from-sky-600 to-cyan-500 text-white hover:from-sky-500 hover:to-cyan-400 shadow-lg shadow-sky-900/30"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            <Zap size={18} />
            Upgrade to Process More Videos
            <ArrowRight size={16} />
          </button>
        ) : (
          <button
            onClick={onGenerate}
            disabled={!hasInput}
            className={`relative w-full mt-5 py-4 rounded-xl text-base font-bold transition-all duration-300 flex items-center justify-center gap-2 overflow-hidden group ${
              hasInput
                ? 'bg-gradient-to-r from-sky-600 to-cyan-500 text-white hover:from-sky-500 hover:to-cyan-400 shadow-lg shadow-sky-900/20 cursor-pointer'
                : 'bg-white/[0.04] text-slate-600 cursor-not-allowed border border-white/[0.06]'
            }`}
          >
            {hasInput && (
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            )}
            <Sparkles size={18} className={hasInput ? 'text-white' : 'text-slate-600'} />
            Generate Viral Shorts
            {hasInput && <ArrowRight size={16} />}
          </button>
        )}

        {hasInput && !noCredits && (
          <p className="text-center text-xs text-slate-600 mt-2">
            {hasUrlInput ? 'Server-side download + AI processing' : 'Browser-side processing · No upload needed'} · 5 viral clips
            <span className="ml-2 text-sky-600 font-medium">
              {creditsUsed}/{totalCredits} credits used
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
