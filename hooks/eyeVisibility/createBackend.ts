import type { EyeVisibilityBackend } from './types';
import { createLandmarkBackend } from './landmarkBackend';
import { createCombinedOpaqueBackend } from './onnxOpaqueBackend';

/**
 * Landmark heuristic is primary for VISIBLE/NOT_VISIBLE.
 * Dual ONNX (eyeglasses + sunglasses) fills 3-way partition debug and
 * confidence boosts — does not override heuristic state until empirical OK.
 */
export function createEyeVisibilityBackend(): EyeVisibilityBackend {
  const heuristic = createLandmarkBackend();
  return createCombinedOpaqueBackend(heuristic, {
    eyeglassesModelUrl: '/models/glasses_eyeglasses.onnx',
    sunglassesModelUrl: '/models/glasses_sunglasses.onnx',
    threshold: 0.5,
  });
}

/** Alias matching integration notes. */
export function createBackend(): EyeVisibilityBackend {
  return createEyeVisibilityBackend();
}
