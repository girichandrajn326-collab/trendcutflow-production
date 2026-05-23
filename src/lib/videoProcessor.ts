// Browser-side video trimmer using FFmpeg.wasm loaded dynamically from CDN.
// SharedArrayBuffer (required by FFmpeg.wasm threads) is unlocked by the
// Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers set in
// vite.config.ts.

const CDN_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

// Singleton: one FFmpeg instance shared across all trim calls.
let _ffmpeg: FFmpegInstance | null = null;
let _loading: Promise<FFmpegInstance> | null = null;

// Lightweight type stubs for the dynamically-loaded module so we stay
// type-safe without adding @ffmpeg/ffmpeg to package.json.
interface FFmpegInstance {
  loaded: boolean;
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  writeFile: (name: string, data: Uint8Array) => Promise<void>;
  readFile: (name: string) => Promise<Uint8Array>;
  deleteFile: (name: string) => Promise<void>;
  exec: (args: string[]) => Promise<number>;
  on: (event: string, cb: (e: unknown) => void) => void;
}

async function getFFmpeg(): Promise<FFmpegInstance> {
  if (_ffmpeg?.loaded) return _ffmpeg;
  if (_loading) return _loading;

  _loading = (async () => {
    // Dynamic CDN import — avoids bundling the heavy WASM binary.
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

  return _loading;
}

/**
 * Trim a video file client-side using FFmpeg.wasm.
 *
 * Uses stream-copy (`-c copy`) so no re-encoding happens — typically
 * completes in under a second for short clips.
 *
 * @param videoFile  The raw File object from the file picker or drag-drop.
 * @param startTime  Trim start in seconds.
 * @param endTime    Trim end in seconds.
 * @returns          A blob: URL pointing to the trimmed MP4. Caller is
 *                   responsible for revoking it via URL.revokeObjectURL().
 */
export async function trimVideoClip(
  videoFile: File,
  startTime: number,
  endTime: number,
): Promise<string> {
  const ffmpeg = await getFFmpeg();

  const inputName  = `input_${Date.now()}.mp4`;
  const outputName = `output_${Date.now()}.mp4`;

  try {
    // Write the raw file bytes into FFmpeg's in-memory virtual FS.
    const fileBytes = new Uint8Array(await videoFile.arrayBuffer());
    await ffmpeg.writeFile(inputName, fileBytes);

    // Fast seek + copy — no re-encode, no quality loss.
    await ffmpeg.exec([
      '-ss', String(startTime),
      '-to', String(endTime),
      '-i', inputName,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outputName,
    ]);

    // Read the trimmed clip back out of the virtual FS.
    const outputBytes = await ffmpeg.readFile(outputName);
    const blob = new Blob([outputBytes.buffer], { type: 'video/mp4' });
    return URL.createObjectURL(blob);
  } finally {
    // Clean up virtual FS entries to free in-browser memory.
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
