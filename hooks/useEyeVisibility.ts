import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { createEyeVisibilityBackend } from './eyeVisibility/createBackend';
import type {
  EyeVisibilityDebugFlags,
  EyeVisibilityState,
  PerEyeVisibilityResult,
} from './eyeVisibility/types';

const SAMPLE_INTERVAL_MS = 400;
const SCORE_WINDOW = 6;

interface UseEyeVisibilityReturn extends PerEyeVisibilityResult {}

const UNKNOWN_DEBUG: EyeVisibilityDebugFlags = {
  irisInContour: false,
  eyeWidthOk: false,
  poseOk: false,
  earOk: false,
  geometryScore: 0,
  usedSecondaryOcclusion: false,
  relativeDarkness: 0,
  darkPixelRatio: 0,
  opacityScore: 0,
  eyeMedianLuma: 0,
  skinMedianLuma: 0,
};

function combineOverall(left: EyeVisibilityState, right: EyeVisibilityState): EyeVisibilityState {
  if (left === 'NOT_VISIBLE' || right === 'NOT_VISIBLE') return 'NOT_VISIBLE';
  if (left === 'UNKNOWN' || right === 'UNKNOWN') return 'UNKNOWN';
  return 'VISIBLE';
}

function stateToScore(state: EyeVisibilityState): number {
  if (state === 'NOT_VISIBLE') return 1;
  if (state === 'UNKNOWN') return 0.5;
  return 0;
}

function scoreToState(score: number, enter: number, exit: number, latched: boolean): EyeVisibilityState {
  // High score → NOT_VISIBLE; mid → UNKNOWN; low → VISIBLE
  if (latched) {
    if (score < exit) return score > 0.35 ? 'UNKNOWN' : 'VISIBLE';
    return 'NOT_VISIBLE';
  }
  if (score >= enter) return 'NOT_VISIBLE';
  if (score > 0.35) return 'UNKNOWN';
  return 'VISIBLE';
}

