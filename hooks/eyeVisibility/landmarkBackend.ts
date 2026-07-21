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
      },
    };
  }

  if (poseOk && !irisInContour && eyeWidthOk) {
    // Geometry ambiguous — caller may run secondary crop
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

/**
 * Secondary occlusion check — only consulted when geometry already failed.
 * Requires extreme darkness + near-zero texture; never used alone (clear-glasses safe).
 * Does NOT override a VISIBLE geometry result.
 */
export function secondaryOcclusionEvidence(
  video: HTMLVideoElement | null,
  landmarks: Point[],
  side: EyeSide
): boolean {
  if (!video || video.readyState < 2 || video.videoWidth === 0) return false;
  const region = eyeCropRegionFromLandmarks(landmarks, side);
  if (!region) return false;

  try {
    const canvas = document.createElement('canvas');
    const outW = 32;
    const outH = 16;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = Math.max(0, Math.min((region.x - region.w / 2) * vw, vw - 4));
    const sy = Math.max(0, Math.min((region.y - region.h / 2) * vh, vh - 4));
    const sw = Math.max(4, Math.min(region.w * vw, vw - sx));
    const sh = Math.max(4, Math.min(region.h * vh, vh - sy));

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
    const data = ctx.getImageData(0, 0, outW, outH).data;

    let sum = 0;
    const gray = new Float32Array(outW * outH);
    for (let i = 0; i < outW * outH; i++) {
      const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      gray[i] = g;
      sum += g;
    }
    const mean = sum / gray.length;
    let varSum = 0;
    for (let i = 0; i < gray.length; i++) {
      const d = gray[i] - mean;
      varSum += d * d;
    }
    const variance = varSum / gray.length;

    // Opaque cover: very dark AND nearly flat. Clear glasses / open eyes fail this combo.
    return mean < 35 && variance < 40;
  } catch {
    return false;
  }
}

export class LandmarkEyeVisibilityBackend implements EyeVisibilityBackend {
  evaluate(input: EyeVisibilityEvaluateInput): EyeVisibilitySample {
    const geo = evaluateEyeGeometry(input.landmarks, input.side, {
      yawGate: input.yawGate,
      pitchGate: input.pitchGate,
      baselinePitch: input.baselinePitch,
    });

    // Geometry says VISIBLE or UNKNOWN → trust it. Appearance never overrides VISIBLE
    // (that was the Point A change that false-positived on clear glasses).
    if (geo.state === 'VISIBLE' || geo.state === 'UNKNOWN') {
      return geo;
    }

    // Geometry says NOT_VISIBLE — confirm with secondary only when available;
    // if secondary cannot run, keep geometry decision for collapsed eyes.
    const secondary = secondaryOcclusionEvidence(input.video, input.landmarks, input.side);
    if (secondary) {
      return {
        state: 'NOT_VISIBLE',
        confidence: Math.min(1, geo.confidence + 0.2),
        debug: { ...geo.debug, usedSecondaryOcclusion: true },
      };
    }

    if (!geo.debug.irisInContour && geo.debug.poseOk && !geo.debug.eyeWidthOk) {
      return geo;
    }

    if (!geo.debug.irisInContour && geo.debug.poseOk && geo.debug.eyeWidthOk) {
      // Ambiguous — prefer UNKNOWN over alarming clear glasses / landmark jitter
      return {
        state: 'UNKNOWN',
        confidence: 0.45,
        debug: { ...geo.debug, usedSecondaryOcclusion: false },
      };
    }

    return geo;
  }
}
