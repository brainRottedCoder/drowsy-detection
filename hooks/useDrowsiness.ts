import { useState, useEffect, useCallback, useRef } from 'react';
import { calculateEAR, calculateMAR, estimateHeadPose } from '../utils/math';
import { useAppContext } from '../context/AppContext';
import { useFacePresence, FacePresenceState } from './useFacePresence';
import {
  CalibrationPhase,
  CalibrationPreview,
  MIN_CALIBRATION_BLINKS,
  MIN_CLOSED_FRAMES,
  MIN_OPEN_FRAMES,
  PHASE_MAX_MS,
  buildCalibrationPreview,
  deriveClosedThreshold,
  emptyCalibrationBuffers,
  nextPhase,
  previewToCalibrationData,
  type CalibrationSampleBuffers,
} from '../utils/calibration';

export { deriveClosedThreshold };

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
  yawnsPerMinute: number;
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
  calibrationPhase: CalibrationPhase;
  calibrationPhaseProgress: number;
  calibrationPhaseStartedAt: number | null;
  calibrationError: string | null;
  calibrationPreview: CalibrationPreview | null;
  confirmCalibration: () => void;
  retryCalibration: () => void;
  resetState: () => void;
}

const DEFAULT_BLINK_ENTER = 0.38;
const DEFAULT_BLINK_EXIT = 0.22;
const MIN_BLINK_MS = 0;
const DEFAULT_BLINK_MAX_MS = 550;
const PERCLOS_SCORE_WINDOW_MS = 20_000;
const CLOSURE_RAMP_GRACE_MS = 600;
const CLOSURE_RAMP_MS = 3800;

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
  const [yawnsPerMinute, setYawnsPerMinute] = useState(0);
  const [isYawnAlert, setIsYawnAlert] = useState(false);
  const [isMicrosleep, setIsMicrosleep] = useState(false);
  const [isDistracted, setIsDistracted] = useState(false);
  const [blinkRate, setBlinkRate] = useState(0);
  const [avgBlinkDurationMs, setAvgBlinkDurationMs] = useState(0);

  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationPhase, setCalibrationPhase] = useState<CalibrationPhase>('idle');
  const [calibrationPhaseProgress, setCalibrationPhaseProgress] = useState(0);
  const [calibrationPhaseStartedAt, setCalibrationPhaseStartedAt] = useState<number | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [calibrationPreview, setCalibrationPreview] = useState<CalibrationPreview | null>(null);

  const calibrationStartRef = useRef<number>(0);
  const phaseStartRef = useRef<number>(0);
  const buffersRef = useRef<CalibrationSampleBuffers>(emptyCalibrationBuffers());
  const skippedMouthRef = useRef(false);
  const calibrationPhaseRef = useRef<CalibrationPhase>('idle');
  const phaseBlinkCountRef = useRef(0);

  const closedSinceRef = useRef<number | null>(null);
  const bothEyesClosedSinceRef = useRef<number | null>(null);
  const eyesClosedLatchedRef = useRef(false);
  const bothEyesClosedLatchedRef = useRef(false);
  const closureIntervalsRef = useRef<ClosureInterval[]>([]);
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

  const blinkEnter = calibration.blendshapeBlinkEnter ?? DEFAULT_BLINK_ENTER;
  const blinkExit = calibration.blendshapeBlinkExit ?? DEFAULT_BLINK_EXIT;

  const levelThresholds = (): { level: AlertLevel; enter: number }[] => [
    { level: 'CRITICAL', enter: clamp(levels.criticalEnter, 1, 100) },
    { level: 'WARNING', enter: clamp(levels.warningEnter, 1, 99) },
    { level: 'CAUTION', enter: clamp(levels.cautionEnter, 0, 98) },
    { level: 'NONE', enter: 0 },
  ];

  const setPhase = (phase: CalibrationPhase) => {
    calibrationPhaseRef.current = phase;
    setCalibrationPhase(phase);
    const started = Date.now();
    phaseStartRef.current = started;
    setCalibrationPhaseStartedAt(phase === 'idle' || phase === 'summary' ? null : started);
    setCalibrationPhaseProgress(0);
    if (phase === 'soft_blinks') {
      phaseBlinkCountRef.current = 0;
    }
  };

  const finalizeToSummary = useCallback(() => {
    skippedMouthRef.current = true;
    const preview = buildCalibrationPreview(buffersRef.current, d, {
      durationMs: Date.now() - calibrationStartRef.current,
      skippedMouth: true,
    });
    setCalibrationPreview(preview);
    if (!preview.gapOk) {
      setCalibrationError(preview.gapError ?? 'Calibration failed. Please retry.');
    } else {
      setCalibrationError(null);
    }
    setPhase('summary');
    setCalibrationProgress(100);
    setCalibrationPhaseProgress(100);
  }, [d]);

  const processCalibrationFrame = (
    now: number,
    leftEAR: number,
    rightEAR: number,
    avgEAR: number,
    mar: number,
    yaw: number,
    pitch: number,
    blinkMaxMs: number,
    microsleepMs: number
  ) => {
    const phase = calibrationPhaseRef.current;
    if (phase === 'idle' || phase === 'summary') return;

    if (facePresence !== 'PRESENT') {
      setCalibrationError('Return to camera — face not detected.');
      return;
    }
    if (calibrationError === 'Return to camera — face not detected.') {
      setCalibrationError(null);
    }

    const buf = buffersRef.current;
    const phaseElapsed = now - phaseStartRef.current;
    const maxMs = PHASE_MAX_MS[phase as keyof typeof PHASE_MAX_MS] ?? 5000;

    const eitherClosed = resolveEitherEyeClosed(leftEAR, rightEAR, blendshapes);
    const prevBlinkCount = buf.blinkEvents.length;
    trackBlinkSignal(eitherClosed, now, blinkMaxMs, microsleepMs, true);
    if (buf.blinkEvents.length > prevBlinkCount) {
      phaseBlinkCountRef.current += buf.blinkEvents.length - prevBlinkCount;
      const peak = Math.max(blendshapes.eyeBlinkLeft ?? 0, blendshapes.eyeBlinkRight ?? 0);
      if (peak > 0.2) buf.blendshapePeaks.push(peak);
    }
    trackBothEyesClosed(resolveBothEyesClosed(leftEAR, rightEAR, blendshapes), now);

    let ready = false;

    // Head pose is collected in the background during all eye phases.
    const sampleHeadPose = () => {
      buf.yaw.push(yaw);
      buf.pitch.push(pitch);
      if (Math.abs(yaw) < 0.1 && Math.abs(pitch) < 0.1) {
        buf.centerYaw.push(yaw);
        buf.centerPitch.push(pitch);
      }
    };

    switch (phase) {
      case 'setup':
        sampleHeadPose();
        ready = phaseElapsed >= maxMs;
        break;
      case 'open_eyes':
        buf.openEAR.push(avgEAR);
        buf.leftOpenEAR.push(leftEAR);
        buf.rightOpenEAR.push(rightEAR);
        sampleHeadPose();
        buf.marResting.push(mar);
        ready = buf.openEAR.length >= MIN_OPEN_FRAMES && phaseElapsed >= 3000;
        if (phaseElapsed >= maxMs && buf.openEAR.length >= Math.floor(MIN_OPEN_FRAMES * 0.6)) {
          ready = true;
        }
        break;
      case 'soft_blinks':
        buf.openEAR.push(avgEAR);
        sampleHeadPose();
        ready =
          phaseBlinkCountRef.current >= MIN_CALIBRATION_BLINKS && phaseElapsed >= 2500;
        if (phaseElapsed >= maxMs) ready = true;
        break;
      case 'closed_eyes':
        buf.closedEAR.push(avgEAR);
        sampleHeadPose();
        ready = buf.closedEAR.length >= MIN_CLOSED_FRAMES && phaseElapsed >= 2500;
        if (phaseElapsed >= maxMs && buf.closedEAR.length >= Math.floor(MIN_CLOSED_FRAMES * 0.6)) {
          ready = true;
        }
        break;
      default:
        break;
    }

    setCalibrationPhaseProgress(Math.min(100, (phaseElapsed / Math.max(maxMs, 1)) * 100));

    const livePhases = ['setup', 'open_eyes', 'soft_blinks', 'closed_eyes'] as const;
    const phaseIndex = livePhases.indexOf(phase as (typeof livePhases)[number]);
    const overall =
      phaseIndex < 0 ? 100 : ((phaseIndex + phaseElapsed / maxMs) / livePhases.length) * 100;
    setCalibrationProgress(Math.min(99, overall));

    if (!ready) return;

    if (phase === 'closed_eyes') {
      // Head pose already sampled in background during eye phases.
      finalizeToSummary();
      return;
    }

    const upcoming = nextPhase(phase);
    if (upcoming === 'summary') {
      finalizeToSummary();
    } else {
      setPhase(upcoming);
    }
  };

  const processFrame = useCallback(() => {
    if (!landmarks || landmarks.length === 0) {
      if (closedSinceRef.current !== null) {
        const now = Date.now();
        const blinkMaxMs = Math.max(100, d.blinkMaxMs);
        const microsleepMs = Math.max(blinkMaxMs + 100, d.microsleepMs);
        finalizeOpenEyes(now, blinkMaxMs, microsleepMs);
      }
      bothEyesClosedSinceRef.current = null;
      bothEyesClosedLatchedRef.current = false;
      setIsMicrosleep(false);
      lookAwaySinceRef.current = null;
      if (isCalibrating && calibrationPhaseRef.current !== 'summary' && calibrationPhaseRef.current !== 'idle') {
        setCalibrationError('Return to camera — face not detected.');
      }
      return;
    }

    const now = Date.now();
    const blinkMaxMs = Math.max(100, d.blinkMaxMs ?? DEFAULT_BLINK_MAX_MS);
    const microsleepMs = Math.max(blinkMaxMs + 100, d.microsleepMs);
    const perclosWindowMs = Math.max(5000, d.perclosWindowMs);
    const blinkStatsWindowMs = Math.max(5000, d.blinkStatsWindowMs);
    const yawGate = clamp(
      calibration.yawGateThreshold ?? d.yawGateThreshold,
      0.05,
      0.5
    );
    const pitchGate = clamp(
      calibration.pitchGateDelta ?? d.pitchGateDelta,
      0.05,
      0.5
    );
    const lookAwayMs = Math.max(1000, d.lookAwayDistractionMs);
    const yawnMar = clamp(
      calibration.yawnMarThreshold ?? d.yawnMarThreshold,
      0.2,
      1.2
    );
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
      processCalibrationFrame(
        now,
        leftEAR,
        rightEAR,
        avgEAR,
        mar,
        yaw,
        pitch,
        blinkMaxMs,
        microsleepMs
      );
      return;
    }

    const pitchDelta = Math.abs(pitch - calibration.baselinePitch);
    const poseUnreliable = isLookingAway || pitchDelta > pitchGate;

    const eitherEyeClosed = resolveEitherEyeClosed(leftEAR, rightEAR, blendshapes);
    const bothEyesClosed = resolveBothEyesClosed(leftEAR, rightEAR, blendshapes);
    trackBlinkSignal(eitherEyeClosed, now, blinkMaxMs, microsleepMs, false);
    trackBothEyesClosed(bothEyesClosed, now);

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

    const recentYawns = yawnTimestampsRef.current.filter(t => now - t < yawnAlertWindowMs);
    const recentYawnAlertCount = recentYawns.length;
    const ypm = (recentYawnAlertCount / yawnAlertWindowMs) * 60_000;
    setYawnsPerMinute(ypm);
    setIsYawnAlert(recentYawnAlertCount >= yawnAlertCount);

    closureIntervalsRef.current = closureIntervalsRef.current.filter(
      iv => now - iv.end < perclosWindowMs
    );

    const activeMicrosleep =
      !poseUnreliable &&
      bothEyesClosedSinceRef.current !== null &&
      now - bothEyesClosedSinceRef.current >= microsleepMs;
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
    facePresence,
    calibrationError,
    calibration.baselinePitch,
    calibration.baselineYaw,
    calibration.baselineEAR,
    calibration.baselineBlinkRate,
    calibration.baselineBlinkDurationMs,
    calibration.threshold,
    calibration.openThreshold,
    calibration.yawGateThreshold,
    calibration.pitchGateDelta,
    calibration.yawnMarThreshold,
    calibration.blendshapeBlinkEnter,
    calibration.blendshapeBlinkExit,
    settings.sensitivity,
    d,
    w,
    levels,
    finalizeToSummary,
  ]);

  const earCloseOpenThresholds = () => {
    const closeAt = Math.max(
      calibration.threshold || 0.18,
      (calibration.baselineEAR || 0.3) * 0.7
    );
    if (
      typeof calibration.openThreshold === 'number' &&
      Number.isFinite(calibration.openThreshold) &&
      (calibration.profileVersion ?? 0) >= 2
    ) {
      return {
        closeAt,
        openAt: Math.max(closeAt + 0.02, calibration.openThreshold),
      };
    }
    return { closeAt, openAt: closeAt + 0.04 };
  };

  const isEyeClosed = (
    ear: number,
    blink: number | undefined,
    latched: boolean,
    closeAt: number,
    openAt: number,
    mode: 'loose' | 'strict'
  ): boolean => {
    const byEar = latched ? ear <= openAt : ear < closeAt;
    if (typeof blink !== 'number') return byEar;
    const byBlink = latched ? blink > blinkExit : blink >= blinkEnter;
    if (mode === 'loose') return byBlink || byEar;
    if (latched) {
      return blink > blinkExit && (byEar || blink > 0.45);
    }
    return blink >= blinkEnter || (byEar && blink >= 0.28);
  };

  const resolveEitherEyeClosed = (
    leftEAR: number,
    rightEAR: number,
    shapes: Record<string, number>
  ): boolean => {
    const { closeAt, openAt } = earCloseOpenThresholds();
    const latched = eyesClosedLatchedRef.current;
    return (
      isEyeClosed(leftEAR, shapes.eyeBlinkLeft, latched, closeAt, openAt, 'loose') ||
      isEyeClosed(rightEAR, shapes.eyeBlinkRight, latched, closeAt, openAt, 'loose')
    );
  };

  const resolveBothEyesClosed = (
    leftEAR: number,
    rightEAR: number,
    shapes: Record<string, number>
  ): boolean => {
    const { closeAt, openAt } = earCloseOpenThresholds();
    const latched = bothEyesClosedLatchedRef.current;
    return (
      isEyeClosed(leftEAR, shapes.eyeBlinkLeft, latched, closeAt, openAt, 'strict') &&
      isEyeClosed(rightEAR, shapes.eyeBlinkRight, latched, closeAt, openAt, 'strict')
    );
  };

  const trackBothEyesClosed = (bothClosed: boolean, now: number) => {
    bothEyesClosedLatchedRef.current = bothClosed;
    if (bothClosed) {
      if (bothEyesClosedSinceRef.current === null) {
        bothEyesClosedSinceRef.current = now;
      }
    } else {
      bothEyesClosedSinceRef.current = null;
    }
  };

  const classifyClosure = (
    durationMs: number,
    blinkMaxMs: number,
    microsleepMs: number
  ): ClosureInterval['type'] => {
    if (durationMs >= microsleepMs) return 'microsleep';
    if (durationMs >= blinkMaxMs) return 'droop';
    return 'blink';
  };

  const recordCompletedBlink = (
    now: number,
    durationMs: number,
    blinkMaxMs: number,
    forCalibration: boolean
  ) => {
    if (durationMs < MIN_BLINK_MS || durationMs >= blinkMaxMs) return;
    if (forCalibration) {
      buffersRef.current.blinkEvents.push({ durationMs: Math.max(durationMs, 1) });
      return;
    }
    blinkEventsRef.current.push({ timestamp: now, durationMs: Math.max(durationMs, 1) });
    refreshBlinkRate(now);
  };

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
    const intervals = closureIntervalsRef.current;
    const activeIdx = closedSinceRef.current !== null ? intervals.length - 1 : -1;

    const closedMs = intervals.reduce((sum, iv, idx) => {
      const isActive = idx === activeIdx;
      if (iv.type === 'blink' && !isActive) return sum;
      const end = isActive ? now : iv.end === iv.start ? now : iv.end;
      return sum + Math.max(0, end - iv.start);
    }, 0);

    const scoreWindowMs = Math.min(PERCLOS_SCORE_WINDOW_MS, windows.perclosWindowMs);
    const windowMs = Math.min(scoreWindowMs, Math.max(1000, now - monitoringStartRef.current));
    const perclos = Math.min(1, closedMs / windowMs);

    refreshBlinkRate(now);

    const baselineEAR = calibration.baselineEAR || 0.3;
    const rawEarScore = clamp01((baselineEAR - avgEAR) / Math.max(baselineEAR * 0.8, 0.05));
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

    const closedForMs =
      bothEyesClosedSinceRef.current !== null ? now - bothEyesClosedSinceRef.current : 0;
    const rampMs = Math.max(0, closedForMs - CLOSURE_RAMP_GRACE_MS);
    const closureScore = rampMs > 0 ? clamp01(rampMs / CLOSURE_RAMP_MS) : 0;

    let score =
      (perclos * clamp01(w.perclos) +
        earScore * clamp01(w.ear) +
        yawnScore * clamp01(w.yawn) +
        headPoseScore * clamp01(w.headPose)) *
      100;

    score = score * (0.5 + settings.sensitivity);

    if (closureScore > 0) {
      score = Math.max(score, closureScore * 90);
    }

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
    setCalibrationError(null);
    setCalibrationPreview(null);
    skippedMouthRef.current = false;
    buffersRef.current = emptyCalibrationBuffers();
    calibrationStartRef.current = Date.now();
    closedSinceRef.current = null;
    eyesClosedLatchedRef.current = false;
    bothEyesClosedSinceRef.current = null;
    bothEyesClosedLatchedRef.current = false;
    setPhase('setup');
  };

  const stopCalibration = () => {
    setIsCalibrating(false);
    setCalibrationProgress(0);
    setCalibrationPhaseProgress(0);
    setCalibrationPhaseStartedAt(null);
    setCalibrationError(null);
    setCalibrationPreview(null);
    calibrationPhaseRef.current = 'idle';
    setCalibrationPhase('idle');
    buffersRef.current = emptyCalibrationBuffers();
  };

  const confirmCalibration = () => {
    const preview = calibrationPreview;
    if (!preview || !preview.gapOk) return;
    updateCalibration(previewToCalibrationData(preview));
    stopCalibration();
  };

  const retryCalibration = () => {
    startCalibration();
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
    bothEyesClosedSinceRef.current = null;
    bothEyesClosedLatchedRef.current = false;
    monitoringStartRef.current = Date.now();
    mouthOpenFramesRef.current = 0;
    yawnRegisteredRef.current = false;
    yawnTimestampsRef.current = [];
    setYawnsPerMinute(0);
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
    yawnsPerMinute,
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
    calibrationPhase,
    calibrationPhaseProgress,
    calibrationPhaseStartedAt,
    calibrationError,
    calibrationPreview,
    confirmCalibration,
    retryCalibration,
    resetState,
  };
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
