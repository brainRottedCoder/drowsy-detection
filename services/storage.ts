// LocalStorage helpers

const KEYS = {
  SETTINGS: 'drowsy-settings',
  CALIBRATION: 'drowsy-calibration',
};

export interface UserSettings {
  sensitivity: number; // 0.0 to 1.0
  volume: number; // 0.0 to 1.0
  telemetryEnabled: boolean;
  deviceId: string;
}

export interface CalibrationData {
  baselineEAR: number;
  threshold: number;
  isCalibrated: boolean;
  // Personal baselines captured during calibration, used to detect
  // *deviation* from this driver's normal behavior rather than absolute values.
  baselineBlinkRate: number; // blinks per minute
  baselineBlinkDurationMs: number;
  baselineYaw: number; // neutral head yaw when facing the camera
  baselinePitch: number; // neutral head pitch when facing the camera
}

const DEFAULT_SETTINGS: UserSettings = {
  sensitivity: 0.5,
  volume: 0.8,
  telemetryEnabled: false,
  deviceId: '',
};

const DEFAULT_CALIBRATION: CalibrationData = {
  baselineEAR: 0.30, // Generic default
  // Must be clearly below typical open-eye EAR (~0.25–0.35). 0.25 was causing
  // false microsleep when eyes were only slightly narrowed.
  threshold: 0.165,
  isCalibrated: false,
  baselineBlinkRate: 17, // Average human blink rate (blinks/min)
  baselineBlinkDurationMs: 250,
  baselineYaw: 0,
  baselinePitch: 0,
};

export const saveSettings = (settings: UserSettings) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
};

export const getSettings = (): UserSettings => {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const stored = localStorage.getItem(KEYS.SETTINGS);
  return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
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

  // Migrate overly aggressive thresholds from older builds (e.g. baseline * 0.8 ≈ 0.24+),
  // which caused false microsleep while eyes were open.
  if (parsed.threshold > 0.20) {
    const migrated = Math.min(0.20, Math.max(0.12, parsed.baselineEAR * 0.55));
    parsed.threshold = migrated;
    localStorage.setItem(KEYS.CALIBRATION, JSON.stringify(parsed));
  }

  return parsed;
};

export const getDefaultCalibration = (): CalibrationData => ({ ...DEFAULT_CALIBRATION });
