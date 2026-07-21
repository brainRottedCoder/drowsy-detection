import type { EyeVisibilityBackend } from './types';
import { LandmarkEyeVisibilityBackend } from './landmarkBackend';

/**
 * Factory for the eye-visibility backend.
 *
 * Today: always landmark/geometry.
 * Future: if `public/models/eye_visibility.tflite` is present (or a settings flag),
 * return a TFLite backend that classifies 96×64 eye crops into
 * [VISIBLE, NOT_VISIBLE, UNKNOWN].
 */
export function createEyeVisibilityBackend(): EyeVisibilityBackend {
  // Placeholder for future model switch:
  // if (typeof window !== 'undefined' && window.__EYE_VISIBILITY_TFLITE__) { ... }
  return new LandmarkEyeVisibilityBackend();
}
