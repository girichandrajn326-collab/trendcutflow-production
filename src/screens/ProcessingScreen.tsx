import { AlertCircle, ArrowLeft, Upload, Server, Sparkles } from 'lucide-react';
import type { PipelineStep } from '../store/appStore';

interface ProcessingScreenProps {
  pipeline: PipelineStep[];
  pipelineError: string | null;
  onGoBack?: () => void;
  onViewClips?: () => void;
}

export default function ProcessingScreen({ pipeline, pipelineError, onGoBack, onViewClips }: ProcessingScreenProps) {
  const allDone     = pipeline.every(s => s.status === 'done' || s.status === 'skipped');
  const doneCount   = pipeline.filter(s => s.status === 'done' || s.status === 'skipped').length;
  const progressPct = Math.round((doneCount / pipeline.length) * 100);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 pt-16 pb-12">
      {/* Ambient */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-sky-600/[0.06] rounded-full blur-[120px] pointer-events-none" />

      <div className="relative w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium mb-4 transition-all duration-500 ${
            pipelineError
              ? 'bg-red-500/[0.12] border-red-500/20 text-red-300'
              : allDone
              ? 'bg-cyan-500/[0.12] border-cyan-500/20 text-cyan-300'
              : 'bg-sky-500/[0.12] border-sky-500/20 text-sky-300 animate-pulse'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              pipelineError ? 'bg-red-400' : allDone ? 'bg-cyan-400' : 'bg-sky-400 animate-ping'
            }`} />
            {pipelineError ? 'Processing Failed' : allDone ? 'Clips Ready' : 'AI Processing Your Video'}
          </div>
          <h2 className="text-3xl font-bold text-white">
            {pipelineError ? 'Something Went Wrong' : allDone ? 'Your Clips Are Ready' : 'Extracting Viral Moments'}
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            {pipelineError
              ? pipelineError
              : allDone
              ? 'All processing complete — your viral shorts are waiting in the editor'
              : 'Processing on our servers — you can safely keep this tab open'}
          </p>
        </div>

        {/* Error banner */}
        {pipelineError && (
          <div className="mb-6 space-y-3">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/[0.08] border border-red-500/20">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm leading-relaxed">{pipelineError}</p>
            </div>
            {onGoBack && (
              <div className="flex gap-3">
                <button
                  onClick={onGoBack}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-slate-300 hover:text-white text-sm font-medium transition-colors"
                >
                  <ArrowLeft size={14} />
                  Go Back
                </button>
                <button
                  onClick={onGoBack}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600/80 text-white hover:bg-sky-600 text-sm font-semibold transition-colors"
                >
                  <Upload size={14} />
                  Upload a File Instead
                </button>
              </div>
            )}
          </div>
        )}

        {/* Pipeline steps */}
        <div className="bg-slate-900/60 border border-white/[0.07] rounded-2xl p-5 mb-6">

          {/* Overall progress bar */}
          {!pipelineError && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Server size={11} />
                  <span>Server-side processing</span>
                </div>
                <span className="text-xs font-medium text-slate-400">{progressPct}%</span>
              </div>
              <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    allDone
                      ? 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                      : 'bg-gradient-to-r from-sky-500 to-cyan-400'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          <div className="space-y-3">
            {pipeline.map((step) => {
              const isDone    = step.status === 'done';
              const isActive  = step.status === 'active';
              const isError   = step.status === 'error';
              const isSkipped = step.status === 'skipped';

              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-500 ${
                    isError   ? 'bg-red-500/[0.08] border border-red-500/20' :
                    isActive  ? 'bg-sky-500/[0.08] border border-sky-500/20' :
                    isSkipped ? 'bg-amber-500/[0.05] border border-amber-500/15 opacity-60' :
                    isDone    ? 'opacity-50' :
                    'opacity-20'
                  }`}
                >
                  {/* Step icon */}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                    isError   ? 'bg-red-500/20 border border-red-500/30' :
                    isSkipped ? 'bg-amber-500/10 border border-amber-500/20' :
                    isDone    ? 'bg-cyan-500/20 border border-cyan-500/30' :
                    isActive  ? 'bg-sky-500/20 border border-sky-500/30' :
                    'bg-white/[0.04] border border-white/[0.08]'
                  }`}>
                    {isDone    ? <CheckIcon /> :
                     isError   ? <XIcon /> :
                     isSkipped ? <SkipIcon /> :
                     <StepDot active={isActive} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">{step.label}</div>
                    {(isActive || isError || isSkipped || (isDone && step.detail)) && (
                      <div className={`text-xs mt-0.5 ${
                        isError ? 'text-red-400' : isSkipped ? 'text-amber-400/80' : 'text-slate-400'
                      }`}>
                        {step.detail}
                      </div>
                    )}
                  </div>

                  {isActive && (
                    <div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  )}
                  {isSkipped && (
                    <span className="text-[10px] font-semibold text-amber-500/70 uppercase tracking-wide flex-shrink-0">
                      Skipped
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Completion CTA or skeleton preview cards */}
        {allDone && !pipelineError ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20">
              <Sparkles size={16} className="text-emerald-400 flex-shrink-0" />
              <p className="text-emerald-300 text-sm font-medium">
                All 5 viral clips have been extracted and are ready to edit.
              </p>
            </div>
            {onViewClips && (
              <button
                onClick={onViewClips}
                className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-sky-500 to-cyan-500 text-white hover:from-sky-400 hover:to-cyan-400 transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20"
              >
                <Sparkles size={16} />
                Open Clip Editor
              </button>
            )}
          </div>
        ) : !pipelineError ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-600 font-medium uppercase tracking-wider mb-2">
              Extracting 5 Viral Clips
            </p>
            {[0, 1, 2, 3, 4].map(i => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 16 16" fill="currentColor">
      <path d="M13.5 2.5L6 10 2.5 6.5l-1 1L6 12l8.5-8.5z" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg className="w-4 h-4 text-amber-400/80" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 3.5l5 4.5-5 4.5V3.5zM9.5 3.5l5 4.5-5 4.5V3.5z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4 text-red-400" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function StepDot({ active }: { active: boolean }) {
  return (
    <span className={`w-2 h-2 rounded-full ${active ? 'bg-sky-400' : 'bg-slate-600'}`} />
  );
}

function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="flex items-center gap-4 p-4 rounded-xl border border-white/[0.07] bg-slate-900/40 overflow-hidden"
      style={{ animationDelay: `${index * 150}ms` }}
    >
      <div
        className="w-10 h-16 rounded-lg flex-shrink-0 skeleton-shimmer"
        style={{ animationDelay: `${index * 200}ms` }}
      />
      <div className="flex-1 space-y-2.5">
        <div
          className="h-3 rounded-full skeleton-shimmer"
          style={{ width: `${60 + index * 8}%`, animationDelay: `${index * 100}ms` }}
        />
        <div
          className="h-2.5 rounded-full skeleton-shimmer opacity-60"
          style={{ width: `${40 + index * 5}%`, animationDelay: `${index * 150}ms` }}
        />
        <div className="flex gap-2">
          {[1, 2, 3].map(t => (
            <div
              key={t}
              className="h-5 w-14 rounded-full skeleton-shimmer opacity-40"
              style={{ animationDelay: `${index * 100 + t * 80}ms` }}
            />
          ))}
        </div>
      </div>
      <div className="w-10 h-5 rounded-full skeleton-shimmer flex-shrink-0 opacity-50" />
    </div>
  );
}
