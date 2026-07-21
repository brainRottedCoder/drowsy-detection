import type { Point } from '../../utils/math';
import type { EyeSide } from './types';

/** Shared eye-crop sizing for landmark secondary checks and future TFLite (96×64). */
export const EYE_CROP_WIDTH = 96;
export const EYE_CROP_HEIGHT = 64;

export interface EyeCropRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Sparse face-outline landmarks (MediaPipe Face Landmarker) for a full-face bbox. */
const FACE_BOUNDS_INDICES = [
  10, 152, 234, 454, 127, 356, 162, 389, 58, 288, 172, 397, 136, 365, 67, 297,
];

export function eyeCropRegionFromLandmarks(
  landmarks: Point[],
  side: EyeSide
): EyeCropRegion | null {
  const indices =
    side === 'left'
      ? { outer: 33, inner: 133, points: [33, 160, 158, 133, 153, 144] }
      : { outer: 263, inner: 362, points: [362, 385, 387, 263, 373, 380] };

  const pts = indices.points.map(i => landmarks[i]).filter(Boolean);
  if (pts.length < 6) return null;

  const outer = landmarks[indices.outer];
  const inner = landmarks[indices.inner];
  if (!outer || !inner) return null;

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const eyeWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  if (eyeWidth < 0.01) return null;

  return {
    x: cx,
    y: cy,
    w: eyeWidth * 0.9,
    h: eyeWidth * 0.55,
  };
}

/**
 * Full-face crop for glasses-detector (trained on face images, not eye patches).
 * Returns normalized center + size with light padding.
 */
export function faceCropRegionFromLandmarks(landmarks: Point[]): EyeCropRegion | null {
  if (!landmarks || landmarks.length < 468) return null;

  const pts = FACE_BOUNDS_INDICES.map(i => landmarks[i]).filter(Boolean);
  if (pts.length < 6) return null;

  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const w0 = maxX - minX;
  const h0 = maxY - minY;
  if (w0 < 0.05 || h0 < 0.05) return null;

  const padX = w0 * 0.18;
  const padY = h0 * 0.18;
  minX = Math.max(0, minX - padX);
  maxX = Math.min(1, maxX + padX);
  minY = Math.max(0, minY - padY);
  maxY = Math.min(1, maxY + padY);

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
}
