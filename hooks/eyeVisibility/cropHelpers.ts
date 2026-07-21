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
