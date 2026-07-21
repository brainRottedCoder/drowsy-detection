import { useState, useEffect, useCallback, useRef } from 'react';
import { calculateEAR, calculateMAR, estimateHeadPose } from '../utils/math';
import { useAppContext } from '../context/AppContext';
import { useFacePresence, FacePresenceState } from './useFacePresence';
import type { DetectionSettings } from '../services/storage';
import { DEFAULT_DETECTION } from '../services/storage';

// Indices for MediaPipe Face Mesh
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];
const MOUTH_INDICES = [61, 81, 311, 291, 402, 178];

export type AlertLevel = 'NONE' | 'CAUTION' | 'WARNING' | 'CRITICAL';

interface ClosureInterval {
  start: number;
  end: number;
  type: 'blink' | 'droop' | 'microsleep';
}

interface BlinkStat {
  timestamp: number;
  durationMs: number;
}

interface UseDrowsinessReturn {
  isDrowsy: boolean;
  alertLevel: AlertLevel;
  drowsinessScore: number;
  currentEAR: number;
  currentMAR: number;
  isYawning: boolean;
  yawnCount: number;
  isYawnAlert: boolean;
  isMicrosleep: boolean;
  isDistracted: boolean;
  facePresence: FacePresenceState;
  blinkRate: number;
  avgBlinkDurationMs: number;
  isCalibrating: boolean;
  startCalibration: () => void;
  stopCalibration: () => void;
  calibrationProgress: number;
  resetState: () => void;
}

/** Blendshape enter/exit for eyeBlinkLeft/Right (MediaPipe 0–1). */
const BLINK_ENTER = 0.40;
const BLINK_EXIT = 0.25;
/** Ignore only true zero-duration glitches; single-frame blendshape blinks are valid. */
const MIN_BLINK_MS = 0;
/** Cap single-blink contribution so long closures don't count as blinks. */
const DEFAULT_BLINK_MAX_MS = 550;

