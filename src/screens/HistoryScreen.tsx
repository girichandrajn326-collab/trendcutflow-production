import { useEffect, useState } from 'react';
import { Clock, Film, Loader2, ExternalLink, CalendarClock, Inbox } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { UserAccount } from '../store/appStore';

interface HistoryClip {
  id: string;
  ai_title: string;
  ai_description: string;
  start_time: number;
  end_time: number;
  source_video_url: string;
  clip_storage_url: string;
  is_queued: boolean;
  created_at?: string;
  metadata_json?: {
    viralTitles?: string[];
    hashtags?: string[];
  };
  video_sources?: {
    title: string;
    source_url: string;
    created_at?: string;
  } | null;
}

interface HistoryScreenProps {
  user: UserAccount;
}

export default function HistoryScreen({ user }: HistoryScreenProps) {
  const [clips, setClips] = useState<HistoryClip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user.id) return;
    setLoading(true);
    supabase
      .from('repurposed_clips')
      .select('*, video_sources!inner(title, source_url, user_id, created_at)')
      .eq('video_sources.user_id', user.id)
      .order('video_sources.created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setClips(data as HistoryClip[]);
        setLoading(false);
      });
  }, [user.id]);

  function fmtDuration(start: number, end: number) {
    const s = Math.round(end - start);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function fmtDate(iso?: string) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <div className="min-h-screen pt-24 pb-12 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
            <Clock size={18} className="text-sky-400" />
          </div>
          <div>
            <h1 className="text-white text-xl font-bold">Processing History</h1>
            <p className="text-slate-500 text-xs mt-0.5">All viral clips generated from your videos</p>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-sky-500/60" />
          </div>
        )}

        {/* Empty state */}
        {!loading && clips.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center mb-5">
              <Inbox size={28} className="text-slate-600" />
            </div>
            <p className="text-slate-400 text-base font-semibold">No clips yet</p>
            <p className="text-slate-600 text-sm mt-1">Process a video to see your clips here.</p>
          </div>
        )}

        {/* Clip grid */}
        {!loading && clips.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clips.map(clip => (
              <div
                key={clip.id}
                className="group bg-slate-900/60 border border-white/[0.07] rounded-2xl overflow-hidden hover:border-sky-500/30 transition-all duration-200 hover:shadow-[0_0_20px_rgba(14,165,233,0.06)]"
              >
                {/* Thumbnail / placeholder */}
                <div className="relative w-full aspect-[9/16] max-h-48 bg-slate-800/80 overflow-hidden flex items-center justify-center">
                  {clip.clip_storage_url && !clip.clip_storage_url.startsWith('https://images.pexels.com') ? (
                    <video
                      src={clip.clip_storage_url}
                      className="w-full h-full object-cover"
                      muted
                      preload="metadata"
                    />
                  ) : clip.clip_storage_url ? (
                    <img
                      src={clip.clip_storage_url}
                      alt={clip.ai_title}
                      className="w-full h-full object-cover opacity-60"
                    />
                  ) : (
                    <Film size={32} className="text-slate-700" />
                  )}
                  {/* Duration badge */}
                  <span className="absolute bottom-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-black/70 text-white">
                    {fmtDuration(clip.start_time, clip.end_time)}
                  </span>
                  {clip.is_queued && (
                    <span className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-sky-500/80 text-white">
                      <CalendarClock size={9} /> Queued
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-3.5">
                  <p className="text-white text-sm font-semibold leading-tight line-clamp-2">
                    {clip.ai_title || 'Untitled Clip'}
                  </p>

                  {clip.video_sources?.title && (
                    <p className="text-slate-600 text-[11px] mt-1 flex items-center gap-1 truncate">
                      <Film size={10} className="flex-shrink-0" />
                      {clip.video_sources.title}
                    </p>
                  )}

                  <p className="text-slate-600 text-[11px] mt-0.5">
                    {fmtDate(clip.video_sources?.created_at)}
                  </p>

                  {/* Hashtags preview */}
                  {clip.metadata_json?.hashtags && clip.metadata_json.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {clip.metadata_json.hashtags.slice(0, 3).map(tag => (
                        <span key={tag} className="text-[10px] text-sky-400/70 bg-sky-500/[0.07] border border-sky-500/15 px-1.5 py-0.5 rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Source link */}
                  {(clip.source_video_url || clip.video_sources?.source_url) && (
                    <a
                      href={clip.source_video_url || clip.video_sources?.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-400 transition-colors"
                    >
                      <ExternalLink size={10} />
                      View source
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
