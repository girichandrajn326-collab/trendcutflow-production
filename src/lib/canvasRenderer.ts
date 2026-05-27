// Canvas-based video renderer — trims a clip to 9:16, burns subtitles, and
// records via MediaRecorder. Works in any browser without FFmpeg/COEP headers.

export interface RenderOptions {
  startTime: number;
  endTime: number;
  words: Array<{ word: string; startMs: number; endMs: number }>;
  style: 'hormozi' | 'minimalist' | 'cyberpunk';
  styleSeed: number;
}

const OUTPUT_W = 720;
const OUTPUT_H = 1280; // 9:16

export function renderClipWithSubtitles(
  videoFile: File,
  options: RenderOptions,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const { startTime, endTime, words, style, styleSeed } = options;
    const duration = endTime - startTime;

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const canvas = document.createElement('canvas');
    canvas.width  = OUTPUT_W;
    canvas.height = OUTPUT_H;
    const ctx = canvas.getContext('2d')!;

    // Prefer VP9 for better quality; fall back to VP8
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm;codecs=vp8';

    let recorder: MediaRecorder;
    const chunks: BlobPart[] = [];
    let rafId = 0;

    function cleanup() {
      cancelAnimationFrame(rafId);
      URL.revokeObjectURL(video.src);
    }

    function getActiveWord(videoCurrentTime: number): string | null {
      const elapsed = videoCurrentTime - startTime;
      const elapsedMs = elapsed * 1000;
      for (const w of words) {
        if (elapsedMs >= w.startMs && elapsedMs <= w.endMs) return w.word;
      }
      // Find the most recently passed word
      let last: string | null = null;
      for (const w of words) {
        if (elapsedMs >= w.startMs) last = w.word;
      }
      return last;
    }

    function getWindowWords(videoCurrentTime: number): { word: string; active: boolean }[] {
      const elapsed = videoCurrentTime - startTime;
      const elapsedMs = elapsed * 1000;
      // Find active word index
      let activeIdx = -1;
      for (let i = 0; i < words.length; i++) {
        if (elapsedMs >= words[i].startMs && elapsedMs <= words[i].endMs) {
          activeIdx = i;
          break;
        }
        if (elapsedMs >= words[i].startMs) activeIdx = i;
      }
      const start = Math.max(0, activeIdx - 2);
      return words.slice(start, start + 5).map((w, i) => ({
        word: w.word,
        active: start + i === activeIdx,
      }));
    }

    function drawFrame() {
      // 9:16 crop: take center crop of the video
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) return;

      // Compute source rect for 9:16 center crop
      let sx = 0, sy = 0, sw = vw, sh = vh;
      const targetRatio = 9 / 16;
      const srcRatio = vw / vh;
      if (srcRatio > targetRatio) {
        // wider than 9:16 — crop sides
        sw = Math.round(vh * targetRatio);
        sx = Math.round((vw - sw) / 2);
      } else {
        // taller than 9:16 — crop top/bottom
        sh = Math.round(vw / targetRatio);
        sy = Math.round((vh - sh) / 2);
      }

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, OUTPUT_W, OUTPUT_H);

      // Dark gradient scrim at bottom for subtitle readability
      const grad = ctx.createLinearGradient(0, OUTPUT_H * 0.55, 0, OUTPUT_H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);

      drawSubtitles(ctx, video.currentTime, style, styleSeed);
    }

    function drawSubtitles(
      c: CanvasRenderingContext2D,
      currentTime: number,
      style: string,
      seed: number,
    ) {
      const windowWords = getWindowWords(currentTime);
      if (!windowWords.length) return;

      const baseFontSize = Math.round(OUTPUT_W * 0.07 * seed);
      const bottomY = OUTPUT_H - Math.round(OUTPUT_H * 0.1);

      if (style === 'hormozi') {
        c.font = `900 ${baseFontSize}px Impact, Arial Black, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'bottom';

        const lineH = baseFontSize * 1.25;
        const lines = chunkWords(windowWords, 3);
        lines.forEach((line, li) => {
          const y = bottomY - (lines.length - 1 - li) * lineH;
          line.forEach(({ word, active }) => {
            // Measure to position words
          });
          // Draw line as single string with highlight on active word
          const lineText = line.map(w => w.word.toUpperCase()).join(' ');
          c.strokeStyle = '#000';
          c.lineWidth = 6;
          c.strokeText(lineText, OUTPUT_W / 2, y);
          c.fillStyle = line.some(w => w.active) ? '#AAFF00' : '#FFFFFF';
          c.fillText(lineText, OUTPUT_W / 2, y);
        });
      } else if (style === 'minimalist') {
        c.font = `600 ${baseFontSize}px Arial, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        const lineH = baseFontSize * 1.25;
        const lines = chunkWords(windowWords, 3);
        lines.forEach((line, li) => {
          const y = bottomY - (lines.length - 1 - li) * lineH;
          const lineText = line.map(w => w.word).join(' ');
          const alpha = line.some(w => w.active) ? 1 : 0.55;
          c.fillStyle = `rgba(255,255,255,${alpha})`;
          c.fillText(lineText, OUTPUT_W / 2, y);
        });
      } else {
        // cyberpunk
        c.font = `700 ${baseFontSize}px monospace`;
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        const lineH = baseFontSize * 1.3;
        const lines = chunkWords(windowWords, 3);
        lines.forEach((line, li) => {
          const y = bottomY - (lines.length - 1 - li) * lineH;
          line.forEach(({ word, active }) => {
            // Draw each word separately for active highlight
          });
          const lineText = line.map(w => w.word).join(' ');
          if (line.some(w => w.active)) {
            c.shadowColor = '#00E5FF';
            c.shadowBlur = 12;
            c.fillStyle = '#00E5FF';
          } else {
            c.shadowBlur = 0;
            c.fillStyle = 'rgba(0,229,255,0.6)';
          }
          c.fillText(lineText, OUTPUT_W / 2, y);
          c.shadowBlur = 0;
        });
      }
    }

    function chunkWords<T>(arr: T[], size: number): T[][] {
      const result: T[][] = [];
      for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
      return result;
    }

    function startRecording() {
      try {
        const stream = canvas.captureStream(30);

        // Add audio track from video
        const audioCtx = new AudioContext();
        const src = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        src.connect(dest);
        src.connect(audioCtx.destination); // also play locally
        stream.addTrack(dest.stream.getAudioTracks()[0]);

        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          cleanup();
          audioCtx.close();
          resolve(new Blob(chunks, { type: mimeType }));
        };
        recorder.start(100); // collect every 100ms
        video.play();

        function tick() {
          if (video.currentTime >= endTime || video.ended) {
            video.pause();
            recorder.stop();
            return;
          }
          drawFrame();
          rafId = requestAnimationFrame(tick);
        }
        rafId = requestAnimationFrame(tick);

        // Safety timeout
        const maxMs = (duration + 2) * 1000;
        setTimeout(() => {
          if (recorder.state === 'recording') {
            video.pause();
            recorder.stop();
          }
        }, maxMs);
      } catch (err) {
        cleanup();
        console.warn('Canvas render failed:', err);
        resolve(null);
      }
    }

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = startTime;
    });

    video.addEventListener('seeked', () => {
      startRecording();
    }, { once: true });

    video.addEventListener('error', () => {
      cleanup();
      resolve(null);
    });
  });
}
