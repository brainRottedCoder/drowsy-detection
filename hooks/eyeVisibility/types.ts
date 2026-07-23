import type { Point } from '../../utils/math';

/** Per-eye visibility classification. Closed lids stay VISIBLE. */
export type EyeVisibilityState = 'VISIBLE' | 'NOT_VISIBLE' | 'UNKNOWN';

/** Dual-classifier 3-way partition (eyeglasses × sunglasses). */
export type EyewearPartition = 'bare' | 'transparent' | 'opaque';

export type EyeSide = 'left' | 'right';

export interface EyeVisibilityDebugFlags {
  irisInContour: boolean;
  eyeWidthOk: boolean;
  poseOk: boolean;
  earOk: boolean;
  geometryScore: number;
  /** True when secondary crop evidence confirmed geometry failure. */
  usedSecondaryOcclusion: boolean;
  /** @deprecated Prefer sunglassesProb — kept as alias for sunglasses P. */
  onnxScore?: number | null;
  /** True when eyewearPartition === 'opaque'. */
  onnxOpaque?: boolean | null;
  /** P(eyeglasses) from glasses-detector eyeglasses head. */
  eyeglassesProb?: number | null;
  /** P(sunglasses) from glasses-detector sunglasses head. */
  sunglassesProb?: number | null;
  /** bare | transparent | opaque from the dual-head combinator. */
  eyewearPartition?: EyewearPartition | null;
  /**
   * Heuristic opaque intent vs ONNX opaque — frequent disagreement means
   * threshold or preprocessing needs tuning. null if ONNX unavailable.
   */
  agree?: boolean | null;
  /** True once both ONNX sessions loaded and scored this sample. */
  onnxReady?: boolean;
}

export interface EyeVisibilitySample {
  state: EyeVisibilityState;
  confidence: number;
  debug: EyeVisibilityDebugFlags;
}

export interface EyeVisibilityEvaluateInput {
  video: HTMLVideoElement | null;
  landmarks: Point[];
  side: EyeSide;
  yawGate: number;
  pitchGate: number;
  baselinePitch: number;
}

/**
 * Pluggable backend. Landmark is sync; dual ONNX wrapper is async.
 * Models: public/models/glasses_eyeglasses.onnx + glasses_sunglasses.onnx
 */
export interface EyeVisibilityBackend {
  evaluate(input: EyeVisibilityEvaluateInput): EyeVisibilitySample | Promise<EyeVisibilitySample>;
}

export interface PerEyeVisibilityResult {
  left: EyeVisibilityState;
  right: EyeVisibilityState;
  overall: EyeVisibilityState;
  confidence: number;
  /** Latched UI flag: eyes are blocked / not clearly in frame. */
  eyesNotClearlyVisible: boolean;
  /**
   * True when eyes are clearly trackable (inverse of eyesNotClearlyVisible once settled).
   * Prefer this for "Eyes in the frame" stats.
   */
  eyesInFrame: boolean;
  /** False while ONNX models are still loading (or disabled → treated ready). */
  detectorReady: boolean;
  debug: {
    left: EyeVisibilityDebugFlags;
    right: EyeVisibilityDebugFlags;
  } | null;
}
