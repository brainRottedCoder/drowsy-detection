import type { CalibrationData, DetectionSettings } from '../services/storage';
import { DEFAULT_DETECTION } from '../services/storage';

export type CalibrationPhase =
  | 'idle'
  | 'setup'
  | 'open_eyes'
  | 'soft_blinks'
  | 'closed_eyes'
  | 'summary';

export const CALIBRATION_PHASE_ORDER: CalibrationPhase[] = [
  'setup',
  'open_eyes',
  'soft_blinks',
  'closed_eyes',
  'summary',
];

export const PHASE_INSTRUCTIONS: Record<Exclude<CalibrationPhase, 'idle'>, string> = {
  setup: 'Face the camera with good light. Keep your eyes clearly visible.',
  open_eyes: 'Open your eyes wide and look at the camera. Try not to blink.',
  soft_blinks: 'Blink naturally 3–4 times while facing the camera.',
  closed_eyes: 'Gently close both eyes and hold them closed.',
  summary: 'Review your personal thresholds, then confirm.',
};

export const PHASE_TITLES: Record<Exclude<CalibrationPhase, 'idle'>, string> = {
  setup: 'Get ready',
  open_eyes: 'Open eyes',
  soft_blinks: 'Soft blinks',
  closed_eyes: 'Close eyes',
  summary: 'Your profile',
};

/**
 * Soft time caps per phase (ms). Advance earlier when sample quotas are met.
 * Head pose is sampled in the background during these eye phases (no separate step).
 */
export const PHASE_MAX_MS: Record<Exclude<CalibrationPhase, 'idle' | 'summary'>, number> = {
  setup: 2000,
  open_eyes: 8000,
  soft_blinks: 7000,
  closed_eyes: 6000,
};

export const LIVE_CALIBRATION_PHASES = CALIBRATION_PHASE_ORDER.filter(
  (p): p is Exclude<CalibrationPhase, 'idle' | 'summary'> => p !== 'summary'
);

export const MIN_OPEN_FRAMES = 45;
export const MIN_CLOSED_FRAMES = 30;
export const MIN_SETUP_FRAMES = 20;
export const MIN_HEAD_FRAMES = 40;
export const MIN_MOUTH_FRAMES = 20;
export const MIN_CALIBRATION_BLINKS = 3;
export const MIN_OPEN_CLOSED_GAP = 0.05;

