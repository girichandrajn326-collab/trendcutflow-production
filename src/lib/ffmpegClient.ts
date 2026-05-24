// FFmpeg.wasm client — browser-side video slicing and subtitle burning.
// Requires SharedArrayBuffer (COOP/COEP headers). Falls back gracefully when unavailable.

export interface SliceOptions {
  startTime: number;
  endTime: number;
  outputFormat: 'mp4' | 'webm';
  targetAspectRatio: '9:16' | '16:9' | '1:1';
}

export interface SubtitleBurnOptions {
  words: Array<{ word: string; startMs: number; endMs: number }>;
  style: 'hormozi' | 'minimalist' | 'cyberpunk';
  styleSeed: number;
}

export interface FFmpegProgress {
  ratio: number;
  time: number;
  speed: string;
}

interface FFmpegInstance {
  loaded: boolean;
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  writeFile: (name: string, data: Uint8Array | string) => Promise<void>;
  readFile: (name: string) => Promise<Uint8Array>;
  deleteFile: (name: string) => Promise<void>;
  exec: (args: string[]) => Promise<number>;
  on: (event: string, cb: (e: unknown) => void) => void;
}

const CDN_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

let _ffmpeg: FFmpegInstance | null = null;
let _loading: Promise<FFmpegInstance> | null = null;
let _unavailable = false;

async function getFFmpeg(): Promise<FFmpegInstance> {
  if (_unavailable) throw new Error('FFmpeg.wasm unavailable');
  if (_ffmpeg?.loaded) return _ffmpeg;
  if (_loading) return _loading;

  _loading = (async () => {
    if (!crossOriginIsolated) {
      _unavailable = true;
      throw new Error('SharedArrayBuffer requires cross-origin isolation headers.');
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

export async function initFFmpeg(): Promise<boolean> {
  try {
    await getFFmpeg();
    return true;
  } catch {
    return false;
  }
}

export async function sliceVideoToShort(
  inputFile: File,
  options: SliceOptions,
  onProgress?: (progress: FFmpegProgress) => void,
): Promise<Blob | null> {
  try {
    const ffmpeg = await getFFmpeg();

    if (onProgress) {
      ffmpeg.on('progress', (e: unknown) => {
        const p = e as { progress?: number; time?: number };
        onProgress({
          ratio: p.progress ?? 0,
          time: p.time ?? 0,
          speed: '2.0x',
        });
      });
    }

    const id = Date.now();
    const inputName = `input_${id}.mp4`;
    const outputName = `output_${id}.mp4`;

    const cropFilter =
      options.targetAspectRatio === '9:16'
        ? 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920'
        : options.targetAspectRatio === '1:1'
        ? 'crop=ih:ih:(iw-ih)/2:0,scale=1080:1080'
        : 'scale=1920:1080';

    await ffmpeg.writeFile(inputName, new Uint8Array(await inputFile.arrayBuffer()));
    await ffmpeg.exec([
      '-ss', String(options.startTime),
      '-to', String(options.endTime),
      '-i', inputName,
      '-vf', cropFilter,
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputName,
    ]);

    const outBytes = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});

    return new Blob([outBytes.buffer], { type: 'video/mp4' });
  } catch {
    return null;
  }
}

// Build a WebVTT subtitle string from word-level timestamps
function buildWebVTT(
  words: SubtitleBurnOptions['words'],
  style: SubtitleBurnOptions['style'],
  styleSeed: number,
): string {
  const styleVariant = (1 + (styleSeed - 1) * 0.02).toFixed(3);

  const styleMap: Record<string, string> = {
    hormozi: `STYLE\n::cue { font-family: Impact, sans-serif; font-size: ${parseFloat(styleVariant) * 100}%; text-transform: uppercase; color: #ffffff; -webkit-text-stroke: 2px #000; letter-spacing: ${(styleSeed - 1) * 0.02}em; }`,
    minimalist: `STYLE\n::cue { font-family: Arial, sans-serif; font-size: ${parseFloat(styleVariant) * 90}%; color: #ffffff; opacity: 0.95; }`,
    cyberpunk: `STYLE\n::cue { font-family: monospace; font-size: ${parseFloat(styleVariant) * 95}%; color: #00e5ff; text-shadow: 0 0 8px #00e5ff; }`,
  };

  function ms(n: number) {
    const h = Math.floor(n / 3600000);
    const m = Math.floor((n % 3600000) / 60000);
    const s = Math.floor((n % 60000) / 1000);
    const ms = n % 1000;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
  }

  // Group into 3-word cues
  const cues: string[] = [];
  for (let i = 0; i < words.length; i += 3) {
    const group = words.slice(i, i + 3);
    const start = group[0].startMs;
    const end = group[group.length - 1].endMs;
    const text = group.map(w => w.word).join(' ');
    cues.push(`${ms(start)} --> ${ms(end)}\n${text}`);
  }

  return `WEBVTT\n\n${styleMap[style]}\n\n${cues.join('\n\n')}`;
}

export async function burnSubtitles(
  inputBlob: Blob,
  options: SubtitleBurnOptions,
): Promise<Blob | null> {
  try {
    const ffmpeg = await getFFmpeg();

    const id = Date.now();
    const inputName = `burn_in_${id}.mp4`;
    const subName = `subs_${id}.vtt`;
    const outputName = `burned_${id}.mp4`;

    const vtt = buildWebVTT(options.words, options.style, options.styleSeed);

    await ffmpeg.writeFile(inputName, new Uint8Array(await inputBlob.arrayBuffer()));
    await ffmpeg.writeFile(subName, vtt);

    await ffmpeg.exec([
      '-i', inputName,
      '-vf', `subtitles=${subName}`,
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'fast',
      '-c:a', 'copy',
      outputName,
    ]);

    const outBytes = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(subName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});

    return new Blob([outBytes.buffer], { type: 'video/mp4' });
  } catch {
    return null;
  }
}

export async function purgeRawVideoFromStorage(fileId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileId, { recursive: true }).catch(() => {});
  } catch { /* OPFS unavailable */ }
}

import type { CSSProperties } from 'react';

export function getStyleSeedVariation(seed: number): CSSProperties {
  return {
    letterSpacing: `${(seed - 1) * 2}em`,
    fontSize: `${seed * 100}%`,
  };
}

export type { CSSProperties };
