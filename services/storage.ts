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
  // Natural blinks are ~100–500ms; camera lag often stretches them past 400ms.
  blinkMaxMs: 550,
  microsleepMs: 2000,
  perclosWindowMs: 60_000,
  blinkStatsWindowMs: 60_000,
  // Slightly higher closed ratio → more sensitive blink capture after calibration.
  earClosedRatio: 0.60,
  earOpenRatio: 0.75,
  earThresholdMin: 0.12,
  earThresholdMax: 0.22,
  earScoreHistory: 8,
  yawGateThreshold: 0.18,
  pitchGateDelta: 0.14,
  lookAwayDistractionMs: 4000,
  headPoseScoreRange: 0.35,
  // Lower MAR / fewer frames = more sensitive yawn detection.
  // Closed ~0.0–0.1, talking ~0.3–0.45, yawning typically ≥ 0.45.
  yawnMarThreshold: 0.45,
  yawnFramesThreshold: 10,
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
  threshold: 0.18,
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
    const detection = { ...DEFAULT_DETECTION, ...(parsed.detection ?? {}) };

    // Migrate prior less-sensitive yawn defaults so existing installs pick up the change.
    if (detection.yawnMarThreshold >= 0.6) {
      detection.yawnMarThreshold = DEFAULT_DETECTION.yawnMarThreshold;
    }
    if (detection.yawnFramesThreshold >= 20) {
      detection.yawnFramesThreshold = DEFAULT_DETECTION.yawnFramesThreshold;
    }
    // Migrate older blink timing that under-counted natural blinks.
    if (detection.blinkMaxMs <= 400) {
      detection.blinkMaxMs = DEFAULT_DETECTION.blinkMaxMs;
    }
    if (detection.earClosedRatio <= 0.55) {
      detection.earClosedRatio = DEFAULT_DETECTION.earClosedRatio;
    }
    if (detection.earOpenRatio <= 0.70) {
      detection.earOpenRatio = DEFAULT_DETECTION.earOpenRatio;
    }

    const settings: UserSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      detection,
      scoreWeights: { ...DEFAULT_SCORE_WEIGHTS, ...(parsed.scoreWeights ?? {}) },
      alertLevels: { ...DEFAULT_ALERT_LEVELS, ...(parsed.alertLevels ?? {}) },
    };

    if (
      parsed.detection?.yawnMarThreshold !== detection.yawnMarThreshold ||
      parsed.detection?.yawnFramesThreshold !== detection.yawnFramesThreshold ||
      parsed.detection?.blinkMaxMs !== detection.blinkMaxMs ||
      parsed.detection?.earClosedRatio !== detection.earClosedRatio ||
      parsed.detection?.earOpenRatio !== detection.earOpenRatio
    ) {
      localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
    }

    return settings;
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

  if (parsed.threshold > 0.22) {
    const migrated = Math.min(0.22, Math.max(0.12, parsed.baselineEAR * 0.60));
    parsed.threshold = migrated;
    localStorage.setItem(KEYS.CALIBRATION, JSON.stringify(parsed));
  }

  return parsed;
};

export const getDefaultCalibration = (): CalibrationData => ({ ...DEFAULT_CALIBRATION });