export const PROFILE_VERSION = 2;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const median = (samples: number[]): number => {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

export const average = (arr: number[]) =>
  arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

/** Prefer upper half of EAR samples (open-eye bias). */
export const openEyeBaseline = (samples: number[]): number => {
  if (samples.length === 0) return 0.3;
  const sorted = [...samples].sort((a, b) => a - b);
  const upper = sorted.slice(Math.floor(sorted.length / 2));
  return median(upper);
};

/** Closed-eye threshold from open-eye baseline, clamped to a sane absolute range. */
export const deriveClosedThreshold = (
  baselineEAR: number,
  detection: DetectionSettings = DEFAULT_DETECTION
): number => {
  const closedRatio = clamp(detection.earClosedRatio, 0.3, 0.9);
  const min = clamp(detection.earThresholdMin, 0.05, 0.3);
  const max = clamp(detection.earThresholdMax, min + 0.02, 0.4);
  const ratioBased = baselineEAR * closedRatio;
  return Math.min(max, Math.max(min, ratioBased));
};

export const validateOpenClosedGap = (
  openEAR: number,
  closedEAR: number,
  minGap = MIN_OPEN_CLOSED_GAP
): { ok: true } | { ok: false; error: string } => {
  if (!Number.isFinite(openEAR) || !Number.isFinite(closedEAR)) {
    return { ok: false, error: 'Invalid eye measurements. Retry calibration.' };
  }
  if (openEAR - closedEAR < minGap) {
    return {
      ok: false,
      error: 'Could not tell open vs closed eyes apart. Retry with clearer open and closed holds.',
    };
  }
  return { ok: true };
};

export interface PersonalEarThresholds {
  closeAt: number;
  openAt: number;
  usedFallback: boolean;
}

export const derivePersonalEarThresholds = (
  openEAR: number,
  closedEAR: number | null | undefined,
  detection: DetectionSettings = DEFAULT_DETECTION
): PersonalEarThresholds => {
  const min = clamp(detection.earThresholdMin, 0.05, 0.3);
  const max = clamp(detection.earThresholdMax, min + 0.02, 0.4);

  const closedValid =
    typeof closedEAR === 'number' &&
    Number.isFinite(closedEAR) &&
    validateOpenClosedGap(openEAR, closedEAR).ok;

  if (!closedValid) {
    const closeAt = deriveClosedThreshold(openEAR, detection);
    const openRatio = clamp(detection.earOpenRatio, 0.4, 0.95);
    const openAt = Math.max(closeAt + 0.02, Math.min(max, openEAR * openRatio));
    return { closeAt, openAt: Math.max(openAt, closeAt + 0.02), usedFallback: true };
  }

  const gap = Math.max(0.01, openEAR - (closedEAR as number));
  let closeAt = (closedEAR as number) + 0.35 * gap;
  let openAt = (closedEAR as number) + 0.55 * gap;
  closeAt = clamp(closeAt, min, max);
  openAt = clamp(openAt, closeAt + 0.02, Math.max(max, closeAt + 0.02));
  return { closeAt, openAt, usedFallback: false };
};

export const deriveYawPitchGates = (
  yawSamples: number[],
  pitchSamples: number[],
  centerYaw: number,
  centerPitch: number
): { yawGateThreshold: number; pitchGateDelta: number; baselineYaw: number; baselinePitch: number } => {
  const yawExt = yawSamples.length
    ? Math.max(...yawSamples.map(y => Math.abs(y - centerYaw)), 0.05)
    : 0.18;
  const pitchExt = pitchSamples.length
    ? Math.max(...pitchSamples.map(p => Math.abs(p - centerPitch)), 0.05)
    : 0.14;

  return {
    baselineYaw: centerYaw,
    baselinePitch: centerPitch,
    yawGateThreshold: clamp(0.6 * yawExt, 0.12, 0.35),
    pitchGateDelta: clamp(0.6 * pitchExt, 0.08, 0.25),
  };
};

export const deriveYawnMarThreshold = (
  restingMAR: number,
  peakMAR: number
): number => {
  const resting = Number.isFinite(restingMAR) ? restingMAR : 0.2;
  const peak = Number.isFinite(peakMAR) ? peakMAR : resting + 0.4;
  const raw = resting + 0.5 * Math.max(0.05, peak - resting);
  return clamp(raw, 0.4, 0.75);
};

export interface CalibrationSampleBuffers {
  openEAR: number[];
  closedEAR: number[];
  leftOpenEAR: number[];
  rightOpenEAR: number[];
  yaw: number[];
  pitch: number[];
  centerYaw: number[];
  centerPitch: number[];
  marResting: number[];
  marOpen: number[];
  blinkEvents: { durationMs: number }[];
  blendshapePeaks: number[];
}

export const emptyCalibrationBuffers = (): CalibrationSampleBuffers => ({
  openEAR: [],
  closedEAR: [],
  leftOpenEAR: [],
  rightOpenEAR: [],
  yaw: [],
  pitch: [],
  centerYaw: [],
  centerPitch: [],
  marResting: [],
  marOpen: [],
  blinkEvents: [],
  blendshapePeaks: [],
});

export interface CalibrationPreview {
  baselineEAR: number;
  closedEAR: number;
  threshold: number;
  openThreshold: number;
  leftBaselineEAR?: number;
  rightBaselineEAR?: number;
  baselineYaw: number;
  baselinePitch: number;
  yawGateThreshold: number;
  pitchGateDelta: number;
  baselineBlinkRate: number;
  baselineBlinkDurationMs: number;
  baselineMAR?: number;
  yawnMarThreshold?: number;
  blendshapeBlinkEnter?: number;
  blendshapeBlinkExit?: number;
  gapOk: boolean;
  gapError?: string;
  usedEarFallback: boolean;
  skippedMouth: boolean;
}

export const buildCalibrationPreview = (
  buffers: CalibrationSampleBuffers,
  detection: DetectionSettings,
  opts: { durationMs: number; skippedMouth: boolean }
): CalibrationPreview => {
  const baselineEAR = openEyeBaseline(buffers.openEAR);
  const closedEAR = buffers.closedEAR.length ? median(buffers.closedEAR) : NaN;
  const gapCheck = validateOpenClosedGap(baselineEAR, closedEAR);
  const ear = derivePersonalEarThresholds(
    baselineEAR,
    gapCheck.ok ? closedEAR : null,
    detection
  );

  const centerYaw = average(buffers.centerYaw.length ? buffers.centerYaw : buffers.yaw);
  const centerPitch = average(buffers.centerPitch.length ? buffers.centerPitch : buffers.pitch);
  const pose = deriveYawPitchGates(buffers.yaw, buffers.pitch, centerYaw, centerPitch);

  const durationMin = Math.max(opts.durationMs / 60_000, 1 / 60);
  const baselineBlinkRate = Math.max(6, buffers.blinkEvents.length / durationMin);
  const baselineBlinkDurationMs = buffers.blinkEvents.length
    ? average(buffers.blinkEvents.map(b => b.durationMs))
    : 250;

  const blendPeaks = buffers.blendshapePeaks;
  let blendshapeBlinkEnter: number | undefined;
  let blendshapeBlinkExit: number | undefined;
  if (blendPeaks.length >= 3) {
    const peakMed = median(blendPeaks);
    blendshapeBlinkEnter = clamp(peakMed * 0.75, 0.25, 0.55);
    blendshapeBlinkExit = clamp(blendshapeBlinkEnter - 0.12, 0.12, 0.4);
  }

  const preview: CalibrationPreview = {
    baselineEAR,
    closedEAR: gapCheck.ok ? closedEAR : baselineEAR * 0.5,
    threshold: ear.closeAt,
    openThreshold: ear.openAt,
    leftBaselineEAR: buffers.leftOpenEAR.length ? median(buffers.leftOpenEAR) : undefined,
    rightBaselineEAR: buffers.rightOpenEAR.length ? median(buffers.rightOpenEAR) : undefined,
    baselineYaw: pose.baselineYaw,
    baselinePitch: pose.baselinePitch,
    yawGateThreshold: pose.yawGateThreshold,
    pitchGateDelta: pose.pitchGateDelta,
    baselineBlinkRate,
    baselineBlinkDurationMs,
    blendshapeBlinkEnter,
    blendshapeBlinkExit,
    gapOk: gapCheck.ok,
    gapError: gapCheck.ok ? undefined : gapCheck.error,
    usedEarFallback: ear.usedFallback,
    skippedMouth: opts.skippedMouth,
  };

  if (!opts.skippedMouth && buffers.marResting.length && buffers.marOpen.length) {
    preview.baselineMAR = median(buffers.marResting);
    preview.yawnMarThreshold = deriveYawnMarThreshold(
      preview.baselineMAR,
      Math.max(...buffers.marOpen)
    );
  }

  return preview;
};

export const previewToCalibrationData = (preview: CalibrationPreview): CalibrationData => ({
  baselineEAR: preview.baselineEAR,
  threshold: preview.threshold,
  openThreshold: preview.openThreshold,
  closedEAR: preview.closedEAR,
  isCalibrated: true,
  baselineBlinkRate: preview.baselineBlinkRate,
  baselineBlinkDurationMs: preview.baselineBlinkDurationMs,
  baselineYaw: preview.baselineYaw,
  baselinePitch: preview.baselinePitch,
  leftBaselineEAR: preview.leftBaselineEAR,
  rightBaselineEAR: preview.rightBaselineEAR,
  yawGateThreshold: preview.yawGateThreshold,
  pitchGateDelta: preview.pitchGateDelta,
  baselineMAR: preview.baselineMAR,
  yawnMarThreshold: preview.yawnMarThreshold,
  blendshapeBlinkEnter: preview.blendshapeBlinkEnter,
  blendshapeBlinkExit: preview.blendshapeBlinkExit,
  calibratedAt: Date.now(),
  profileVersion: PROFILE_VERSION,
});

export const nextPhase = (phase: CalibrationPhase): CalibrationPhase => {
  const idx = CALIBRATION_PHASE_ORDER.indexOf(phase);
  if (idx < 0 || idx >= CALIBRATION_PHASE_ORDER.length - 1) return 'summary';
  return CALIBRATION_PHASE_ORDER[idx + 1];
};
