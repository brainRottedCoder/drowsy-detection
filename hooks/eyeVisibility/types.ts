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
 * Pluggable backend. Landmark is sync; a future TFLite backend may return a Promise.
 * Expected TFLite crop: 96×64 RGB, classes [VISIBLE, NOT_VISIBLE, UNKNOWN],
 * model path: public/models/eye_visibility.tflite
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
