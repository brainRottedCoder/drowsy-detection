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
  /** Minimum continuous open-mouth duration (ms) before a yawn is counted. Natural yawns are ~2–3s. */
  yawnMinDurationMs: number;
  /** @deprecated Prefer yawnMinDurationMs; kept for migrating older saved settings. */
  yawnFramesThreshold?: number;
  yawnMemoryMs: number;
  yawnAlertWindowMs: number;
  yawnAlertCount: number;
  // Burst drowsiness alert: N rising-edge crossings of score past threshold in a window
  scoreBurstThreshold: number;
  scoreBurstCount: number;
  scoreBurstWindowMs: number;
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
  /** Measured closed-eye EAR median (profile v2+). */
  closedEAR?: number;
  /** Re-open hysteresis threshold (profile v2+). */
  openThreshold?: number;
  leftBaselineEAR?: number;
  rightBaselineEAR?: number;
  /** Personal look-away yaw gate; overrides detection.yawGateThreshold when set. */
  yawGateThreshold?: number;
  /** Personal pitch gate delta; overrides detection.pitchGateDelta when set. */
  pitchGateDelta?: number;
  baselineMAR?: number;
  yawnMarThreshold?: number;
  blendshapeBlinkEnter?: number;
  blendshapeBlinkExit?: number;
  calibratedAt?: number;
  /** Schema version; guided face profile writes 2. */
  profileVersion?: number;
}

export const DEFAULT_DETECTION: DetectionSettings = {
  // Natural blinks are ~100–500ms; camera lag often stretches them past 400ms.
  blinkMaxMs: 550,
  microsleepMs: 5000,
  // Keep recent closures briefly; live score also caps at PERCLOS_SCORE_WINDOW_MS in the hook.
  perclosWindowMs: 15_000,
  blinkStatsWindowMs: 60_000,
  // Slightly higher closed ratio → more sensitive blink capture after calibration.
  earClosedRatio: 0.60,
  earOpenRatio: 0.75,
  earThresholdMin: 0.12,
  earThresholdMax: 0.22,
  // Shorter EAR average → score tracks open/closed eyes faster.
  earScoreHistory: 4,
  yawGateThreshold: 0.18,
  pitchGateDelta: 0.14,
  lookAwayDistractionMs: 4000,
  headPoseScoreRange: 0.35,
  // Closed ~0.0–0.1, talking ~0.3–0.45, yawning typically ≥ 0.55.
  yawnMarThreshold: 0.55,
  // Natural yawns last ~2–3s; require sustained open mouth before counting.
  yawnMinDurationMs: 2500,
  yawnMemoryMs: 10 * 60_000,
  yawnAlertWindowMs: 60_000,
  yawnAlertCount: 3,
  // Orange burst alert when score crosses this % N times within the window.
  scoreBurstThreshold: 60,
  scoreBurstCount: 4,
  scoreBurstWindowMs: 15_000,
  faceLostGraceMs: 1500,
  faceAbsentAfterMs: 12_000,
  eyeVisibilityEnabled: true,
  eyeVisibilityEnterMs: 1000,
  eyeVisibilityExitMs: 600,
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  perclos: 0.43,
  ear: 0.28,
  blinkRate: 0, // display-only; does not contribute to drowsiness score / alerts
  yawn: 0.17,
  headPose: 0.12,
};

