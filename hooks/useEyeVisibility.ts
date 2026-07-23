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
  onnxScore: null,
  onnxOpaque: null,
  eyeglassesProb: null,
  sunglassesProb: null,
  eyewearPartition: null,
  agree: null,
  onnxReady: false,
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

function scoreToState(
  score: number,
  enter: number,
  exit: number,
  latched: boolean
): EyeVisibilityState {
  if (latched) {
    if (score < exit) return score > 0.35 ? 'UNKNOWN' : 'VISIBLE';
    return 'NOT_VISIBLE';
  }
  if (score >= enter) return 'NOT_VISIBLE';
  if (score > 0.35) return 'UNKNOWN';
  return 'VISIBLE';
}

/**
 * Eyes-in-frame detector.
 * Uses fused landmark + ONNX backend. ONNX opaque (sunglasses) → not in frame.
 * Exposes one latched flag used by both Results Stats and alerts.
 */
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
  const sampleIdRef = useRef(0);

  const [left, setLeft] = useState<EyeVisibilityState>('UNKNOWN');
  const [right, setRight] = useState<EyeVisibilityState>('UNKNOWN');
  const [overall, setOverall] = useState<EyeVisibilityState>('UNKNOWN');
  const [confidence, setConfidence] = useState(0);
  const [eyesNotClearlyVisible, setEyesNotClearlyVisible] = useState(false);
  const [detectorReady, setDetectorReady] = useState(false);
  const [debug, setDebug] = useState<PerEyeVisibilityResult['debug']>(null);

  useEffect(() => {
    let cancelled = false;

    const sample = () => {
      const det = detectionRef.current;
      if (!det.eyeVisibilityEnabled) {
        setLeft('VISIBLE');
        setRight('VISIBLE');
        setOverall('VISIBLE');
        setConfidence(1);
        setEyesNotClearlyVisible(false);
        setDetectorReady(true);
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
        setEyesNotClearlyVisible(false);
        notVisibleSinceRef.current = null;
        setDebug({ left: UNKNOWN_DEBUG, right: UNKNOWN_DEBUG });
        return;
      }

      const sampleId = ++sampleIdRef.current;
      const inputBase = {
        video,
        landmarks: points,
        yawGate,
        pitchGate,
        baselinePitch,
      };

      Promise.all([
        Promise.resolve(
          backendRef.current.evaluate({ ...inputBase, side: 'left' })
        ),
        Promise.resolve(
          backendRef.current.evaluate({ ...inputBase, side: 'right' })
        ),
      ]).then(([L, R]) => {
        if (cancelled || sampleId !== sampleIdRef.current) return;

        const onnxReady = L.debug.onnxReady === true || R.debug.onnxReady === true;
        // Ready once we have a fused sample. ONNX may still warm up; fusion falls back to heuristic.
        setDetectorReady(true);

        // Face-level ONNX is shared; if either eye reports opaque, treat both blocked.
        const onnxOpaque =
          onnxReady && (L.debug.onnxOpaque === true || R.debug.onnxOpaque === true);

        const leftRaw = onnxOpaque ? 'NOT_VISIBLE' : L.state;
        const rightRaw = onnxOpaque ? 'NOT_VISIBLE' : R.state;

        leftHistoryRef.current.push(stateToScore(leftRaw));
        rightHistoryRef.current.push(stateToScore(rightRaw));
        if (leftHistoryRef.current.length > SCORE_WINDOW) leftHistoryRef.current.shift();
        if (rightHistoryRef.current.length > SCORE_WINDOW) rightHistoryRef.current.shift();

        const leftAvg =
          leftHistoryRef.current.reduce((a, b) => a + b, 0) / leftHistoryRef.current.length;
        const rightAvg =
          rightHistoryRef.current.reduce((a, b) => a + b, 0) / rightHistoryRef.current.length;

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
      });
    };

    const interval = setInterval(sample, SAMPLE_INTERVAL_MS);
    sample();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [videoRef]);

  return {
    left,
    right,
    overall,
    confidence,
    eyesNotClearlyVisible,
    eyesInFrame: !eyesNotClearlyVisible,
    detectorReady,
    debug,
  };
};
