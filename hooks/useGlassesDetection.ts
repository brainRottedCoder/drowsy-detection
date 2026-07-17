import { useEffect, useRef, useState } from 'react';

// MediaPipe FaceMesh landmark indices used to locate sampling regions
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_INNER = 362;
const LEFT_EYE_BOTTOM = 145;
const RIGHT_EYE_BOTTOM = 374;

const SAMPLE_INTERVAL_MS = 500;
const SAMPLE_SIZE = 32; // Regions are downscaled to SAMPLE_SIZE x SAMPLE_SIZE/2 px
const EDGE_THRESHOLD = 11; // Mean gradient above this suggests a glasses frame edge
const VOTE_WINDOW = 8; // Majority vote over the last N samples (~4s) for stability

interface UseGlassesDetectionReturn {
  hasGlasses: boolean;
  /** 0-1, fraction of recent samples that looked like glasses */
  confidence: number;
}

interface Region {
  x: number; // center, normalized 0-1
  y: number;
  w: number; // size, normalized 0-1
  h: number;
}

/**
 * Heuristic glasses detector. The face landmarker has no "glasses" output, so
 * we measure edge density in the video pixels where frames would sit: across
 * the nose bridge and under each eye. Bare skin there is smooth (low gradient);
 * plastic/metal frames produce strong edges.
 */
export const useGlassesDetection = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  landmarks: any[]
): UseGlassesDetectionReturn => {
  const [hasGlasses, setHasGlasses] = useState(false);
  const [confidence, setConfidence] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const votesRef = useRef<boolean[]>([]);
  const landmarksRef = useRef<any[]>([]);
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
      const leftBottom = points[LEFT_EYE_BOTTOM];
      const rightBottom = points[RIGHT_EYE_BOTTOM];
      if (!leftInner || !rightInner || !leftBottom || !rightBottom) return;

      // Inter-eye distance drives region sizing so it scales with face distance
      const eyeDist = Math.hypot(rightInner.x - leftInner.x, rightInner.y - leftInner.y);

      const regions: Region[] = [
        // Nose bridge: between the inner eye corners, where the glasses bridge sits
        {
          x: (leftInner.x + rightInner.x) / 2,
          y: (leftInner.y + rightInner.y) / 2 + eyeDist * 0.1,
          w: eyeDist * 0.8,
          h: eyeDist * 0.5,
        },
        // Below each eye: where the bottom rim of the frame sits
        {
          x: leftBottom.x,
          y: leftBottom.y + eyeDist * 0.25,
          w: eyeDist * 0.6,
          h: eyeDist * 0.35,
        },
        {
          x: rightBottom.x,
          y: rightBottom.y + eyeDist * 0.25,
          w: eyeDist * 0.6,
          h: eyeDist * 0.35,
        },
      ];

      const scores = regions
        .map(r => measureEdgeDensity(video, canvas, r))
        .filter((s): s is number => s !== null);
      if (scores.length === 0) return;

      // Glasses need edges both at the bridge AND under at least one eye;
      // a single noisy region (e.g. eyebrow shadow) shouldn't trigger it.
      const bridgeEdge = scores[0] > EDGE_THRESHOLD;
      const rimEdge = scores.slice(1).some(s => s > EDGE_THRESHOLD);
      const vote = bridgeEdge && rimEdge;

      votesRef.current.push(vote);
      if (votesRef.current.length > VOTE_WINDOW) {
        votesRef.current.shift();
      }

      const positive = votesRef.current.filter(Boolean).length;
      const ratio = positive / votesRef.current.length;
      setConfidence(ratio);
      // Hysteresis so the label doesn't flicker at the boundary
      setHasGlasses(prev => (prev ? ratio > 0.35 : ratio > 0.6));
    };

    const interval = setInterval(sample, SAMPLE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [videoRef]);

  return { hasGlasses, confidence };
};

// Draws a normalized region of the video into a small canvas and returns the
// mean absolute grayscale gradient (Sobel-like, both axes). Null if unreadable.
const measureEdgeDensity = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  region: Region
): number | null => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return null;

  const sx = (region.x - region.w / 2) * vw;
  const sy = (region.y - region.h / 2) * vh;
  const sw = region.w * vw;
  const sh = region.h * vh;
  if (sw < 4 || sh < 4 || sx < 0 || sy < 0 || sx + sw > vw || sy + sh > vh) return null;

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

  // Grayscale
  const gray = new Float32Array(outW * outH);
  for (let i = 0; i < outW * outH; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // Mean absolute gradient
  let total = 0;
  let count = 0;
  for (let y = 1; y < outH - 1; y++) {
    for (let x = 1; x < outW - 1; x++) {
      const idx = y * outW + x;
      const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
      const gy = Math.abs(gray[idx + outW] - gray[idx - outW]);
      total += (gx + gy) / 2;
      count++;
    }
  }

  return count > 0 ? total / count : null;
};
