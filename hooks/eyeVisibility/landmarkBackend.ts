import { calculateEAR, estimateHeadPose, euclideanDistance, type Point } from '../../utils/math';
import type {
  EyeSide,
  EyeVisibilityBackend,
  EyeVisibilityEvaluateInput,
  EyeVisibilitySample,
  EyeVisibilityDebugFlags,
} from './types';
import { eyeCropRegionFromLandmarks } from './cropHelpers';

const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
const LEFT_OUTER = 33;
const LEFT_INNER = 133;
const RIGHT_OUTER = 263;
const RIGHT_INNER = 362;

const MIN_EAR = 0.01;
const MAX_EAR = 0.55;
/** Eye width must be at least this fraction of inter-ocular distance. */
const MIN_EYE_WIDTH_RATIO = 0.12;
/** Below this width ratio under frontal pose + failed iris → occlusion candidate. */
const COLLAPSED_WIDTH_RATIO = 0.08;
const APPEARANCE_DEBUG_DEFAULTS = {
  relativeDarkness: 0,
  darkPixelRatio: 0,
  opacityScore: 0,
  eyeMedianLuma: 0,
  skinMedianLuma: 0,
};

export interface GeometryOptions {
  yawGate: number;
  pitchGate: number;
  baselinePitch: number;
}

export interface GeometryResult {
  state: 'VISIBLE' | 'NOT_VISIBLE' | 'UNKNOWN';
  confidence: number;
  debug: EyeVisibilityDebugFlags;
}

/**
 * Pure landmark/geometry evaluation — unit-testable without DOM/video.
 */
export function evaluateEyeGeometry(
  landmarks: Point[],
  side: EyeSide,
  options: GeometryOptions
): GeometryResult {
  const emptyDebug = (overrides: Partial<EyeVisibilityDebugFlags> = {}): GeometryResult => ({
    state: 'UNKNOWN',
    confidence: 0,
    debug: {
      irisInContour: false,
      eyeWidthOk: false,
      poseOk: false,
      earOk: false,
      geometryScore: 0,
      usedSecondaryOcclusion: false,
      ...APPEARANCE_DEBUG_DEFAULTS,
      ...overrides,
    },
  });

  if (!landmarks || landmarks.length < 478) {
    return emptyDebug();
  }

  const { yaw, pitch } = estimateHeadPose(landmarks);
  const yawGate = Math.max(0.05, options.yawGate);
  const pitchGate = Math.max(0.05, options.pitchGate);
  const poseOk =
    Math.abs(yaw) <= yawGate && Math.abs(pitch - options.baselinePitch) <= pitchGate;

  if (!poseOk) {
    return {
      state: 'UNKNOWN',
      confidence: 0.35,
      debug: {
        irisInContour: false,
        eyeWidthOk: false,
        poseOk: false,
        earOk: false,
        geometryScore: 0.2,
        usedSecondaryOcclusion: false,
        ...APPEARANCE_DEBUG_DEFAULTS,
      },
    };
  }

  const eyeIndices = side === 'left' ? LEFT_EYE_INDICES : RIGHT_EYE_INDICES;
  const irisIdx = side === 'left' ? LEFT_IRIS : RIGHT_IRIS;
  const outer = landmarks[side === 'left' ? LEFT_OUTER : RIGHT_OUTER];
  const inner = landmarks[side === 'left' ? LEFT_INNER : RIGHT_INNER];
  const iris = landmarks[irisIdx];
  const eyePoints = eyeIndices.map(i => landmarks[i]);

  if (!outer || !inner || !iris || eyePoints.some(p => !p)) {
    return emptyDebug({ poseOk: true });
  }

  const leftOuter = landmarks[LEFT_OUTER];
  const rightOuter = landmarks[RIGHT_OUTER];
  if (!leftOuter || !rightOuter) {
    return emptyDebug({ poseOk: true });
  }

  const interOcular = euclideanDistance(leftOuter, rightOuter);
  if (interOcular < 0.02) {
    return emptyDebug({ poseOk: true });
  }

  const eyeWidth = euclideanDistance(outer, inner);
  const widthRatio = eyeWidth / interOcular;
  const eyeWidthOk = widthRatio >= MIN_EYE_WIDTH_RATIO;
  const collapsed = widthRatio < COLLAPSED_WIDTH_RATIO;

  const ear = calculateEAR(eyePoints);
  const earOk = Number.isFinite(ear) && ear >= MIN_EAR && ear <= MAX_EAR;

  const contour = eyePoints as Point[];
  const irisInContour = pointInPolygon(iris, contour);

  let geometryScore = 0;
  if (poseOk) geometryScore += 0.25;
  if (eyeWidthOk) geometryScore += 0.25;
  if (irisInContour) geometryScore += 0.35;
  if (earOk) geometryScore += 0.15;

  // Closed eye: low EAR but iris still sits in contour → VISIBLE
  if (poseOk && irisInContour && eyeWidthOk && earOk) {
    return {
      state: 'VISIBLE',
      confidence: Math.min(1, 0.55 + geometryScore * 0.45),
      debug: {
        irisInContour,
        eyeWidthOk,
        poseOk,
        earOk,
        geometryScore,
        usedSecondaryOcclusion: false,
        ...APPEARANCE_DEBUG_DEFAULTS,
      },
    };
  }

  // Frontal face but iris outside contour or eye collapsed → likely occlusion
  if (poseOk && (!irisInContour || collapsed) && !eyeWidthOk) {
    return {
      state: 'NOT_VISIBLE',
      confidence: Math.min(1, 0.5 + (collapsed ? 0.25 : 0) + (!irisInContour ? 0.2 : 0)),
      debug: {
        irisInContour,
        eyeWidthOk,
        poseOk,
        earOk,
        geometryScore,
        usedSecondaryOcclusion: false,
        ...APPEARANCE_DEBUG_DEFAULTS,
      },
    };
  }

  if (poseOk && !irisInContour && eyeWidthOk) {
    // Geometry ambiguous — caller may run secondary crop; default NOT_VISIBLE-leaning soft
    return {
      state: 'NOT_VISIBLE',
      confidence: 0.55,
      debug: {
        irisInContour,
        eyeWidthOk,
        poseOk,
        earOk,
        geometryScore,
        usedSecondaryOcclusion: false,
        ...APPEARANCE_DEBUG_DEFAULTS,
      },
    };
  }

  return {
    state: 'UNKNOWN',
    confidence: 0.4,
    debug: {
      irisInContour,
      eyeWidthOk,
      poseOk,
      earOk,
      geometryScore,
      usedSecondaryOcclusion: false,
      ...APPEARANCE_DEBUG_DEFAULTS,
    },
  };
}

