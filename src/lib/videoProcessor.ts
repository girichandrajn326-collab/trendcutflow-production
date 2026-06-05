// Browser-side video trimmer using the MediaRecorder / Web API approach when
// FFmpeg.wasm is unavailable (i.e. no SharedArrayBuffer / COEP headers).
//
// Strategy:
//   1. Try FFmpeg.wasm (fast, lossless stream-copy with 9:16 crop).
//   2. Fall back to an HTMLVideoElement + MediaRecorder trim when FFmpeg fails.
//   3. If both fail, throw so the caller can show a fallback thumbnail.
//   4. Every render outcome (success/error + error_code) is logged to the
//      processing_logs table via the process-video?action=render-log endpoint.

import { supabase } from './supabase';

const CDN_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

async function logRenderOutcome(
  status: 'success' | 'error',
  opts?: { errorCode?: string; message?: string; durationMs?: number },
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    await fetch(`${supabaseUrl}/functions/v1/process-video?action=render-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ status, ...opts }),
    });
  } catch {
    // Non-fatal — observability only
  }
}

interface FFmpegInstance {
  loaded: boolean;
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  writeFile: (name: string, data: Uint8Array) => Promise<void>;
  readFile: (name: string) => Promise<Uint8Array>;
  deleteFile: (name: string) => Promise<void>;
  exec: (args: string[]) => Promise<number>;
  on: (event: string, cb: (e: unknown) => void) => void;
}

let _ffmpeg: FFmpegInstance | null = null;
let _loading: Promise<FFmpegInstance> | null = null;
let _ffmpegUnavailable = false;

async function getFFmpeg(): Promise<FFmpegInstance> {
  if (_ffmpegUnavailable) throw new Error('FFmpeg.wasm unavailable');
  if (_ffmpeg?.loaded) return _ffmpeg;
  if (_loading) return _loading;

  _loading = (async () => {
    if (!crossOriginIsolated) {
      _ffmpegUnavailable = true;
      throw new Error('SharedArrayBuffer requires cross-origin isolation (COOP/COEP headers).');
    }

    const { FFmpeg } = await import(
      /* @vite-ignore */
      'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js'
    );

    const instance: FFmpegInstance = new FFmpeg();
    await instance.load({
      coreURL: `${CDN_BASE}/ffmpeg-core.js`,
      wasmURL: `${CDN_BASE}/ffmpeg-core.wasm`,
    });

    _ffmpeg = instance;
    return instance;
  })();

  _loading.catch(() => { _loading = null; });
  return _loading;
}

// Fallback: use HTMLVideoElement + MediaRecorder to record a segment.
// Less precise (keyframe-aligned) but works without COEP headers.
async function trimWithMediaRecorder(
  videoFile: File,
  startTime: number,
  endTime: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;

    const chunks: BlobPart[] = [];
    let recorder: MediaRecorder | null = null;

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = startTime;
    });

    video.addEventListener('seeked', () => {
      if (recorder) return; // already started

      try {
        const stream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
        if (!stream) {
          URL.revokeObjectURL(video.src);
          reject(new Error('captureStream not supported'));
          return;
        }

        recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          URL.revokeObjectURL(video.src);
          const blob = new Blob(chunks, { type: 'video/webm' });
          resolve(URL.createObjectURL(blob));
        };
        recorder.start();
        video.play();

        const duration = (endTime - startTime) * 1000;
        setTimeout(() => {
          video.pause();
          recorder?.stop();
        }, duration);
      } catch (err) {
        URL.revokeObjectURL(video.src);
        reject(err);
      }
    }, { once: true });

    video.addEventListener('error', () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Video load error'));
    });
  });
}

/**
 * Trim a video file client-side with 9:16 vertical crop.
 * Tries FFmpeg.wasm first; falls back to MediaRecorder on unsupported environments.
 * Render outcomes (including specific FFmpeg error codes) are logged server-side.
 */
export async function trimVideoClip(
  videoFile: File,
  startTime: number,
  endTime: number,
): Promise<string> {
  const renderStart = Date.now();

  // Try FFmpeg.wasm path
  try {
    const ffmpeg = await getFFmpeg();

    const inputName  = `input_${Date.now()}.mp4`;
    const outputName = `output_${Date.now()}.mp4`;

    try {
      const fileBytes = new Uint8Array(await videoFile.arrayBuffer());
      await ffmpeg.writeFile(inputName, fileBytes);

      // 9:16 vertical crop: scale to height 1920, crop width to 1080
      const exitCode = await ffmpeg.exec([
        '-ss', String(startTime),
        '-to', String(endTime),
        '-i', inputName,
        '-vf', "scale=-2:1920,crop=1080:1920:(iw-1080)/2:0",
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-avoid_negative_ts', 'make_zero',
        '-preset', 'ultrafast',
        outputName,
      ]);

      if (exitCode !== 0) {
        await logRenderOutcome('error', {
          errorCode: `FFMPEG_EXIT_${exitCode}`,
          message: `FFmpeg exited with code ${exitCode}`,
          durationMs: Date.now() - renderStart,
        });
        throw new Error(`FFmpeg exited with code ${exitCode}`);
      }

      const outputBytes = await ffmpeg.readFile(outputName);
      const blob = new Blob([outputBytes.buffer], { type: 'video/mp4' });
      await logRenderOutcome('success', { durationMs: Date.now() - renderStart });
      return URL.createObjectURL(blob);
    } finally {
      await ffmpeg.deleteFile(inputName).catch(() => {});
      await ffmpeg.deleteFile(outputName).catch(() => {});
    }
  } catch (ffmpegErr) {
    // Log non-exit-code FFmpeg errors (load failure, OOM, etc.)
    if (!(ffmpegErr instanceof Error && ffmpegErr.message.includes('exited'))) {
      const code = ffmpegErr instanceof Error ? ffmpegErr.name : 'FFMPEG_UNKNOWN';
      await logRenderOutcome('error', {
        errorCode: code,
        message: ffmpegErr instanceof Error ? ffmpegErr.message : String(ffmpegErr),
        durationMs: Date.now() - renderStart,
      }).catch(() => {});
    }
    // Fall back to MediaRecorder
  }

  try {
    const result = await trimWithMediaRecorder(videoFile, startTime, endTime);
    await logRenderOutcome('success', { message: 'MediaRecorder fallback', durationMs: Date.now() - renderStart });
    return result;
  } catch (recorderErr) {
    await logRenderOutcome('error', {
      errorCode: 'MEDIARECORDER_FAILED',
      message: recorderErr instanceof Error ? recorderErr.message : String(recorderErr),
      durationMs: Date.now() - renderStart,
    }).catch(() => {});
    throw recorderErr;
  }
}
