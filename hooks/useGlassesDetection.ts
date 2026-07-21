import { useEffect, useRef, useState } from 'react';
import { calculateEAR } from '../utils/math';

// MediaPipe FaceMesh landmark indices
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_INNER = 362;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const LEFT_EYE_BOTTOM = 145;
const RIGHT_EYE_BOTTOM = 374;
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];
// Iris centers (MediaPipe refined landmarks when available)
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
// Cheek control points for a bare-skin baseline. Deliberately avoids the
// forehead — hair/fringe often covers it and pollutes the baseline.
const LEFT_CHEEK = 50;
const RIGHT_CHEEK = 280;

const SAMPLE_INTERVAL_MS = 400;
const SAMPLE_SIZE = 32;
const SCORE_WINDOW = 6; // ~2.4s of samples for smoothing
const JITTER_HISTORY = 10; // Option C: short window of eye landmark motion

// Sunglasses-only score: does the lens make the eyes darker/flatter *relative
// to this person's own skin, right now* (not an absolute brightness number,
// which auto-exposure webcams make meaningless) AND is eye tracking
// specifically struggling. Deliberately ignores clear/regular glasses.
const W_LUMINANCE = 0.5;
const W_VARIANCE = 0.3;
const W_JITTER = 0.2;

const ENTER_THRESHOLD = 0.5;
const EXIT_THRESHOLD = 0.32;

export interface SunglassesDebug {
  luminanceDrop: number; // 0-1
  flatness: number; // 0-1
  eyeTrackingObscured: number; // 0-1
  rawScore: number; // 0-1, before smoothing
}

interface UseGlassesDetectionReturn {
  /** Dark lenses that obscure the eyes (not clear/regular glasses) */
  hasSunglasses: boolean;
  /** Smoothed 0–1 sunglasses score */
  confidence: number;
  /** Live breakdown of the score components, for debugging/tuning */
  debug: SunglassesDebug | null;
}

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RegionStats {
  medianLuma: number;
  variance: number;
}

/**
 * Sunglasses-only detector — deliberately ignores clear/regular glasses.
 *
 * Signal 1 (pixels): the eye region darkens/flattens *relative to this
 * person's own cheek brightness right now*. Using a relative ratio (not an
 * absolute pixel value) makes this robust to webcam auto-exposure, which
 * otherwise compresses absolute brightness differences to near-nothing.
 *
 * Signal 2 (tracking, "Option C"): MediaPipe's iris/EAR tracking gets noisy
 * specifically because the eye itself is no longer visible, gated so it only
 * counts once the pixel signal already suggests something is covering the eye.
 *
 * score = 0.5*luminanceDrop + 0.3*flatness + 0.2*eyeTrackingObscured
 */