/**
 * Ray-casting point-in-polygon. Contour should be ordered around the eye.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface EyeAppearanceEvidence {
  opaque: boolean;
  relativeDarkness: number;
  darkPixelRatio: number;
  opacityScore: number;
  eyeMedianLuma: number;
  skinMedianLuma: number;
}

interface RegionLuma {
  median: number;
  values: Float32Array;
}

/**
 * Strict appearance check for opaque lenses/covers. It compares an expanded
 * eye/lens crop with nearby skin, so ordinary dark irises and clear frames do
 * not qualify by themselves. Median/coverage metrics tolerate small screen
 * reflections on sunglasses.
 */
export function analyzeEyeAppearance(
  video: HTMLVideoElement | null,
  landmarks: Point[],
  side: EyeSide
): EyeAppearanceEvidence | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
  const base = eyeCropRegionFromLandmarks(landmarks, side);
  if (!base) return null;

  try {
    const canvas = document.createElement('canvas');
    const outW = 48;
    const outH = 32;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // Measure the lens/eye core. The previous 1.55× expanded box contained
    // enough surrounding skin to make black sunglasses average out to zero
    // opacity. This core still spans most of the sclera on an unobscured eye.
    const eyeRegion = {
      x: base.x,
      y: base.y,
      w: base.w * 0.92,
      h: base.h * 1.05,
    };
    const skinRegion = {
      x: base.x,
      y: base.y + base.w * 1.05,
      w: base.w * 1.2,
      h: base.h * 1.15,
    };

    const eye = measureLumaRegion(ctx, video, eyeRegion, vw, vh, outW, outH);
    const skin = measureLumaRegion(ctx, video, skinRegion, vw, vh, outW, outH);
    if (!eye || !skin || skin.median < 45) return null;

    return classifyEyeAppearance(eye.median, skin.median, eye.values);
  } catch {
    return null;
  }
}