export const useDrowsiness = (
  landmarks: any[],
  blendshapes: Record<string, number> = {}
): UseDrowsinessReturn => {
  const { calibration, updateCalibration, settings } = useAppContext();
  const { presence: facePresence } = useFacePresence(landmarks);
  const d = settings.detection;
  const w = settings.scoreWeights;
  const levels = settings.alertLevels;

  const [alertLevel, setAlertLevel] = useState<AlertLevel>('NONE');
  const [drowsinessScore, setDrowsinessScore] = useState(0);
  const [currentEAR, setCurrentEAR] = useState(0);
  const [currentMAR, setCurrentMAR] = useState(0);
  const [isYawning, setIsYawning] = useState(false);
  const [yawnCount, setYawnCount] = useState(0);
  const [isYawnAlert, setIsYawnAlert] = useState(false);
  const [isMicrosleep, setIsMicrosleep] = useState(false);
  const [isDistracted, setIsDistracted] = useState(false);
  const [blinkRate, setBlinkRate] = useState(0);
  const [avgBlinkDurationMs, setAvgBlinkDurationMs] = useState(0);

  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const calibrationEARRef = useRef<number[]>([]);
  const calibrationYawRef = useRef<number[]>([]);
  const calibrationPitchRef = useRef<number[]>([]);
  const calibrationBlinkEventsRef = useRef<BlinkStat[]>([]);
  const calibrationStartRef = useRef<number>(0);

  const closedSinceRef = useRef<number | null>(null);
  const eyesClosedLatchedRef = useRef(false);
  const closureIntervalsRef = useRef<ClosureInterval[]>([]);
  /** Completed blinks only — used for blinks/min (kept separate from PERCLOS closures). */
  const blinkEventsRef = useRef<BlinkStat[]>([]);
  const monitoringStartRef = useRef<number>(Date.now());

  const lookAwaySinceRef = useRef<number | null>(null);
  const lastPitchRef = useRef<number | null>(null);
  const earScoreHistoryRef = useRef<number[]>([]);

  const mouthOpenFramesRef = useRef(0);
  const yawnRegisteredRef = useRef(false);
  const yawnTimestampsRef = useRef<number[]>([]);

  const alertLevelRef = useRef<AlertLevel>('NONE');
  const belowLevelSinceRef = useRef<number | null>(null);

  const levelThresholds = (): { level: AlertLevel; enter: number }[] => [
    { level: 'CRITICAL', enter: clamp(levels.criticalEnter, 1, 100) },
    { level: 'WARNING', enter: clamp(levels.warningEnter, 1, 99) },
    { level: 'CAUTION', enter: clamp(levels.cautionEnter, 0, 98) },
    { level: 'NONE', enter: 0 },
  ];

  const processFrame = useCallback(() => {
    if (!landmarks || landmarks.length === 0) {
      // Face dropped — finish any open blink so it still counts.
      if (closedSinceRef.current !== null) {
        const now = Date.now();
        const blinkMaxMs = Math.max(100, d.blinkMaxMs);
        const microsleepMs = Math.max(blinkMaxMs + 100, d.microsleepMs);
        finalizeOpenEyes(now, blinkMaxMs, microsleepMs);
      }
      lookAwaySinceRef.current = null;
      return;
    }

    const now = Date.now();
    const blinkMaxMs = Math.max(100, d.blinkMaxMs ?? DEFAULT_BLINK_MAX_MS);
    const microsleepMs = Math.max(blinkMaxMs + 100, d.microsleepMs);
    const perclosWindowMs = Math.max(5000, d.perclosWindowMs);
    const blinkStatsWindowMs = Math.max(5000, d.blinkStatsWindowMs);
    const yawGate = clamp(d.yawGateThreshold, 0.05, 0.5);
    const pitchGate = clamp(d.pitchGateDelta, 0.05, 0.5);
    const lookAwayMs = Math.max(1000, d.lookAwayDistractionMs);
    const yawnMar = clamp(d.yawnMarThreshold, 0.2, 1.2);
    const yawnFrames = Math.max(5, Math.round(d.yawnFramesThreshold));
    const yawnMemoryMs = Math.max(60_000, d.yawnMemoryMs);
    const yawnAlertWindowMs = Math.max(10_000, d.yawnAlertWindowMs);
    const yawnAlertCount = Math.max(2, Math.round(d.yawnAlertCount));

    const leftEyePoints = LEFT_EYE_INDICES.map(i => landmarks[i]);
    const rightEyePoints = RIGHT_EYE_INDICES.map(i => landmarks[i]);
    const leftEAR = calculateEAR(leftEyePoints);
    const rightEAR = calculateEAR(rightEyePoints);
    const avgEAR = (leftEAR + rightEAR) / 2;
    setCurrentEAR(avgEAR);

    const mouthPoints = MOUTH_INDICES.map(i => landmarks[i]);
    const mar = calculateMAR(mouthPoints);
    setCurrentMAR(mar);

    const { yaw, pitch } = estimateHeadPose(landmarks);
    const isLookingAway = Math.abs(yaw) > yawGate;

    if (isCalibrating) {
      calibrationEARRef.current.push(avgEAR);
      calibrationYawRef.current.push(yaw);
      calibrationPitchRef.current.push(pitch);

      const elapsed = now - calibrationStartRef.current;
      setCalibrationProgress(Math.min(100, (elapsed / 5000) * 100));
      // Prefer blendshapes during calibration too — more reliable blink samples.
      trackBlinkSignal(resolveEyesClosed(avgEAR, blendshapes), now, blinkMaxMs, microsleepMs, true);

      if (elapsed >= 5000) {
        finishCalibration();
      }
      return;
    }

    const pitchDelta = Math.abs(pitch - calibration.baselinePitch);
    const poseUnreliable = isLookingAway || pitchDelta > pitchGate;

    // Blink counting must NOT be gated by pose — slight pitch/yaw noise was
    // preventing every blink from registering. Pose only affects distraction UI
    // and long-closure (PERCLOS / microsleep) confidence.
    const eyesClosed = resolveEyesClosed(avgEAR, blendshapes);
    trackBlinkSignal(eyesClosed, now, blinkMaxMs, microsleepMs, false);

    if (poseUnreliable) {
      if (isLookingAway) {
        if (lookAwaySinceRef.current === null) lookAwaySinceRef.current = now;
        setIsDistracted(now - lookAwaySinceRef.current > lookAwayMs);
      } else {
        lookAwaySinceRef.current = null;
        setIsDistracted(false);
      }
    } else {
      lookAwaySinceRef.current = null;
      setIsDistracted(false);
    }

    lastPitchRef.current = pitch;

    if (!isLookingAway && mar > yawnMar) {
      mouthOpenFramesRef.current += 1;
      if (mouthOpenFramesRef.current >= yawnFrames && !yawnRegisteredRef.current) {
        yawnRegisteredRef.current = true;
        yawnTimestampsRef.current.push(now);
        setYawnCount(prev => prev + 1);
      }
    } else {
      mouthOpenFramesRef.current = 0;
      yawnRegisteredRef.current = false;
    }
    setIsYawning(yawnRegisteredRef.current);
    yawnTimestampsRef.current = yawnTimestampsRef.current.filter(t => now - t < yawnMemoryMs);

    const recentYawnAlertCount = yawnTimestampsRef.current.filter(
      t => now - t < yawnAlertWindowMs
    ).length;
    setIsYawnAlert(recentYawnAlertCount >= yawnAlertCount);

    closureIntervalsRef.current = closureIntervalsRef.current.filter(
      iv => now - iv.end < perclosWindowMs
    );

    const activeMicrosleep =
      !poseUnreliable &&
      closedSinceRef.current !== null &&
      now - closedSinceRef.current >= microsleepMs;
    setIsMicrosleep(activeMicrosleep);

    computeScoreAndLevel(now, activeMicrosleep, avgEAR, yaw, pitch, {
      perclosWindowMs,
      blinkStatsWindowMs,
      yawnMemoryMs,
    });
  }, [
    landmarks,
    blendshapes,
    isCalibrating,
    calibration.baselinePitch,
    calibration.baselineYaw,
    calibration.baselineEAR,
    calibration.baselineBlinkRate,
    calibration.baselineBlinkDurationMs,
    calibration.threshold,
    settings.sensitivity,
    d,
    w,
    levels,
  ]);

  const resolveEyesClosed = (avgEAR: number, shapes: Record<string, number>): boolean => {
    const leftBlink = shapes.eyeBlinkLeft;
    const rightBlink = shapes.eyeBlinkRight;
    const hasBlendshapes =
      typeof leftBlink === 'number' || typeof rightBlink === 'number';

    if (hasBlendshapes) {
      // Use the stronger eye — partial/asymmetric blinks still count.
      const blinkScore = Math.max(leftBlink ?? 0, rightBlink ?? 0);
      if (!eyesClosedLatchedRef.current) {
        return blinkScore >= BLINK_ENTER;
      }
      return blinkScore > BLINK_EXIT;
    }

    // EAR fallback when blendshapes aren't available yet.
    const closeAt = Math.max(
      calibration.threshold || 0.18,
      (calibration.baselineEAR || 0.3) * 0.7
    );
    const openAt = closeAt + 0.04;

    if (!eyesClosedLatchedRef.current) {
      return avgEAR < closeAt;
    }
    return avgEAR <= openAt;
  };

  const classifyClosure = (durationMs: number, blinkMaxMs: number, microsleepMs: number): ClosureInterval['type'] => {
    if (durationMs >= microsleepMs) return 'microsleep';
    if (durationMs >= blinkMaxMs) return 'droop';
    return 'blink';
  };

  const recordCompletedBlink = (now: number, durationMs: number, blinkMaxMs: number, forCalibration: boolean) => {
    // Count any completed close→open cycle under blinkMaxMs (incl. single-frame spikes).
    if (durationMs < MIN_BLINK_MS || durationMs >= blinkMaxMs) return;
    if (forCalibration) {
      calibrationBlinkEventsRef.current.push({ timestamp: now, durationMs: Math.max(durationMs, 1) });
      return;
    }
    blinkEventsRef.current.push({ timestamp: now, durationMs: Math.max(durationMs, 1) });
    // Push UI immediately so the stats panel ticks up as soon as a blink finishes.
    refreshBlinkRate(now);
  };

  /** Blink rate = number of blinks completed in the last 60 seconds. */
  const refreshBlinkRate = (now: number) => {
    const windowMs = Math.max(5000, d.blinkStatsWindowMs || 60_000);
    blinkEventsRef.current = blinkEventsRef.current.filter(b => now - b.timestamp < windowMs);
    const recent = blinkEventsRef.current;
    setBlinkRate(recent.length);
    setAvgBlinkDurationMs(
      recent.length
        ? recent.reduce((sum, b) => sum + b.durationMs, 0) / recent.length
        : calibration.baselineBlinkDurationMs
    );
  };

  const finalizeOpenEyes = (
    now: number,
    blinkMaxMs: number,
    microsleepMs: number,
    forCalibration = false
  ) => {
    if (closedSinceRef.current === null) {
      eyesClosedLatchedRef.current = false;
      return;
    }

    const duration = now - closedSinceRef.current;
    if (!forCalibration) {
      const current = closureIntervalsRef.current[closureIntervalsRef.current.length - 1];
      if (current) {
        current.end = now;
        current.type = classifyClosure(duration, blinkMaxMs, microsleepMs);
      }
    }
    recordCompletedBlink(now, duration, blinkMaxMs, forCalibration);
    closedSinceRef.current = null;
    eyesClosedLatchedRef.current = false;
  };

  const trackBlinkSignal = (
    isClosed: boolean,
    now: number,
    blinkMaxMs: number,
    microsleepMs: number,
    forCalibration: boolean
  ) => {
    eyesClosedLatchedRef.current = isClosed;

    if (isClosed) {
      if (closedSinceRef.current === null) {
        closedSinceRef.current = now;
        if (!forCalibration) {
          closureIntervalsRef.current.push({ start: now, end: now, type: 'blink' });
        }
      } else if (!forCalibration) {
        const duration = now - closedSinceRef.current;
        const current = closureIntervalsRef.current[closureIntervalsRef.current.length - 1];
        if (current) {
          current.end = now;
          current.type = classifyClosure(duration, blinkMaxMs, microsleepMs);
        }
      }
    } else {
      finalizeOpenEyes(now, blinkMaxMs, microsleepMs, forCalibration);
    }
  };

  const computeScoreAndLevel = (
    now: number,
    activeMicrosleep: boolean,
    avgEAR: number,
    yaw: number,
    pitch: number,
    windows: { perclosWindowMs: number; blinkStatsWindowMs: number; yawnMemoryMs: number }
  ) => {
    const closedMs = closureIntervalsRef.current.reduce((sum, iv) => {
      if (iv.type === 'blink') return sum;
      const end = iv.end === iv.start ? now : iv.end;
      return sum + Math.max(0, end - iv.start);
    }, 0);
    const windowMs = Math.min(windows.perclosWindowMs, now - monitoringStartRef.current);
    const perclos = Math.min(1, closedMs / Math.max(windowMs, 1000));

    // Blink rate = raw count of blinks in the last 1 minute (rolling window).
    refreshBlinkRate(now);
    const currentBlinkRate = blinkEventsRef.current.length;

    const blinkRateScore = clamp01(
      Math.abs(currentBlinkRate - calibration.baselineBlinkRate) /
        (calibration.baselineBlinkRate || 15)
    );

    const baselineEAR = calibration.baselineEAR || 0.3;
    const rawEarScore = clamp01((baselineEAR - avgEAR) / Math.max(baselineEAR, 0.05));
    const historyLen = Math.max(2, Math.round(d.earScoreHistory));
    earScoreHistoryRef.current.push(rawEarScore);
    if (earScoreHistoryRef.current.length > historyLen) {
      earScoreHistoryRef.current.shift();
    }
    const earScore =
      earScoreHistoryRef.current.reduce((a, b) => a + b, 0) / earScoreHistoryRef.current.length;

    const yawnScore = clamp01(
      yawnTimestampsRef.current.reduce((sum, t) => {
        const age = now - t;
        const decay = Math.max(0, 1 - age / windows.yawnMemoryMs);
        return sum + 0.4 * decay;
      }, 0)
    );

    const headPoseRange = Math.max(0.1, d.headPoseScoreRange);
    const yawDev = Math.abs(yaw - (calibration.baselineYaw || 0));
    const pitchDev = Math.abs(pitch - (calibration.baselinePitch || 0));
    const headPoseScore = clamp01((yawDev + pitchDev) / headPoseRange);

    let score =
      (perclos * clamp01(w.perclos) +
        earScore * clamp01(w.ear) +
        blinkRateScore * clamp01(w.blinkRate) +
        yawnScore * clamp01(w.yawn) +
        headPoseScore * clamp01(w.headPose)) *
      100;

    score = score * (0.5 + settings.sensitivity);

    if (activeMicrosleep) {
      score = 100;
    }

    score = Math.min(100, Math.max(0, score));
    setDrowsinessScore(score);
    updateAlertLevel(score, now);
  };

  const updateAlertLevel = (score: number, now: number) => {
    const thresholds = levelThresholds();
    const currentLevel = alertLevelRef.current;
    const currentIdx = thresholds.findIndex(l => l.level === currentLevel);
    const hysteresis = Math.max(0, levels.downgradeHysteresis);
    const stableMs = Math.max(500, levels.downgradeStableMs);

    const targetLevel = thresholds.find(l => score >= l.enter)?.level ?? 'NONE';
    const targetIdx = thresholds.findIndex(l => l.level === targetLevel);

    if (targetIdx < currentIdx) {
      alertLevelRef.current = targetLevel;
      setAlertLevel(targetLevel);
      belowLevelSinceRef.current = null;
      return;
    }

    if (targetIdx > currentIdx) {
      const currentEntry = thresholds[currentIdx]?.enter ?? 0;
      if (score < currentEntry - hysteresis) {
        if (belowLevelSinceRef.current === null) {
          belowLevelSinceRef.current = now;
        } else if (now - belowLevelSinceRef.current >= stableMs) {
          alertLevelRef.current = targetLevel;
          setAlertLevel(targetLevel);
          belowLevelSinceRef.current = null;
        }
      } else {
        belowLevelSinceRef.current = null;
      }
    } else {
      belowLevelSinceRef.current = null;
    }
  };

  useEffect(() => {
    processFrame();
  }, [processFrame]);

  const startCalibration = () => {
    setIsCalibrating(true);
    setCalibrationProgress(0);
    calibrationStartRef.current = Date.now();
    calibrationEARRef.current = [];
    calibrationYawRef.current = [];
    calibrationPitchRef.current = [];
    calibrationBlinkEventsRef.current = [];
    closedSinceRef.current = null;
    eyesClosedLatchedRef.current = false;
  };

  const stopCalibration = () => {
    setIsCalibrating(false);
    setCalibrationProgress(0);
  };

  const finishCalibration = () => {
    const earSamples = calibrationEARRef.current;
    if (earSamples.length === 0) return;

    const baselineEAR = openEyeBaseline(earSamples);
    const avgYaw = average(calibrationYawRef.current);
    const avgPitch = average(calibrationPitchRef.current);

    const calibrationDurationMin = (Date.now() - calibrationStartRef.current) / 60_000;
    const blinkEvents = calibrationBlinkEventsRef.current;
    const baselineBlinkRate =
      calibrationDurationMin > 0
        ? Math.max(6, blinkEvents.length / calibrationDurationMin)
        : 17;
    const baselineBlinkDurationMs = blinkEvents.length
      ? blinkEvents.reduce((sum, b) => sum + b.durationMs, 0) / blinkEvents.length
      : 250;

    updateCalibration({
      baselineEAR,
      threshold: deriveClosedThreshold(baselineEAR, d),
      isCalibrated: true,
      baselineYaw: avgYaw,
      baselinePitch: avgPitch,
      baselineBlinkRate,
      baselineBlinkDurationMs,
    });

    stopCalibration();
  };

  const resetState = () => {
    setAlertLevel('NONE');
    alertLevelRef.current = 'NONE';
    belowLevelSinceRef.current = null;
    setDrowsinessScore(0);
    closureIntervalsRef.current = [];
    blinkEventsRef.current = [];
    closedSinceRef.current = null;
    eyesClosedLatchedRef.current = false;
    monitoringStartRef.current = Date.now();
    mouthOpenFramesRef.current = 0;
    yawnRegisteredRef.current = false;
    yawnTimestampsRef.current = [];
    earScoreHistoryRef.current = [];
    lastPitchRef.current = null;
    setBlinkRate(0);
    setAvgBlinkDurationMs(0);
    setIsYawning(false);
    setIsYawnAlert(false);
    setIsMicrosleep(false);
    setIsDistracted(false);
  };

  return {
    isDrowsy: alertLevel === 'CRITICAL',
    alertLevel,
    drowsinessScore,
    currentEAR,
    currentMAR,
    isYawning,
    yawnCount,
    isYawnAlert,
    isMicrosleep,
    isDistracted,
    facePresence,
    blinkRate,
    avgBlinkDurationMs,
    isCalibrating,
    startCalibration,
    stopCalibration,
    calibrationProgress,
    resetState,
  };
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const average = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

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

const openEyeBaseline = (samples: number[]): number => {
  if (samples.length === 0) return 0.3;
  const sorted = [...samples].sort((a, b) => a - b);
  const upper = sorted.slice(Math.floor(sorted.length / 2));
  const mid = Math.floor(upper.length / 2);
  return upper.length % 2 === 0 ? (upper[mid - 1] + upper[mid]) / 2 : upper[mid];
};
