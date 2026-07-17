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
}

const DEFAULT_SETTINGS: UserSettings = {
  sensitivity: 0.5,
  volume: 0.8,
  telemetryEnabled: false,
  deviceId: '',
};

const DEFAULT_CALIBRATION: CalibrationData = {
  baselineEAR: 0.30, // Generic default
  threshold: 0.25,   // Generic default
  isCalibrated: false,
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
  return stored ? { ...DEFAULT_CALIBRATION, ...JSON.parse(stored) } : DEFAULT_CALIBRATION;
};