function measureLumaRegion(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  region: { x: number; y: number; w: number; h: number },
  vw: number,
  vh: number,
  outW: number,
  outH: number
): RegionLuma | null {
  const sx = Math.max(0, Math.min((region.x - region.w / 2) * vw, vw - 4));
  const sy = Math.max(0, Math.min((region.y - region.h / 2) * vh, vh - 4));
  const sw = Math.max(4, Math.min(region.w * vw, vw - sx));
  const sh = Math.max(4, Math.min(region.h * vh, vh - sy));
  if (sw <= 4 || sh <= 4) return null;

  ctx.clearRect(0, 0, outW, outH);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
  const data = ctx.getImageData(0, 0, outW, outH).data;
  const values = new Float32Array(outW * outH);
  for (let i = 0; i < values.length; i++) {
    values[i] =
      0.299 * data[i * 4] +
      0.587 * data[i * 4 + 1] +
      0.114 * data[i * 4 + 2];
  }
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return { median, values };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Pure appearance classifier used by the browser sampler and unit tests. */
export function classifyEyeAppearance(
  eyeMedian: number,
  skinMedian: number,
  eyePixels: ArrayLike<number>
): EyeAppearanceEvidence {
  const relativeDarkness = clamp01((skinMedian - eyeMedian) / Math.max(skinMedian, 1));
  const darkCutoff = Math.max(8, Math.min(skinMedian * 0.68, skinMedian - 22));
  let darkCount = 0;
  for (let i = 0; i < eyePixels.length; i++) {
    if (eyePixels[i] < darkCutoff) darkCount += 1;
  }
  const darkPixelRatio = eyePixels.length ? darkCount / eyePixels.length : 0;

  const darknessScore = clamp01((relativeDarkness - 0.18) / 0.42);
  const coverageScore = clamp01((darkPixelRatio - 0.4) / 0.5);
  const opacityScore = 0.55 * darknessScore + 0.45 * coverageScore;

  return {
    // Both a large relative drop and broad dark coverage are required.
    // Clear prescription glasses should fail at least one condition.
    opaque:
      skinMedian >= 45 &&
      relativeDarkness >= 0.32 &&
      darkPixelRatio >= 0.64 &&
      opacityScore >= 0.65,
    relativeDarkness,
    darkPixelRatio,
    opacityScore,
    eyeMedianLuma: eyeMedian,
    skinMedianLuma: skinMedian,
  };
}

export class LandmarkEyeVisibilityBackend implements EyeVisibilityBackend {
  evaluate(input: EyeVisibilityEvaluateInput): EyeVisibilitySample {
    const geo = evaluateEyeGeometry(input.landmarks, input.side, {
      yawGate: input.yawGate,
      pitchGate: input.pitchGate,
      baselinePitch: input.baselinePitch,
    });

    // Missing face / unreliable pose cannot produce a trustworthy crop.
    if (geo.state === 'UNKNOWN' && !geo.debug.poseOk) {
      return geo;
    }

    // MediaPipe can hallucinate complete iris/eyelid geometry through opaque
    // sunglasses. Appearance must therefore also be checked when geometry says
    // VISIBLE, but only strict eye-vs-skin opacity can override it.
    const appearance = analyzeEyeAppearance(input.video, input.landmarks, input.side);
    const debug = appearance
      ? {
          ...geo.debug,
          usedSecondaryOcclusion: true,
          relativeDarkness: appearance.relativeDarkness,
          darkPixelRatio: appearance.darkPixelRatio,
          opacityScore: appearance.opacityScore,
          eyeMedianLuma: appearance.eyeMedianLuma,
          skinMedianLuma: appearance.skinMedianLuma,
        }
      : geo.debug;

    if (appearance?.opaque) {
      return {
        state: 'NOT_VISIBLE',
        confidence: Math.max(0.75, appearance.opacityScore),
        debug,
      };
    }

    if (geo.state === 'VISIBLE') {
      return { ...geo, debug };
    }

    // Geometry remains authoritative for a collapsed eye with missing iris.
    if (!geo.debug.irisInContour && geo.debug.poseOk && !geo.debug.eyeWidthOk) {
      return { ...geo, debug };
    }

    if (!geo.debug.irisInContour && geo.debug.poseOk && geo.debug.eyeWidthOk) {
      // Ambiguous geometry without opaque appearance: avoid a false covering alert.
      return {
        state: 'UNKNOWN',
        confidence: 0.45,
        debug,
      };
    }

    return { ...geo, debug };
  }
}
