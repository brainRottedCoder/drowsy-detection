// LocalStorage helpers

const KEYS = {
  SETTINGS: 'drowsy-settings',
  CALIBRATION: 'drowsy-calibration',
};

export interface DetectionSettings {
  // Eye closure
  blinkMaxMs: number;
  microsleepMs: number;
  perclosWindowMs: number;
  blinkStatsWindowMs: number;
  earClosedRatio: number;
  earOpenRatio: number;
  earThresholdMin: number;
  earThresholdMax: number;
  earScoreHistory: number;
  // Head / distraction
  yawGateThreshold: number;
  pitchGateDelta: number;
  lookAwayDistractionMs: number;
  headPoseScoreRange: number;
  // Yawn detection + multi-yawn alert
  yawnMarThreshold: number;
  yawnFramesThreshold: number;
  yawnMemoryMs: number;
  yawnAlertWindowMs: number;
  yawnAlertCount: number;
  // Face absence
  faceLostGraceMs: number;
  faceAbsentAfterMs: number;
  // Eye visibility (UI warning only — does not gate drowsiness scoring)
  eyeVisibilityEnabled: boolean;
  eyeVisibilityEnterMs: number;
  eyeVisibilityExitMs: number;
}

export interface ScoreWeights {
  perclos: number;
  ear: number;
  blinkRate: number;
  yawn: number;
  headPose: number;
}

export interface AlertLevelSettings {
  cautionEnter: number;
  warningEnter: number;
  criticalEnter: number;
  downgradeHysteresis: number;
  downgradeStableMs: number;
}

export interface UserSettings {
  sensitivity: number; // 0.0 to 1.0
  volume: number; // 0.0 to 1.0
  telemetryEnabled: boolean;
  deviceId: string;
  detection: DetectionSettings;
  scoreWeights: ScoreWeights;
  alertLevels: AlertLevelSettings;
}

export interface CalibrationData {
  baselineEAR: number;
  threshold: number;
  isCalibrated: boolean;
  baselineBlinkRate: number;
  baselineBlinkDurationMs: number;
  baselineYaw: number;
  baselinePitch: number;
}

export const DEFAULT_DETECTION: DetectionSettings = {
  blinkMaxMs: 400,
  microsleepMs: 2000,
  perclosWindowMs: 60_000,
  blinkStatsWindowMs: 60_000,
  earClosedRatio: 0.55,
  earOpenRatio: 0.70,
  earThresholdMin: 0.12,
  earThresholdMax: 0.20,
  earScoreHistory: 8,
  yawGateThreshold: 0.18,
  pitchGateDelta: 0.14,
  lookAwayDistractionMs: 4000,
  headPoseScoreRange: 0.35,
  yawnMarThreshold: 0.6,
  yawnFramesThreshold: 20,
  yawnMemoryMs: 10 * 60_000,
  yawnAlertWindowMs: 60_000,
  yawnAlertCount: 3,
  faceLostGraceMs: 1500,
  faceAbsentAfterMs: 12_000,
  eyeVisibilityEnabled: true,
  eyeVisibilityEnterMs: 1000,
  eyeVisibilityExitMs: 600,
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  perclos: 0.40,
  ear: 0.20,
  blinkRate: 0.15,
  yawn: 0.15,
  headPose: 0.10,
};

export const DEFAULT_ALERT_LEVELS: AlertLevelSettings = {
  cautionEnter: 30,
  warningEnter: 50,
  criticalEnter: 75,
  downgradeHysteresis: 10,
  downgradeStableMs: 2500,
};

const DEFAULT_SETTINGS: UserSettings = {
  sensitivity: 0.5,
  volume: 0.8,
  telemetryEnabled: false,
  deviceId: '',
  detection: { ...DEFAULT_DETECTION },
  scoreWeights: { ...DEFAULT_SCORE_WEIGHTS },
  alertLevels: { ...DEFAULT_ALERT_LEVELS },
};

const DEFAULT_CALIBRATION: CalibrationData = {
  baselineEAR: 0.30,
  threshold: 0.165,
  isCalibrated: false,
  baselineBlinkRate: 17,
  baselineBlinkDurationMs: 250,
  baselineYaw: 0,
  baselinePitch: 0,
};

export const getDefaultSettings = (): UserSettings => ({
  ...DEFAULT_SETTINGS,
  detection: { ...DEFAULT_DETECTION },
  scoreWeights: { ...DEFAULT_SCORE_WEIGHTS },
  alertLevels: { ...DEFAULT_ALERT_LEVELS },
});

export const saveSettings = (settings: UserSettings) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
};

export const getSettings = (): UserSettings => {
  if (typeof window === 'undefined') return getDefaultSettings();
  const stored = localStorage.getItem(KEYS.SETTINGS);
  if (!stored) return getDefaultSettings();

  try {
    const parsed = JSON.parse(stored) as Partial<UserSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      detection: { ...DEFAULT_DETECTION, ...(parsed.detection ?? {}) },
      scoreWeights: { ...DEFAULT_SCORE_WEIGHTS, ...(parsed.scoreWeights ?? {}) },
      alertLevels: { ...DEFAULT_ALERT_LEVELS, ...(parsed.alertLevels ?? {}) },
    };
  } catch {
    return getDefaultSettings();
  }
};

export const saveCalibration = (data: CalibrationData) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.CALIBRATION, JSON.stringify(data));
};

export const getCalibration = (): CalibrationData => {
  if (typeof window === 'undefined') return DEFAULT_CALIBRATION;
  const stored = localStorage.getItem(KEYS.CALIBRATION);
  if (!stored) return DEFAULT_CALIBRATION;

  const parsed = { ...DEFAULT_CALIBRATION, ...JSON.parse(stored) } as CalibrationData;

  if (parsed.threshold > 0.20) {
    const migrated = Math.min(0.20, Math.max(0.12, parsed.baselineEAR * 0.55));
    parsed.threshold = migrated;
    localStorage.setItem(KEYS.CALIBRATION, JSON.stringify(parsed));
  }

  return parsed;
};

export const getDefaultCalibration = (): CalibrationData => ({ ...DEFAULT_CALIBRATION });
