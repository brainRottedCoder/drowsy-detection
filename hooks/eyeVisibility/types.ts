import type { Point } from '../../utils/math';

/** Per-eye visibility classification. Closed lids stay VISIBLE. */
export type EyeVisibilityState = 'VISIBLE' | 'NOT_VISIBLE' | 'UNKNOWN';

export type EyeSide = 'left' | 'right';

export interface EyeVisibilityDebugFlags {
  irisInContour: boolean;
  eyeWidthOk: boolean;
  poseOk: boolean;
  earOk: boolean;
  geometryScore: number;
  /** True when secondary crop evidence confirmed geometry failure. */
  usedSecondaryOcclusion: boolean;
  /** ONNX P(opaque) after sigmoid; null if model not ready / failed. */
  onnxScore?: number | null;
  /** Whether onnxScore >= threshold. */
  onnxOpaque?: boolean | null;
  /**
   * Heuristic opaque intent vs ONNX opaque — frequent disagreement means
   * threshold or preprocessing needs tuning. null if ONNX unavailable.
   */
  agree?: boolean | null;
  /** True once the ONNX session loaded and scored this sample. */
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
 * Pluggable backend. Landmark is sync; ONNX combined wrapper is async.
 * Opaque sunglasses booster: public/models/glasses_opaque.onnx (self-hosted).
 * Future TFLite crop path (optional): 96×64 RGB, public/models/eye_visibility.tflite
 */
export interface EyeVisibilityBackend {
  evaluate(input: EyeVisibilityEvaluateInput): EyeVisibilitySample | Promise<EyeVisibilitySample>;
}

export interface PerEyeVisibilityResult {
  left: EyeVisibilityState;
  right: EyeVisibilityState;
  overall: EyeVisibilityState;
  confidence: number;
  eyesNotClearlyVisible: boolean;
  debug: {
    left: EyeVisibilityDebugFlags;
    right: EyeVisibilityDebugFlags;
  } | null;
}