export const useEyeVisibility = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  landmarks: any[]
): UseEyeVisibilityReturn => {
  const { settings, calibration } = useAppContext();
  const detectionRef = useRef(settings.detection);
  detectionRef.current = settings.detection;
  const calibrationRef = useRef(calibration);
  calibrationRef.current = calibration;

  const backendRef = useRef(createEyeVisibilityBackend());
  const landmarksRef = useRef(landmarks);
  landmarksRef.current = landmarks;

  const leftHistoryRef = useRef<number[]>([]);
  const rightHistoryRef = useRef<number[]>([]);
  const leftLatchedRef = useRef(false);
  const rightLatchedRef = useRef(false);
  const notVisibleSinceRef = useRef<number | null>(null);
  const clearSinceRef = useRef<number | null>(null);

  const [left, setLeft] = useState<EyeVisibilityState>('UNKNOWN');
  const [right, setRight] = useState<EyeVisibilityState>('UNKNOWN');
  const [overall, setOverall] = useState<EyeVisibilityState>('UNKNOWN');
  const [confidence, setConfidence] = useState(0);
  const [eyesNotClearlyVisible, setEyesNotClearlyVisible] = useState(false);
  const [debug, setDebug] = useState<PerEyeVisibilityResult['debug']>(null);

  useEffect(() => {
    const sample = () => {
      const det = detectionRef.current;
      if (!det.eyeVisibilityEnabled) {
        setLeft('VISIBLE');
        setRight('VISIBLE');
        setOverall('VISIBLE');
        setConfidence(1);
        setEyesNotClearlyVisible(false);
        setDebug(null);
        leftLatchedRef.current = false;
        rightLatchedRef.current = false;
        notVisibleSinceRef.current = null;
        clearSinceRef.current = null;
        return;
      }

      const points = landmarksRef.current;
      const video = videoRef.current;
      const yawGate = Math.max(0.05, det.yawGateThreshold);
      const pitchGate = Math.max(0.05, det.pitchGateDelta);
      const baselinePitch = calibrationRef.current.baselinePitch || 0;

      if (!points || points.length === 0) {
        setLeft('UNKNOWN');
        setRight('UNKNOWN');
        setOverall('UNKNOWN');
        setConfidence(0);
        // Do not set eyesNotClearlyVisible for UNKNOWN / missing face
        setEyesNotClearlyVisible(false);
        notVisibleSinceRef.current = null;
        setDebug({ left: UNKNOWN_DEBUG, right: UNKNOWN_DEBUG });
        return;
      }

      const leftSample = backendRef.current.evaluate({
        video,
        landmarks: points,
        side: 'left',
        yawGate,
        pitchGate,
        baselinePitch,
      });
      const rightSample = backendRef.current.evaluate({
        video,
        landmarks: points,
        side: 'right',
        yawGate,
        pitchGate,
        baselinePitch,
      });

      // Support sync backend (Promise backends can be added later)
      const apply = (L: Awaited<typeof leftSample>, R: Awaited<typeof rightSample>) => {
        // Two moderately opaque eye crops are strong sunglasses evidence even
        // when each crop narrowly misses the strict per-eye threshold. Requiring
        // bilateral agreement protects naturally dark irises / clear glasses.
        const bilateralOpaque =
          L.debug.usedSecondaryOcclusion &&
          R.debug.usedSecondaryOcclusion &&
          L.debug.opacityScore >= 0.5 &&
          R.debug.opacityScore >= 0.5 &&
          L.debug.relativeDarkness >= 0.25 &&
          R.debug.relativeDarkness >= 0.25;
        const leftRawState = bilateralOpaque ? 'NOT_VISIBLE' : L.state;
        const rightRawState = bilateralOpaque ? 'NOT_VISIBLE' : R.state;

        leftHistoryRef.current.push(stateToScore(leftRawState));
        rightHistoryRef.current.push(stateToScore(rightRawState));
        if (leftHistoryRef.current.length > SCORE_WINDOW) leftHistoryRef.current.shift();
        if (rightHistoryRef.current.length > SCORE_WINDOW) rightHistoryRef.current.shift();

        const leftAvg =
          leftHistoryRef.current.reduce((a, b) => a + b, 0) / leftHistoryRef.current.length;
        const rightAvg =
          rightHistoryRef.current.reduce((a, b) => a + b, 0) / rightHistoryRef.current.length;

        // Map dwell ms to score thresholds (enter ~0.7, exit ~0.4 of smoothed 0–1)
        const enterScore = 0.7;
        const exitScore = 0.4;

        const leftState = scoreToState(leftAvg, enterScore, exitScore, leftLatchedRef.current);
        const rightState = scoreToState(rightAvg, enterScore, exitScore, rightLatchedRef.current);
        leftLatchedRef.current = leftState === 'NOT_VISIBLE';
        rightLatchedRef.current = rightState === 'NOT_VISIBLE';

        const nextOverall = combineOverall(leftState, rightState);
        const conf = (L.confidence + R.confidence) / 2;

        setLeft(leftState);
        setRight(rightState);
        setOverall(nextOverall);
        setConfidence(conf);
        setDebug({ left: L.debug, right: R.debug });

        const now = Date.now();
        const enterMs = Math.max(200, det.eyeVisibilityEnterMs);
        const exitMs = Math.max(100, det.eyeVisibilityExitMs);

        if (nextOverall === 'NOT_VISIBLE') {
          clearSinceRef.current = null;
          if (notVisibleSinceRef.current === null) notVisibleSinceRef.current = now;
          if (now - notVisibleSinceRef.current >= enterMs) {
            setEyesNotClearlyVisible(true);
          }
        } else {
          notVisibleSinceRef.current = null;
          if (clearSinceRef.current === null) clearSinceRef.current = now;
          if (now - clearSinceRef.current >= exitMs) {
            setEyesNotClearlyVisible(false);
          }
        }
      };

      Promise.resolve(leftSample).then(L => {
        Promise.resolve(rightSample).then(R => apply(L, R));
      });
    };

    const interval = setInterval(sample, SAMPLE_INTERVAL_MS);
    sample();
    return () => clearInterval(interval);
  }, [videoRef]);

  return {
    left,
    right,
    overall,
    confidence,
    eyesNotClearlyVisible,
    debug,
  };
};
