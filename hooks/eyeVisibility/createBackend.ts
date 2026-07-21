import type { EyeVisibilityBackend } from './types';
import { createLandmarkBackend } from './landmarkBackend';
import { createCombinedOpaqueBackend } from './onnxOpaqueBackend';

/**
 * Factory for the eye-visibility backend.
 *
 * Landmark/pixel heuristic is primary and authoritative for state.
 * ONNX sunglasses classifier is a confidence booster only (never overrides state).
 * Do not gate useDrowsiness scoring on this until empirical testing (clear glasses
 * stay VISIBLE; dark sunglasses show debug.agree with the heuristic).
 */
export function createEyeVisibilityBackend(): EyeVisibilityBackend {
  const heuristic = createLandmarkBackend();
  return createCombinedOpaqueBackend(heuristic, {
    modelUrl: '/models/glasses_opaque.onnx',
    threshold: 0.5, // tune after empirical clear-vs-dark glasses tests
  });
}

/** Alias matching integration notes. */
export function createBackend(): EyeVisibilityBackend {
  return createEyeVisibilityBackend();
}
