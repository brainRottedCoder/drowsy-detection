'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserSettings, CalibrationData, getSettings, getCalibration, saveSettings, saveCalibration } from '../services/storage';

interface AppContextType {
  settings: UserSettings;
  calibration: CalibrationData;
  updateSettings: (newSettings: Partial<UserSettings>) => void;
  updateCalibration: (newCalibration: Partial<CalibrationData>) => void;
  resetCalibration: () => void;
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

  const updateCalibration = (newCalibration: Partial<CalibrationData>) => {
    setCalibration(prev => {
      const updated = { ...prev, ...newCalibration };
      saveCalibration(updated);
      return updated;
    });
  };

  const resetCalibration = () => {
    const defaultCal = { baselineEAR: 0.30, threshold: 0.25, isCalibrated: false };
    setCalibration(defaultCal);
    saveCalibration(defaultCal);
  };

  return (
    <AppContext.Provider value={{ settings, calibration, updateSettings, updateCalibration, resetCalibration }}>
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