export const DEFAULT_ALERT_LEVELS: AlertLevelSettings = {
  cautionEnter: 50,
  warningEnter: 70,
  criticalEnter: 85,
  downgradeHysteresis: 8,
  // Clear alerts sooner once eyes stay open / score drops.
  downgradeStableMs: 1000,
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

/** Merge + migrate detection settings (frame-based yawn → duration-based, etc.). */
export const normalizeDetectionSettings = (
  raw?: Partial<DetectionSettings> | null
): DetectionSettings => {
  const detection: DetectionSettings = {
    ...DEFAULT_DETECTION,
    ...(raw ?? {}),
  };

  if (detection.yawnMarThreshold >= 0.6 || detection.yawnMarThreshold <= 0.45) {
    detection.yawnMarThreshold = DEFAULT_DETECTION.yawnMarThreshold;
  }

  const legacyFrames = detection.yawnFramesThreshold;
  if (
    typeof detection.yawnMinDurationMs !== 'number' ||
    !Number.isFinite(detection.yawnMinDurationMs) ||
    detection.yawnMinDurationMs < 1500 ||
    (typeof legacyFrames === 'number' && legacyFrames > 0 && legacyFrames < 45)
  ) {
    detection.yawnMinDurationMs = DEFAULT_DETECTION.yawnMinDurationMs;
  }
  delete detection.yawnFramesThreshold;

  if (detection.blinkMaxMs <= 400) {
    detection.blinkMaxMs = DEFAULT_DETECTION.blinkMaxMs;
  }
  if (detection.earClosedRatio <= 0.55) {
    detection.earClosedRatio = DEFAULT_DETECTION.earClosedRatio;
  }
  if (detection.microsleepMs <= 5000) {
    detection.microsleepMs = DEFAULT_DETECTION.microsleepMs;
  }
  // Migrate older slow PERCLOS / EAR smoothing to the faster eye-tracking defaults.
  if (detection.perclosWindowMs === 60_000) {
    detection.perclosWindowMs = DEFAULT_DETECTION.perclosWindowMs;
  }
  if (detection.earScoreHistory === 8) {
    detection.earScoreHistory = DEFAULT_DETECTION.earScoreHistory;
  }

  return detection;
};

export const normalizeUserSettings = (raw?: Partial<UserSettings> | null): UserSettings => {
  const parsed = raw ?? {};
  const detection = normalizeDetectionSettings(parsed.detection);
  const alertLevels = { ...DEFAULT_ALERT_LEVELS, ...(parsed.alertLevels ?? {}) };

  if ((parsed.alertLevels?.cautionEnter ?? 30) <= 30) {
    alertLevels.cautionEnter = DEFAULT_ALERT_LEVELS.cautionEnter;
    if ((parsed.alertLevels?.warningEnter ?? 50) <= 50) {
      alertLevels.warningEnter = DEFAULT_ALERT_LEVELS.warningEnter;
    }
    if ((parsed.alertLevels?.criticalEnter ?? 75) <= 75) {
      alertLevels.criticalEnter = DEFAULT_ALERT_LEVELS.criticalEnter;
    }
  }
  if (parsed.alertLevels?.criticalEnter === 85) {
    alertLevels.criticalEnter = DEFAULT_ALERT_LEVELS.criticalEnter;
  }
  if (parsed.alertLevels?.downgradeStableMs === 2500) {
    alertLevels.downgradeStableMs = DEFAULT_ALERT_LEVELS.downgradeStableMs;
  }
  if (parsed.alertLevels?.downgradeHysteresis === 10) {
    alertLevels.downgradeHysteresis = DEFAULT_ALERT_LEVELS.downgradeHysteresis;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    detection,
    scoreWeights: { ...DEFAULT_SCORE_WEIGHTS, ...(parsed.scoreWeights ?? {}) },
    alertLevels,
  };
};

export const getSettings = (): UserSettings => {
  if (typeof window === 'undefined') return getDefaultSettings();
  const stored = localStorage.getItem(KEYS.SETTINGS);
  if (!stored) return getDefaultSettings();

  try {
    const parsed = JSON.parse(stored) as Partial<UserSettings>;
    const settings = normalizeUserSettings(parsed);

    if (
      parsed.detection?.yawnMarThreshold !== settings.detection.yawnMarThreshold ||
      parsed.detection?.yawnMinDurationMs !== settings.detection.yawnMinDurationMs ||
      parsed.detection?.yawnFramesThreshold != null ||
      parsed.detection?.blinkMaxMs !== settings.detection.blinkMaxMs ||
      parsed.detection?.earClosedRatio !== settings.detection.earClosedRatio ||
      parsed.detection?.earOpenRatio !== settings.detection.earOpenRatio ||
      parsed.detection?.microsleepMs !== settings.detection.microsleepMs ||
      parsed.alertLevels?.cautionEnter !== settings.alertLevels.cautionEnter ||
      parsed.alertLevels?.warningEnter !== settings.alertLevels.warningEnter ||
      parsed.alertLevels?.criticalEnter !== settings.alertLevels.criticalEnter
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
  if (typeof window === 'undefined') return getDefaultCalibration();
  const stored = localStorage.getItem(KEYS.CALIBRATION);
  if (!stored) return getDefaultCalibration();

  try {
    const parsed = { ...DEFAULT_CALIBRATION, ...JSON.parse(stored) } as CalibrationData;

    if (parsed.threshold > 0.22) {
      const migrated = Math.min(0.22, Math.max(0.12, parsed.baselineEAR * 0.60));
      parsed.threshold = migrated;
      localStorage.setItem(KEYS.CALIBRATION, JSON.stringify(parsed));
    }

    return parsed;
  } catch {
    return getDefaultCalibration();
  }
};

export const getDefaultCalibration = (): CalibrationData => ({ ...DEFAULT_CALIBRATION });
