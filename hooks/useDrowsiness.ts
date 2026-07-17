import { useState, useEffect, useCallback, useRef } from 'react';
import { calculateEAR, calculateMAR } from '../utils/math';
import { useAppContext } from '../context/AppContext';

// Indices for MediaPipe Face Mesh
// Left Eye: [33, 160, 158, 133, 153, 144] (approximate for EAR)
// Right Eye: [362, 385, 387, 263, 373, 380]
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];
// Mouth (inner lips) ordered as [left_corner, top1, top2, right_corner, bottom2, bottom1]
// so MAR uses the same formula as EAR: verticals (81-178, 311-402) over horizontal (61-291)
const MOUTH_INDICES = [61, 81, 311, 291, 402, 178];

// Yawn detection tuning
const YAWN_MAR_THRESHOLD = 0.6; // Mouth considered wide open above this
const YAWN_FRAMES_THRESHOLD = 20; // ~0.7-1s sustained open mouth = yawn (talking is shorter)
const YAWN_MEMORY_MS = 60_000; // Recent yawns contribute to the drowsiness score
const YAWN_SCORE_BOOST = 15; // Score points per recent yawn
const YAWN_SCORE_BOOST_MAX = 30;

interface UseDrowsinessReturn {
  isDrowsy: boolean;
  drowsinessScore: number; // 0-100
  currentEAR: number;
  currentMAR: number;
  isYawning: boolean;
  yawnCount: number;
  isCalibrating: boolean;
  startCalibration: () => void;
  stopCalibration: () => void;
  calibrationProgress: number;
  resetState: () => void;
}

