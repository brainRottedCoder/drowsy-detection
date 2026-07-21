import { useState, useEffect, useCallback, useRef } from 'react';
import { calculateEAR, calculateMAR, estimateHeadPose } from '../utils/math';
import { useAppContext } from '../context/AppContext';
import { useFacePresence, FacePresenceState } from './useFacePresence';

// Indices for MediaPipe Face Mesh
// Left Eye: [33, 160, 158, 133, 153, 144] (approximate for EAR)
// Right Eye: [362, 385, 387, 263, 373, 380]
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];
// Mouth (inner lips) ordered as [left_corner, top1, top2, right_corner, bottom2, bottom1]
// so MAR uses the same formula as EAR: verticals (81-178, 311-402) over horizontal (61-291)
const MOUTH_INDICES = [61, 81, 311, 291, 402, 178];

// --- Eye closure classification ---
// A real blink is fast (typically 100-300ms). Anything longer is either an
// eyelid droop (fatigue) or a microsleep (danger). Classifying by *duration*
// instead of "any frame below threshold" is what lets normal blinking,
// looking down briefly, etc. pass through without tripping the alarm.
const BLINK_MAX_MS = 400;
const MICROSLEEP_MS = 2000;
const PERCLOS_WINDOW_MS = 60_000; // Rolling window for "closed eyelid" percentage
const BLINK_STATS_WINDOW_MS = 60_000; // Rolling window for blink rate / duration

// Closed-eye EAR must fall well below open-eye baseline.
// 0.8 was far too aggressive: slight squint / look-down / glasses glare
// dropped EAR ~15-20% and falsely counted as "closed" → microsleep alerts.
const EAR_CLOSED_RATIO = 0.55;
const EAR_OPEN_RATIO = 0.70; // Hysteresis: stay "closed" until EAR recovers higher
const EAR_THRESHOLD_MIN = 0.12;
const EAR_THRESHOLD_MAX = 0.20;

// --- Head pose gating ---
// Looking away (talking, mirrors) geometrically compresses/distorts the EAR
// signal. We suspend eye-based scoring while the head is turned, and instead
// raise a separate "distracted" flag if it goes on too long.
const YAW_GATE_THRESHOLD = 0.18; // Normalized nose-to-eye-midpoint offset
const PITCH_GATE_DELTA = 0.14; // Looking down/up enough to distort EAR
const LOOK_AWAY_DISTRACTION_MS = 4000;
const NOD_PITCH_DELTA = 0.12; // Deviation from calibrated baseline pitch
const NOD_WINDOW_MS = 60_000;

// --- Yawning ---
const YAWN_MAR_THRESHOLD = 0.6;
const YAWN_FRAMES_THRESHOLD = 20; // ~0.7-1s sustained open mouth = yawn (talking is shorter)
const YAWN_MEMORY_MS = 10 * 60_000; // Yawn *frequency* over 10 minutes is the real signal

// --- Score fusion weights (sum to <= 1.0; microsleep overrides everything) ---
const WEIGHT_PERCLOS = 0.40;
const WEIGHT_BLINK_DURATION = 0.15;
const WEIGHT_BLINK_RATE = 0.10;
const WEIGHT_YAWN = 0.20;
const WEIGHT_NOD = 0.15;

export type AlertLevel = 'NONE' | 'CAUTION' | 'WARNING' | 'CRITICAL';
const LEVEL_THRESHOLDS: { level: AlertLevel; enter: number }[] = [
  { level: 'CRITICAL', enter: 75 },
  { level: 'WARNING', enter: 50 },
  { level: 'CAUTION', enter: 30 },
  { level: 'NONE', enter: 0 },
];
const DOWNGRADE_HYSTERESIS = 10; // Score must drop this far below a level's entry point
const DOWNGRADE_STABLE_MS = 2500; // ...and stay there this long before de-escalating

interface ClosureInterval {
  start: number;
  end: number; // Updated live while ongoing
  type: 'blink' | 'droop' | 'microsleep';
}

interface BlinkStat {
  timestamp: number;
  durationMs: number;
}

