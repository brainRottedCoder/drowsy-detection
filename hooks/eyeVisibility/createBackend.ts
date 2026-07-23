import type { EyeVisibilityBackend } from './types';
import { createLandmarkBackend } from './landmarkBackend';
import { createCombinedOpaqueBackend } from './onnxOpaqueBackend';

/**
 * Landmark heuristic + dual ONNX (eyeglasses / sunglasses).
 * ONNX opaque (sunglasses) drives NOT_VISIBLE; clear glasses stay VISIBLE.
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