export const useDrowsiness = (landmarks: any[]): UseDrowsinessReturn => {
  const { calibration, updateCalibration, settings } = useAppContext();
  
  const [isDrowsy, setIsDrowsy] = useState(false);
  const [drowsinessScore, setDrowsinessScore] = useState(0);
  const [currentEAR, setCurrentEAR] = useState(0);
  const [currentMAR, setCurrentMAR] = useState(0);
  const [isYawning, setIsYawning] = useState(false);
  const [yawnCount, setYawnCount] = useState(0);
  
  // Calibration state
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationBuffer, setCalibrationBuffer] = useState<number[]>([]);
  const [calibrationProgress, setCalibrationProgress] = useState(0);

  // Detection state
  const historyRef = useRef<boolean[]>([]); // true = closed, false = open
  const HISTORY_SIZE = 150; // Approx 5-10 seconds at 15-30fps
  const CONSECUTIVE_FRAMES_THRESHOLD = 15; // Frames below threshold to trigger instant alert
  const consecutiveClosedRef = useRef(0);

  // Yawn state
  const mouthOpenFramesRef = useRef(0);
  const yawnRegisteredRef = useRef(false); // Prevents counting one long yawn multiple times
  const yawnTimestampsRef = useRef<number[]>([]);

  const processFrame = useCallback(() => {
    if (!landmarks || landmarks.length === 0) return;

    // Extract eye points
    const leftEyePoints = LEFT_EYE_INDICES.map(i => landmarks[i]);
    const rightEyePoints = RIGHT_EYE_INDICES.map(i => landmarks[i]);

    const leftEAR = calculateEAR(leftEyePoints);
    const rightEAR = calculateEAR(rightEyePoints);
    const avgEAR = (leftEAR + rightEAR) / 2;

    setCurrentEAR(avgEAR);

    // Yawn detection (MAR)
    const mouthPoints = MOUTH_INDICES.map(i => landmarks[i]);
    const mar = calculateMAR(mouthPoints);
    setCurrentMAR(mar);

    if (mar > YAWN_MAR_THRESHOLD) {
      mouthOpenFramesRef.current += 1;
      if (mouthOpenFramesRef.current >= YAWN_FRAMES_THRESHOLD && !yawnRegisteredRef.current) {
        yawnRegisteredRef.current = true;
        yawnTimestampsRef.current.push(Date.now());
        setYawnCount(prev => prev + 1);
      }
    } else {
      mouthOpenFramesRef.current = 0;
      yawnRegisteredRef.current = false;
    }
    setIsYawning(yawnRegisteredRef.current);

    // Keep only recent yawns for scoring
    const now = Date.now();
    yawnTimestampsRef.current = yawnTimestampsRef.current.filter(t => now - t < YAWN_MEMORY_MS);

    // Calibration Logic
    if (isCalibrating) {
      setCalibrationBuffer(prev => [...prev, avgEAR]);
      // Assuming calibration takes ~150 frames (approx 5s at 30fps)
      setCalibrationProgress(Math.min(100, (calibrationBuffer.length / 150) * 100));
      
      if (calibrationBuffer.length >= 150) {
        finishCalibration();
      }
      return;
    }

    // Detection Logic
    const threshold = calibration.threshold;
    const isClosed = avgEAR < threshold;

    // Update history for PERCLOS
    historyRef.current.push(isClosed);
    if (historyRef.current.length > HISTORY_SIZE) {
      historyRef.current.shift();
    }

    // Check consecutive frames (Micro-sleep detection)
    if (isClosed) {
      consecutiveClosedRef.current += 1;
    } else {
      consecutiveClosedRef.current = 0;
    }

    // Calculate Score
    // 1. PERCLOS score
    const closedCount = historyRef.current.filter(c => c).length;
    const perclos = closedCount / historyRef.current.length;
    
    // 2. Consecutive score
    const consecutiveScore = Math.min(1, consecutiveClosedRef.current / 45); // Max out at ~1.5s

    // Combined score (0-100)
    // Weight PERCLOS heavily, but let consecutive frames spike it
    let score = (perclos * 0.7 + consecutiveScore * 0.3) * 100;

    // Recent yawns are an early fatigue signal: add a capped boost
    const yawnBoost = Math.min(
      YAWN_SCORE_BOOST_MAX,
      yawnTimestampsRef.current.length * YAWN_SCORE_BOOST
    );
    score = Math.min(100, score + yawnBoost);

    // Boost score if consecutive frames are high (immediate danger)
    if (consecutiveClosedRef.current > CONSECUTIVE_FRAMES_THRESHOLD) {
      score = 100;
    }

    setDrowsinessScore(score);
    setIsDrowsy(score > (50 * settings.sensitivity)); // Sensitivity adjusts trigger point

  }, [landmarks, isCalibrating, calibrationBuffer, calibration.threshold, settings.sensitivity]);

  useEffect(() => {
    processFrame();
  }, [processFrame]);

  const startCalibration = () => {
    setIsCalibrating(true);
    setCalibrationBuffer([]);
    setCalibrationProgress(0);
  };

  const stopCalibration = () => {
    setIsCalibrating(false);
    setCalibrationBuffer([]);
    setCalibrationProgress(0);
  };

  const finishCalibration = () => {
    if (calibrationBuffer.length === 0) return;
    
    // Calculate average open eye EAR
    const sum = calibrationBuffer.reduce((a, b) => a + b, 0);
    const avg = sum / calibrationBuffer.length;
    
    // Set threshold to 80% of baseline (heuristic)
    const newThreshold = avg * 0.8;
    
    updateCalibration({
      baselineEAR: avg,
      threshold: newThreshold,
      isCalibrated: true
    });
    
    stopCalibration();
  };

  const resetState = () => {
    setIsDrowsy(false);
    setDrowsinessScore(0);
    historyRef.current = [];
    consecutiveClosedRef.current = 0;
    mouthOpenFramesRef.current = 0;
    yawnRegisteredRef.current = false;
    yawnTimestampsRef.current = [];
    setIsYawning(false);
  };

  return {
    isDrowsy,
    drowsinessScore,
    currentEAR,
    currentMAR,
    isYawning,
    yawnCount,
    isCalibrating,
    startCalibration,
    stopCalibration,
    calibrationProgress,
    resetState
  };
};