interface UseDrowsinessReturn {
  isDrowsy: boolean; // True on CRITICAL (kept for backward compatibility with existing UI)
  alertLevel: AlertLevel;
  drowsinessScore: number; // 0-100
  currentEAR: number;
  currentMAR: number;
  isYawning: boolean;
  yawnCount: number;
  isMicrosleep: boolean;
  isDistracted: boolean; // Looking away too long
  facePresence: FacePresenceState;
  blinkRate: number; // blinks per minute (rolling 60s)
  avgBlinkDurationMs: number;
  isCalibrating: boolean;
  startCalibration: () => void;
  stopCalibration: () => void;
  calibrationProgress: number;
  resetState: () => void;
}

export const useDrowsiness = (landmarks: any[]): UseDrowsinessReturn => {
  const { calibration, updateCalibration, settings } = useAppContext();
  const { presence: facePresence } = useFacePresence(landmarks);

  const [alertLevel, setAlertLevel] = useState<AlertLevel>('NONE');
  const [drowsinessScore, setDrowsinessScore] = useState(0);
  const [currentEAR, setCurrentEAR] = useState(0);
  const [currentMAR, setCurrentMAR] = useState(0);
  const [isYawning, setIsYawning] = useState(false);
  const [yawnCount, setYawnCount] = useState(0);
  const [isMicrosleep, setIsMicrosleep] = useState(false);
  const [isDistracted, setIsDistracted] = useState(false);
  const [blinkRate, setBlinkRate] = useState(0);
  const [avgBlinkDurationMs, setAvgBlinkDurationMs] = useState(0);

  // Calibration state
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const calibrationEARRef = useRef<number[]>([]);
  const calibrationYawRef = useRef<number[]>([]);
  const calibrationPitchRef = useRef<number[]>([]);
  const calibrationBlinkEventsRef = useRef<BlinkStat[]>([]);
  const calibrationStartRef = useRef<number>(0);

  // Eye closure tracking
  const closedSinceRef = useRef<number | null>(null);
  const eyesClosedLatchedRef = useRef(false); // Hysteresis latch between close/open thresholds
  const closureIntervalsRef = useRef<ClosureInterval[]>([]);
  const monitoringStartRef = useRef<number>(Date.now());

  // Head pose tracking
  const lookAwaySinceRef = useRef<number | null>(null);
  const nodEventsRef = useRef<number[]>([]);
  const lastPitchRef = useRef<number | null>(null);

  // Yawn tracking
  const mouthOpenFramesRef = useRef(0);
  const yawnRegisteredRef = useRef(false);
  const yawnTimestampsRef = useRef<number[]>([]);

  // Alert hysteresis
  const alertLevelRef = useRef<AlertLevel>('NONE');
  const belowLevelSinceRef = useRef<number | null>(null);

  const processFrame = useCallback(() => {
    // No face this frame: don't update closure/yaw tracking with stale data.
    // The face-presence hook handles the "driver not visible" state; here we
    // just avoid corrupting statistics with a frozen last-known landmark set.
    if (!landmarks || landmarks.length === 0) {
      closedSinceRef.current = null;
      lookAwaySinceRef.current = null;
      return;
    }

    const now = Date.now();

    // --- Eye Aspect Ratio ---
    const leftEyePoints = LEFT_EYE_INDICES.map(i => landmarks[i]);
    const rightEyePoints = RIGHT_EYE_INDICES.map(i => landmarks[i]);
    const leftEAR = calculateEAR(leftEyePoints);
    const rightEAR = calculateEAR(rightEyePoints);
    const avgEAR = (leftEAR + rightEAR) / 2;
    setCurrentEAR(avgEAR);

    // --- Mouth Aspect Ratio / Yawn ---
    const mouthPoints = MOUTH_INDICES.map(i => landmarks[i]);
    const mar = calculateMAR(mouthPoints);
    setCurrentMAR(mar);

    // --- Head pose ---
    const { yaw, pitch } = estimateHeadPose(landmarks);
    const isLookingAway = Math.abs(yaw) > YAW_GATE_THRESHOLD;

    // Calibration: capture baseline EAR, head pose, and blink stats while the
    // driver looks naturally at the camera for a few seconds.
    if (isCalibrating) {
      calibrationEARRef.current.push(avgEAR);
      calibrationYawRef.current.push(yaw);
      calibrationPitchRef.current.push(pitch);

      const elapsed = now - calibrationStartRef.current;
      setCalibrationProgress(Math.min(100, (elapsed / 5000) * 100));

      // Track blinks during calibration too, so we get a real personal baseline.
      trackClosureForCalibration(avgEAR, now);

      if (elapsed >= 5000) {
        finishCalibration();
      }
      return;
    }

    // Pitch extremes (looking at dashboard / ceiling) also crush EAR geometry.
    const pitchDelta = Math.abs(pitch - calibration.baselinePitch);
    const poseUnreliable = isLookingAway || pitchDelta > PITCH_GATE_DELTA;

    if (poseUnreliable) {
      // Suspend eye-closure tracking while pose distorts EAR; don't score as closed.
      closedSinceRef.current = null;
      eyesClosedLatchedRef.current = false;
      if (isLookingAway) {
        if (lookAwaySinceRef.current === null) lookAwaySinceRef.current = now;
        setIsDistracted(now - lookAwaySinceRef.current > LOOK_AWAY_DISTRACTION_MS);
      } else {
        lookAwaySinceRef.current = null;
        setIsDistracted(false);
      }
    } else {
      lookAwaySinceRef.current = null;
      setIsDistracted(false);
      updateClosureTracking(leftEAR, rightEAR, now);
    }

    // --- Head nod detection ---
    // A sudden dip below the calibrated neutral pitch (head drops, then the
    // dataset below decays it out after NOD_WINDOW_MS) is a strong acute
    // drowsiness signal independent of eye state.
    if (!isLookingAway) {
      const pitchDelta = pitch - calibration.baselinePitch;
      const prevPitch = lastPitchRef.current;
      if (
        pitchDelta > NOD_PITCH_DELTA &&
        prevPitch !== null &&
        pitch - prevPitch > NOD_PITCH_DELTA * 0.5
      ) {
        nodEventsRef.current.push(now);
      }
      lastPitchRef.current = pitch;
    }
    nodEventsRef.current = nodEventsRef.current.filter(t => now - t < NOD_WINDOW_MS);

    // --- Yawn detection (gated: don't misread talking-while-turned as a yawn) ---
    if (!isLookingAway && mar > YAWN_MAR_THRESHOLD) {
      mouthOpenFramesRef.current += 1;
      if (mouthOpenFramesRef.current >= YAWN_FRAMES_THRESHOLD && !yawnRegisteredRef.current) {
        yawnRegisteredRef.current = true;
        yawnTimestampsRef.current.push(now);
        setYawnCount(prev => prev + 1);
      }
    } else {
      mouthOpenFramesRef.current = 0;
      yawnRegisteredRef.current = false;
    }
    setIsYawning(yawnRegisteredRef.current);
    yawnTimestampsRef.current = yawnTimestampsRef.current.filter(t => now - t < YAWN_MEMORY_MS);

    // --- Prune closure history & compute stats ---
    closureIntervalsRef.current = closureIntervalsRef.current.filter(
      iv => now - iv.end < PERCLOS_WINDOW_MS
    );

    const activeMicrosleep =
      closedSinceRef.current !== null && now - closedSinceRef.current >= MICROSLEEP_MS;
    setIsMicrosleep(activeMicrosleep);

    computeScoreAndLevel(now, activeMicrosleep);
  }, [landmarks, isCalibrating, calibration.baselinePitch, calibration.threshold, settings.sensitivity]);

  // Finalizes/creates closure intervals based on real-time EAR vs threshold.
  // Requires BOTH eyes below the close threshold (avoids one-eye landmark noise),
  // and uses hysteresis so noisy EAR near the boundary doesn't keep "closed" latched.
  const updateClosureTracking = (leftEAR: number, rightEAR: number, now: number) => {
    const closeAt = calibration.threshold;
    const openAt = Math.min(
      EAR_THRESHOLD_MAX * 1.15,
      Math.max(closeAt * (EAR_OPEN_RATIO / EAR_CLOSED_RATIO), closeAt + 0.03)
    );

    let isClosed = eyesClosedLatchedRef.current;
    if (!eyesClosedLatchedRef.current) {
      isClosed = leftEAR < closeAt && rightEAR < closeAt;
    } else {
      // Stay closed until both eyes clearly reopen above the higher open threshold.
      isClosed = !(leftEAR > openAt && rightEAR > openAt);
    }
    eyesClosedLatchedRef.current = isClosed;

    if (isClosed) {
      if (closedSinceRef.current === null) {
        closedSinceRef.current = now;
        closureIntervalsRef.current.push({ start: now, end: now, type: 'blink' });
      } else {
        const duration = now - closedSinceRef.current;
        const current = closureIntervalsRef.current[closureIntervalsRef.current.length - 1];
        if (current) {
          current.end = now;
          current.type = duration >= MICROSLEEP_MS ? 'microsleep' : duration >= BLINK_MAX_MS ? 'droop' : 'blink';
        }
      }
    } else if (closedSinceRef.current !== null) {
      const duration = now - closedSinceRef.current;
      const current = closureIntervalsRef.current[closureIntervalsRef.current.length - 1];
      if (current) {
        current.end = now;
        current.type = duration >= MICROSLEEP_MS ? 'microsleep' : duration >= BLINK_MAX_MS ? 'droop' : 'blink';
      }
      closedSinceRef.current = null;
    }
  };

  const trackClosureForCalibration = (avgEAR: number, now: number) => {
    // Reuses the same duration-based classification during calibration so we
    // learn the user's real blink cadence, not just their open-eye EAR.
    const provisionalThreshold = calibrationEARRef.current.length > 5
      ? deriveClosedThreshold(
          calibrationEARRef.current.reduce((a, b) => a + b, 0) / calibrationEARRef.current.length
        )
      : 0.18;
    const isClosed = avgEAR < provisionalThreshold;

    if (isClosed && closedSinceRef.current === null) {
      closedSinceRef.current = now;
    } else if (!isClosed && closedSinceRef.current !== null) {
      const duration = now - closedSinceRef.current;
      if (duration < BLINK_MAX_MS) {
        calibrationBlinkEventsRef.current.push({ timestamp: now, durationMs: duration });
      }
      closedSinceRef.current = null;
    }
  };

  const computeScoreAndLevel = (now: number, activeMicrosleep: boolean) => {
    // 1. PERCLOS: time-based %, counting only droops + microsleeps (not blinks)
    const closedMs = closureIntervalsRef.current.reduce((sum, iv) => {
      if (iv.type === 'blink') return sum;
      const end = iv.end === iv.start ? now : iv.end; // ongoing interval
      return sum + Math.max(0, end - iv.start);
    }, 0);
    const windowMs = Math.min(PERCLOS_WINDOW_MS, now - monitoringStartRef.current);
    const perclos = Math.min(1, closedMs / Math.max(windowMs, 1000));

    // 2. Blink rate & duration (deviation from personal baseline)
    const recentBlinks = closureIntervalsRef.current.filter(
      iv => iv.type === 'blink' && now - iv.end < BLINK_STATS_WINDOW_MS && iv.end > iv.start
    );
    const currentBlinkRate = recentBlinks.length; // window is 60s, so count == per-minute rate
    const currentAvgBlinkDuration = recentBlinks.length
      ? recentBlinks.reduce((sum, iv) => sum + (iv.end - iv.start), 0) / recentBlinks.length
      : calibration.baselineBlinkDurationMs;
    setBlinkRate(currentBlinkRate);
    setAvgBlinkDurationMs(currentAvgBlinkDuration);

    const blinkDurationScore = clamp01(
      (currentAvgBlinkDuration - calibration.baselineBlinkDurationMs) / 300
    );
    // Fatigue widens blink rate away from baseline in either direction (slower AND micro-fluttering)
    const blinkRateScore = clamp01(
      Math.abs(currentBlinkRate - calibration.baselineBlinkRate) / (calibration.baselineBlinkRate || 15)
    );

    // 3. Yawn frequency, decayed by recency within the 10-minute window
    const yawnScore = clamp01(
      yawnTimestampsRef.current.reduce((sum, t) => {
        const age = now - t;
        const decay = Math.max(0, 1 - age / YAWN_MEMORY_MS);
        return sum + 0.4 * decay; // ~2-3 yawns saturates this signal
      }, 0)
    );

    // 4. Head nods in the last minute
    const nodScore = clamp01(nodEventsRef.current.length / 3);

    let score =
      (perclos * WEIGHT_PERCLOS +
        blinkDurationScore * WEIGHT_BLINK_DURATION +
        blinkRateScore * WEIGHT_BLINK_RATE +
        yawnScore * WEIGHT_YAWN +
        nodScore * WEIGHT_NOD) *
      100;

    // Sensitivity setting shifts the whole curve rather than a single cutoff.
    // sensitivity=0.5 (default) is neutral; higher sensitivity amplifies the
    // score so alerts trigger earlier, lower sensitivity dampens it.
    score = score * (0.5 + settings.sensitivity);

    if (activeMicrosleep) {
      score = 100; // Immediate override: eyes have been shut too long, no ambiguity
    }

    score = Math.min(100, Math.max(0, score));
    setDrowsinessScore(score);
    updateAlertLevel(score, now);
  };

  const updateAlertLevel = (score: number, now: number) => {
    const currentLevel = alertLevelRef.current;
    const currentIdx = LEVEL_THRESHOLDS.findIndex(l => l.level === currentLevel);

    // Escalate immediately - no reason to delay warning the driver.
    const targetLevel = LEVEL_THRESHOLDS.find(l => score >= l.enter)?.level ?? 'NONE';
    const targetIdx = LEVEL_THRESHOLDS.findIndex(l => l.level === targetLevel);

    if (targetIdx < currentIdx) {
      // More severe (lower index = more severe here since sorted CRITICAL->NONE)
      alertLevelRef.current = targetLevel;
      setAlertLevel(targetLevel);
      belowLevelSinceRef.current = null;
      return;
    }

    if (targetIdx > currentIdx) {
      // Would de-escalate: require the score to stay comfortably below the
      // current level's entry point for a bit before actually downgrading,
      // so the alert doesn't flicker at the boundary.
      const currentEntry = LEVEL_THRESHOLDS[currentIdx]?.enter ?? 0;
      if (score < currentEntry - DOWNGRADE_HYSTERESIS) {
        if (belowLevelSinceRef.current === null) {
          belowLevelSinceRef.current = now;
        } else if (now - belowLevelSinceRef.current >= DOWNGRADE_STABLE_MS) {
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

    // Prefer open-eye EAR: use upper-half median so blinks during calibration
    // don't pull the baseline (and thus the closed threshold) downward incorrectly.
    const baselineEAR = openEyeBaseline(earSamples);
    const avgYaw = average(calibrationYawRef.current);
    const avgPitch = average(calibrationPitchRef.current);

    const calibrationDurationMin = (Date.now() - calibrationStartRef.current) / 60_000;
    const blinkEvents = calibrationBlinkEventsRef.current;
    const baselineBlinkRate = calibrationDurationMin > 0
      ? Math.max(6, blinkEvents.length / calibrationDurationMin)
      : 17;
    const baselineBlinkDurationMs = blinkEvents.length
      ? blinkEvents.reduce((sum, b) => sum + b.durationMs, 0) / blinkEvents.length
      : 250;

    updateCalibration({
      baselineEAR,
      threshold: deriveClosedThreshold(baselineEAR),
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
    closedSinceRef.current = null;
    eyesClosedLatchedRef.current = false;
    monitoringStartRef.current = Date.now();
    mouthOpenFramesRef.current = 0;
    yawnRegisteredRef.current = false;
    yawnTimestampsRef.current = [];
    nodEventsRef.current = [];
    lastPitchRef.current = null;
    setIsYawning(false);
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
const average = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/** Closed-eye threshold from open-eye baseline, clamped to a sane absolute range. */
export const deriveClosedThreshold = (baselineEAR: number): number => {
  const ratioBased = baselineEAR * EAR_CLOSED_RATIO;
  return Math.min(EAR_THRESHOLD_MAX, Math.max(EAR_THRESHOLD_MIN, ratioBased));
};

/** Median of the upper half of samples ≈ open-eye EAR (blinks live in the lower half). */
const openEyeBaseline = (samples: number[]): number => {
  if (samples.length === 0) return 0.3;
  const sorted = [...samples].sort((a, b) => a - b);
  const upper = sorted.slice(Math.floor(sorted.length / 2));
  const mid = Math.floor(upper.length / 2);
  return upper.length % 2 === 0
    ? (upper[mid - 1] + upper[mid]) / 2
    : upper[mid];
};
