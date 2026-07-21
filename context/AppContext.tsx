'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  UserSettings,
  CalibrationData,
  DetectionSettings,
  ScoreWeights,
  AlertLevelSettings,
  getSettings,
  getCalibration,
  saveSettings,
  saveCalibration,
  getDefaultCalibration,
  getDefaultSettings,
} from '../services/storage';

interface AppContextType {
  settings: UserSettings;
  calibration: CalibrationData;
  updateSettings: (newSettings: Partial<UserSettings>) => void;
  updateDetection: (patch: Partial<DetectionSettings>) => void;
  updateScoreWeights: (patch: Partial<ScoreWeights>) => void;
  updateAlertLevels: (patch: Partial<AlertLevelSettings>) => void;
  updateCalibration: (newCalibration: Partial<CalibrationData>) => void;
  resetCalibration: () => void;
  resetDetectionDefaults: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<UserSettings>(getSettings());
  const [calibration, setCalibration] = useState<CalibrationData>(getCalibration());

  // Load from local storage on mount (client-side)
  useEffect(() => {
    setSettings(getSettings());
    setCalibration(getCalibration());
  }, []);

  const updateSettings = (newSettings: Partial<UserSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      saveSettings(updated);
      return updated;
    });
  };

  const updateDetection = (patch: Partial<DetectionSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, detection: { ...prev.detection, ...patch } };
      saveSettings(updated);
      return updated;
    });
  };

  const updateScoreWeights = (patch: Partial<ScoreWeights>) => {
    setSettings(prev => {
      const updated = { ...prev, scoreWeights: { ...prev.scoreWeights, ...patch } };
      saveSettings(updated);
      return updated;
    });
  };

  const updateAlertLevels = (patch: Partial<AlertLevelSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, alertLevels: { ...prev.alertLevels, ...patch } };
      saveSettings(updated);
      return updated;
    });
  };

  const updateCalibration = (newCalibration: Partial<CalibrationData>) => {
    setCalibration(prev => {
      const updated = { ...prev, ...newCalibration };
      saveCalibration(updated);
      return updated;
    });
  };

  const resetCalibration = () => {
    const defaultCal = getDefaultCalibration();
    setCalibration(defaultCal);
    saveCalibration(defaultCal);
  };

  const resetDetectionDefaults = () => {
    setSettings(prev => {
      const defaults = getDefaultSettings();
      const updated: UserSettings = {
        ...defaults,
        deviceId: prev.deviceId,
        telemetryEnabled: prev.telemetryEnabled,
      };
      saveSettings(updated);
      return updated;
    });
  };

  return (
    <AppContext.Provider
      value={{
        settings,
        calibration,
        updateSettings,
        updateDetection,
        updateScoreWeights,
        updateAlertLevels,
        updateCalibration,
        resetCalibration,
        resetDetectionDefaults,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