export const useGlassesDetection = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  landmarks: any[]
): UseGlassesDetectionReturn => {
  const [hasSunglasses, setHasSunglasses] = useState(false);
  const [confidence, setConfidence] = useState(0);
  const [debug, setDebug] = useState<SunglassesDebug | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scoreHistoryRef = useRef<number[]>([]);
  const landmarksRef = useRef<any[]>([]);
  const irisHistoryRef = useRef<{ lx: number; ly: number; rx: number; ry: number; ear: number }[]>([]);
  const faceAnchorHistoryRef = useRef<{ x: number; y: number }[]>([]);
  landmarksRef.current = landmarks;

  useEffect(() => {
    canvasRef.current = document.createElement('canvas');

    const sample = () => {
      const video = videoRef.current;
      const points = landmarksRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || video.readyState < 2 || !points || points.length === 0) {
        return;
      }

      const leftInner = points[LEFT_EYE_INNER];
      const rightInner = points[RIGHT_EYE_INNER];
      const leftOuter = points[LEFT_EYE_OUTER];
      const rightOuter = points[RIGHT_EYE_OUTER];
      const leftBottom = points[LEFT_EYE_BOTTOM];
      const rightBottom = points[RIGHT_EYE_BOTTOM];
      const leftCheek = points[LEFT_CHEEK];
      const rightCheek = points[RIGHT_CHEEK];
      if (!leftInner || !rightInner || !leftBottom || !rightBottom) return;

      const eyeDist = Math.hypot(rightInner.x - leftInner.x, rightInner.y - leftInner.y);
      if (eyeDist < 0.02) return;

      // Where the lens covers the eye — this is what darkens/flattens under sunglasses.
      const leftEyeRegion: Region = {
        x: (leftOuter.x + leftInner.x) / 2,
        y: (leftOuter.y + leftInner.y + leftBottom.y) / 3,
        w: eyeDist * 0.55,
        h: eyeDist * 0.4,
      };
      const rightEyeRegion: Region = {
        x: (rightOuter.x + rightInner.x) / 2,
        y: (rightOuter.y + rightInner.y + rightBottom.y) / 3,
        w: eyeDist * 0.55,
        h: eyeDist * 0.4,
      };
      const skinRegions: Region[] = [];
      if (leftCheek) {
        skinRegions.push({ x: leftCheek.x, y: leftCheek.y, w: eyeDist * 0.45, h: eyeDist * 0.35 });
      }
      if (rightCheek) {
        skinRegions.push({ x: rightCheek.x, y: rightCheek.y, w: eyeDist * 0.45, h: eyeDist * 0.35 });
      }
      if (skinRegions.length === 0) return;

      const leftStats = measureRegion(video, canvas, leftEyeRegion);
      const rightStats = measureRegion(video, canvas, rightEyeRegion);
      const skinStats = skinRegions
        .map(r => measureRegion(video, canvas, r))
        .filter((s): s is RegionStats => s !== null);

      if (!leftStats || !rightStats || skinStats.length === 0) return;

      const eyeLuma = (leftStats.medianLuma + rightStats.medianLuma) / 2;
      const skinLuma = skinStats.reduce((s, c) => s + c.medianLuma, 0) / skinStats.length;
      const eyeVariance = (leftStats.variance + rightStats.variance) / 2;
      const skinVariance = skinStats.reduce((s, c) => s + c.variance, 0) / skinStats.length;

      // Relative luminance drop — robust to auto-exposure. Bare eyes are
      // slightly darker than cheeks anyway (socket shadow, lashes) so a small
      // baseline offset is subtracted before scaling.
      const relDrop = (skinLuma - eyeLuma) / Math.max(skinLuma, 12);
      const luminanceDrop = clamp01((relDrop - 0.08) / 0.32);

      // Flatness relative to the skin's own texture level (also auto-exposure
      // dependent) rather than one fixed magic number. Bare eyes have MORE
      // local contrast than skin (sclera/iris edges); a lens flattens that
      // toward or below skin-level texture.
      const relFlat = 1 - eyeVariance / Math.max(skinVariance * 1.4, 80);
      const flatness = clamp01(relFlat);

      // --- Option C: eye tracking specifically struggling on the eye itself ---
      const leftIris = points[LEFT_IRIS] ?? leftInner;
      const rightIris = points[RIGHT_IRIS] ?? rightInner;
      const leftEAR = calculateEAR(LEFT_EYE_INDICES.map(i => points[i]).filter(Boolean));
      const rightEAR = calculateEAR(RIGHT_EYE_INDICES.map(i => points[i]).filter(Boolean));
      const avgEAR = (leftEAR + rightEAR) / 2;

      const nose = points[1];
      const faceAnchor = nose
        ? { x: nose.x, y: nose.y }
        : { x: (leftInner.x + rightInner.x) / 2, y: (leftInner.y + rightInner.y) / 2 };

      irisHistoryRef.current.push({
        lx: leftIris.x,
        ly: leftIris.y,
        rx: rightIris.x,
        ry: rightIris.y,
        ear: avgEAR,
      });
      faceAnchorHistoryRef.current.push(faceAnchor);
      if (irisHistoryRef.current.length > JITTER_HISTORY) irisHistoryRef.current.shift();
      if (faceAnchorHistoryRef.current.length > JITTER_HISTORY) faceAnchorHistoryRef.current.shift();

      const eyeTrackingObscured = computeEyeTrackingObscured(
        irisHistoryRef.current,
        faceAnchorHistoryRef.current,
        eyeDist
      );

      // Only count tracking instability as evidence of sunglasses if the eyes
      // also look darker/flatter than usual — otherwise it's just motion blur.
      const gatedJitter = luminanceDrop > 0.2 || flatness > 0.35 ? eyeTrackingObscured : 0;

      const rawScore = W_LUMINANCE * luminanceDrop + W_VARIANCE * flatness + W_JITTER * gatedJitter;

      scoreHistoryRef.current.push(rawScore);
      if (scoreHistoryRef.current.length > SCORE_WINDOW) scoreHistoryRef.current.shift();

      const smoothed =
        scoreHistoryRef.current.reduce((a, b) => a + b, 0) / scoreHistoryRef.current.length;

      setConfidence(smoothed);
      setDebug({ luminanceDrop, flatness, eyeTrackingObscured: gatedJitter, rawScore });
      setHasSunglasses(prev => (prev ? smoothed > EXIT_THRESHOLD : smoothed > ENTER_THRESHOLD));
    };

    const interval = setInterval(sample, SAMPLE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [videoRef]);

  return { hasSunglasses, confidence, debug };
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * High relative motion of iris/EAR while the face anchor is stable →
 * the landmarker can't reliably see the eye itself (dark/reflective lens),
 * as opposed to whole-head motion or a normal blink.
 */
const computeEyeTrackingObscured = (
  irisHistory: { lx: number; ly: number; rx: number; ry: number; ear: number }[],
  faceHistory: { x: number; y: number }[],
  eyeDist: number
): number => {
  if (irisHistory.length < 4 || faceHistory.length < 4) return 0;

  const irisMotion = averageStepDistance(
    irisHistory.map(p => ({ x: (p.lx + p.rx) / 2, y: (p.ly + p.ry) / 2 }))
  );
  const faceMotion = averageStepDistance(faceHistory);
  const earVariance = variance(irisHistory.map(p => p.ear));

  const relativeIrisJitter = clamp01((irisMotion - faceMotion) / (eyeDist * 0.04 + 1e-6));
  const earNoise = clamp01(earVariance / 0.004);

  return clamp01(0.65 * relativeIrisJitter + 0.35 * earNoise);
};

const averageStepDistance = (pts: { x: number; y: number }[]): number => {
  if (pts.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return sum / (pts.length - 1);
};

const variance = (values: number[]): number => {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
};

const measureRegion = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  region: Region
): RegionStats | null => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return null;

  // Clamp into frame bounds instead of rejecting the sample outright — near
  // frame edges (close-up faces, small screens) this previously caused
  // the detector to silently stop updating and "feel" unresponsive.
  const rawSx = (region.x - region.w / 2) * vw;
  const rawSy = (region.y - region.h / 2) * vh;
  const rawSw = region.w * vw;
  const rawSh = region.h * vh;

  const sx = Math.max(0, Math.min(rawSx, vw - 4));
  const sy = Math.max(0, Math.min(rawSy, vh - 4));
  const sw = Math.max(4, Math.min(rawSw, vw - sx));
  const sh = Math.max(4, Math.min(rawSh, vh - sy));
  if (sw < 4 || sh < 4) return null;

  const outW = SAMPLE_SIZE;
  const outH = Math.floor(SAMPLE_SIZE / 2);
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, outW, outH).data;
  } catch {
    return null;
  }

  const gray = new Float32Array(outW * outH);
  for (let i = 0; i < outW * outH; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // Median is far more robust than mean against a single glare highlight or
  // dark shadow pixel skewing a tiny (32x16) sample.
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianLuma =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  let varSum = 0;
  for (let i = 0; i < gray.length; i++) {
    const d = gray[i] - medianLuma;
    varSum += d * d;
  }
  const varianceVal = varSum / gray.length;

  return { medianLuma, variance: varianceVal };
};
