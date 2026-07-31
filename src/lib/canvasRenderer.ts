// Canvas-based video renderer — trims a clip to 9:16, burns karaoke-style
// subtitles with safe-zone padding, tracks the active subject for intelligent
// framing, and optionally injects a brand intro transition.

export interface RenderOptions {
  startTime: number;
  endTime: number;
  words: Array<{ word: string; startMs: number; endMs: number }>;
  style: 'hormozi' | 'minimalist' | 'cyberpunk';
  styleSeed: number;
  /** When true, injects a 0.5s brand hook transition at clip start. */
  enableIntro?: boolean;
  /** Brand/creator name shown in the intro transition. */
  brandName?: string;
  /** When true, uses motion-based subject tracking for 16:9→9:16 framing. */
  enableSubjectTracking?: boolean;
}

const OUTPUT_W = 720;
const OUTPUT_H = 1280; // 9:16

// YouTube 9:16 safe zones (approximate, as percentage of height from top/bottom)
const SAFE_ZONE_TOP_PCT = 0.12;    // above 12% is reserved for UI overlays
const SAFE_ZONE_BOTTOM_PCT = 0.18; // below 18% is reserved for captions/description

const INTRO_DURATION_S = 0.5;

export function renderClipWithSubtitles(
  videoFile: File,
  options: RenderOptions,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const {
      startTime, endTime, words, style, styleSeed,
      enableIntro = false, brandName = 'TrendCutFlow',
      enableSubjectTracking = true,
    } = options;
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

    // ─── Subject tracking state ───────────────────────────────────────────────
    // Tracks the brightest/most-detailed region across frames to approximate
    // speaker position. We sample a downscaled frame and find the horizontal
    // center of "energy" (variance from mean luminance).
    const trackCanvas = document.createElement('canvas');
    trackCanvas.width = 64;
    trackCanvas.height = 64;
    const trackCtx = trackCanvas.getContext('2d', { willReadFrequently: true })!;
    let trackedCenterX = 0.5; // normalized 0–1, smoothed
    let trackingInitialized = false;

    function updateSubjectTracking() {
      if (!enableSubjectTracking) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) return;

      // Draw downscaled frame to tracking canvas
      trackCtx.drawImage(video, 0, 0, 64, 64);
      const imgData = trackCtx.getImageData(0, 0, 64, 64);
      const data = imgData.data;

      // Compute luminance and find horizontal center of high-variance regions
      // (approximates where the subject/speaker is — they tend to have more
      // visual detail than flat backgrounds).
      const colVariance = new Array(64).fill(0);
      for (let x = 0; x < 64; x++) {
        let sum = 0, sumSq = 0;
        for (let y = 0; y < 64; y++) {
          const idx = (y * 64 + x) * 4;
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          sum += lum;
          sumSq += lum * lum;
        }
        const mean = sum / 64;
        const variance = sumSq / 64 - mean * mean;
        colVariance[x] = variance;
      }

      // Weighted center of variance
      let totalWeight = 0, weightedSum = 0;
      for (let x = 0; x < 64; x++) {
        const weight = Math.max(0, colVariance[x]);
        weightedSum += x * weight;
        totalWeight += weight;
      }

      if (totalWeight > 0) {
        const rawCenter = weightedSum / totalWeight / 64; // 0–1
        if (!trackingInitialized) {
          trackedCenterX = rawCenter;
          trackingInitialized = true;
        } else {
          // Smooth: lerp toward new center to avoid jitter
          trackedCenterX = trackedCenterX * 0.82 + rawCenter * 0.18;
        }
      }
    }

    function getSmartCropRect(): { sx: number; sy: number; sw: number; sh: number } {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };

      const targetRatio = 9 / 16;
      const srcRatio = vw / vh;
      let sx = 0, sy = 0, sw = vw, sh = vh;

      if (srcRatio > targetRatio) {
        // Wider than 9:16 — crop sides
        sw = Math.round(vh * targetRatio);
        // Use tracked center to offset the crop window
        const maxSx = vw - sw;
        sx = Math.round(trackedCenterX * vw - sw / 2);
        sx = Math.max(0, Math.min(sx, maxSx)); // clamp
      } else {
        // Taller than 9:16 — crop top/bottom (center vertically)
        sh = Math.round(vw / targetRatio);
        sy = Math.round((vh - sh) / 2);
      }

      return { sx, sy, sw, sh };
    }

    function cleanup() {
      cancelAnimationFrame(rafId);
      URL.revokeObjectURL(video.src);
    }

    // ─── Karaoke subtitle system ──────────────────────────────────────────────
    // Word-by-word highlighting with per-word scale animation, safe-zone
    // padding, and style-specific theming.

    function getWindowWords(videoCurrentTime: number): Array<{ word: string; active: boolean; activeProgress: number; idx: number }> {
      const elapsed = videoCurrentTime - startTime;
      const elapsedMs = elapsed * 1000;
      let activeIdx = -1;
      let activeProgress = 0;
      for (let i = 0; i < words.length; i++) {
        if (elapsedMs >= words[i].startMs && elapsedMs <= words[i].endMs) {
          activeIdx = i;
          activeProgress = (elapsedMs - words[i].startMs) / Math.max(1, words[i].endMs - words[i].startMs);
          break;
        }
        if (elapsedMs >= words[i].startMs) {
          activeIdx = i;
          activeProgress = 1;
        }
      }
      const start = Math.max(0, activeIdx - 2);
      return words.slice(start, start + 5).map((w, i) => ({
        word: w.word,
        active: start + i === activeIdx,
        activeProgress: start + i === activeIdx ? activeProgress : 0,
        idx: start + i,
      }));
    }

    function drawFrame() {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) return;

      // Update subject tracking before computing crop
      updateSubjectTracking();

      // Smart crop with subject tracking
      const { sx, sy, sw, sh } = getSmartCropRect();
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, OUTPUT_W, OUTPUT_H);

      // Dark gradient scrim in safe zone for subtitle readability
      const scrimTop = OUTPUT_H * (1 - SAFE_ZONE_BOTTOM_PCT - 0.15);
      const grad = ctx.createLinearGradient(0, scrimTop, 0, OUTPUT_H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.78)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);

      // Intro transition overlay (first 0.5s)
      const elapsed = video.currentTime - startTime;
      if (enableIntro && elapsed < INTRO_DURATION_S) {
        drawIntroTransition(ctx, elapsed, brandName);
      }

      drawKaraokeSubtitles(ctx, video.currentTime, style, styleSeed);
    }

    function drawKaraokeSubtitles(
      c: CanvasRenderingContext2D,
      currentTime: number,
      styleName: string,
      seed: number,
    ) {
      const windowWords = getWindowWords(currentTime);
      if (!windowWords.length) return;

      const baseFontSize = Math.round(OUTPUT_W * 0.07 * seed);
      // Safe-zone bottom padding: subtitles sit above the bottom safe zone
      const safeBottomY = OUTPUT_H - Math.round(OUTPUT_H * SAFE_ZONE_BOTTOM_PCT);
      const sidePadding = Math.round(OUTPUT_W * 0.06); // 6% side padding

      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'bottom';

      const lines = chunkWords(windowWords, 3);
      const lineSpacing = baseFontSize * 0.35;

      if (styleName === 'hormozi') {
        c.font = `900 ${baseFontSize}px Impact, Arial Black, sans-serif`;
        const lineH = baseFontSize * 1.25;
        lines.forEach((line, li) => {
          const y = safeBottomY - (lines.length - 1 - li) * lineH;
          drawKaraokeLine(c, line, OUTPUT_W / 2, y, {
            inactiveColor: '#FFFFFF',
            activeColor: '#AAFF00',
            strokeColor: '#000000',
            strokeWidth: 6,
            scaleActive: 1.12,
            uppercase: true,
          });
        });
      } else if (styleName === 'minimalist') {
        c.font = `600 ${baseFontSize}px Arial, sans-serif`;
        const lineH = baseFontSize * 1.25;
        lines.forEach((line, li) => {
          const y = safeBottomY - (lines.length - 1 - li) * lineH;
          drawKaraokeLine(c, line, OUTPUT_W / 2, y, {
            inactiveColor: 'rgba(255,255,255,0.5)',
            activeColor: 'rgba(255,255,255,1)',
            strokeColor: 'rgba(0,0,0,0.6)',
            strokeWidth: 3,
            scaleActive: 1.05,
            uppercase: false,
          });
        });
      } else {
        // cyberpunk
        c.font = `700 ${baseFontSize}px monospace`;
        const lineH = baseFontSize * 1.3;
        lines.forEach((line, li) => {
          const y = safeBottomY - (lines.length - 1 - li) * lineH;
          drawKaraokeLine(c, line, OUTPUT_W / 2, y, {
            inactiveColor: 'rgba(0,229,255,0.55)',
            activeColor: '#00E5FF',
            strokeColor: 'rgba(0,0,0,0.8)',
            strokeWidth: 4,
            scaleActive: 1.1,
            uppercase: false,
            glow: true,
            glowColor: '#00E5FF',
          });
        });
      }

      c.restore();
    }

    /**
     * Draws a single line of words with karaoke-style per-word highlighting.
     * The active word gets a color change, scale bump, and optional glow.
     */
    function drawKaraokeLine(
      c: CanvasRenderingContext2D,
      line: Array<{ word: string; active: boolean; activeProgress: number }>,
      centerX: number,
      y: number,
      opts: {
        inactiveColor: string;
        activeColor: string;
        strokeColor: string;
        strokeWidth: number;
        scaleActive: number;
        uppercase: boolean;
        glow?: boolean;
        glowColor?: string;
      },
    ) {
      // Measure all words to center the line
      const formatted = line.map(w => ({
        ...w,
        text: opts.uppercase ? w.word.toUpperCase() : w.word,
      }));

      const spaceW = c.measureText(' ').width;
      const wordWidths = formatted.map(w => c.measureText(w.text).width);
      const totalW = wordWidths.reduce((a, b) => a + b, 0) + spaceW * (formatted.length - 1);

      let x = centerX - totalW / 2;

      formatted.forEach((w, i) => {
        const ww = wordWidths[i];
        const isActive = w.active;
        const scale = isActive ? opts.scaleActive : 1.0;

        c.save();

        // Scale around the word's center
        const wordCx = x + ww / 2;
        c.translate(wordCx, y - baseFontSizeRef / 2);
        c.scale(scale, scale);
        c.translate(-wordCx, -(y - baseFontSizeRef / 2));

        if (opts.glow && isActive) {
          c.shadowColor = opts.glowColor || '#00E5FF';
          c.shadowBlur = 14;
        }

        c.strokeStyle = opts.strokeColor;
        c.lineWidth = opts.strokeWidth;
        c.lineJoin = 'round';
        c.strokeText(w.text, wordCx, y);

        c.fillStyle = isActive ? opts.activeColor : opts.inactiveColor;
        c.fillText(w.text, wordCx, y);

        c.restore();

        x += ww + spaceW;
      });
    }

    // Reference for scale transform baseline
    let baseFontSizeRef = Math.round(OUTPUT_W * 0.07 * styleSeed);

    // ─── Intro transition ────────────────────────────────────────────────────
    function drawIntroTransition(
      c: CanvasRenderingContext2D,
      elapsed: number,
      brand: string,
    ) {
      const progress = elapsed / INTRO_DURATION_S; // 0→1
      const fadeOut = progress > 0.7 ? (1 - (progress - 0.7) / 0.3) : 1;

      c.save();
      c.globalAlpha = fadeOut;

      // Full-screen flash that fades out
      c.fillStyle = '#0B0F17';
      c.fillRect(0, 0, OUTPUT_W, OUTPUT_H);

      // Animated brand text sliding up
      const slideY = OUTPUT_H / 2 + (1 - progress) * 40;
      c.font = `900 ${Math.round(OUTPUT_W * 0.09)}px Impact, Arial Black, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';

      // Glow
      c.shadowColor = '#00E5FF';
      c.shadowBlur = 20 * fadeOut;
      c.fillStyle = '#FFFFFF';
      c.fillText(brand.toUpperCase(), OUTPUT_W / 2, slideY);

      // Accent underline
      c.shadowBlur = 0;
      const underlineW = OUTPUT_W * 0.3 * progress;
      const underlineY = slideY + Math.round(OUTPUT_W * 0.06);
      c.fillStyle = '#00E5FF';
      c.fillRect(OUTPUT_W / 2 - underlineW / 2, underlineY, underlineW, 3);

      c.restore();
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
