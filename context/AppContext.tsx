'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  UserSettings,
  CalibrationData,
  DetectionSettings,
  ScoreWeights,
  AlertLevelSettings,
  getDefaultCalibration,
  getDefaultSettings,
} from '../services/storage';
import {
  UserProfile,
  createOrLoadUser,
  deleteUser as deleteUserFromStore,
  getActiveUser,
  getDirectory,
  listUsers,
  migrateLegacyIfNeeded,
  setActiveUser,
  signOutActiveUser,
  updateActiveUserData,
  validateDisplayName,
} from '../services/users';

interface AppContextType {
  settings: UserSettings;
  calibration: CalibrationData;
  currentUser: UserProfile | null;
  users: UserProfile[];
  isUserReady: boolean;
  updateSettings: (newSettings: Partial<UserSettings>) => void;
  updateDetection: (patch: Partial<DetectionSettings>) => void;
  updateScoreWeights: (patch: Partial<ScoreWeights>) => void;
  updateAlertLevels: (patch: Partial<AlertLevelSettings>) => void;
  updateCalibration: (newCalibration: Partial<CalibrationData>) => void;
  resetCalibration: () => void;
  resetDetectionDefaults: () => void;
  signIn: (displayName: string) => { ok: true } | { ok: false; error: string };
  switchUser: (userId: string) => void;
  signOut: () => void;
  deleteUser: (userId: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const applyProfile = (profile: UserProfile | null) => ({
  settings: profile?.settings ?? getDefaultSettings(),
  calibration: profile?.calibration ?? getDefaultCalibration(),
});

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<UserSettings>(getDefaultSettings());
  const [calibration, setCalibration] = useState<CalibrationData>(getDefaultCalibration());
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isUserReady, setIsUserReady] = useState(false);

  const settingsRef = useRef(settings);
  const calibrationRef = useRef(calibration);
  settingsRef.current = settings;
  calibrationRef.current = calibration;

  const refreshUsers = useCallback(() => {
    const dir = getDirectory();
    setUsers(listUsers(dir));
    const active = getActiveUser(dir);
    setCurrentUser(active);
    const next = applyProfile(active);
    setSettings(next.settings);
    setCalibration(next.calibration);
  }, []);

  useEffect(() => {
    migrateLegacyIfNeeded();
    refreshUsers();
    setIsUserReady(true);
  }, [refreshUsers]);

  const persistProfile = useCallback((nextSettings: UserSettings, nextCalibration: CalibrationData) => {
    const updated = updateActiveUserData({
      settings: nextSettings,
      calibration: nextCalibration,
    });
    if (updated) {
      setCurrentUser(updated);
      setUsers(listUsers());
    }
  }, []);

  const updateSettings = (newSettings: Partial<UserSettings>) => {
    const updated = { ...settingsRef.current, ...newSettings };
    setSettings(updated);
    persistProfile(updated, calibrationRef.current);
  };

  const updateDetection = (patch: Partial<DetectionSettings>) => {
    const prev = settingsRef.current;
    const updated: UserSettings = {
      ...prev,
      detection: { ...prev.detection, ...patch },
    };
    setSettings(updated);
    persistProfile(updated, calibrationRef.current);
  };

  const updateScoreWeights = (patch: Partial<ScoreWeights>) => {
    const prev = settingsRef.current;
    const updated: UserSettings = {
      ...prev,
      scoreWeights: { ...prev.scoreWeights, ...patch },
    };
    setSettings(updated);
    persistProfile(updated, calibrationRef.current);
  };

  const updateAlertLevels = (patch: Partial<AlertLevelSettings>) => {
    const prev = settingsRef.current;
    const updated: UserSettings = {
      ...prev,
      alertLevels: { ...prev.alertLevels, ...patch },
    };
    setSettings(updated);
    persistProfile(updated, calibrationRef.current);
  };

  const updateCalibration = (newCalibration: Partial<CalibrationData>) => {
    const updated = { ...calibrationRef.current, ...newCalibration };
    setCalibration(updated);
    persistProfile(settingsRef.current, updated);
  };

  const resetCalibration = () => {
    const defaultCal = getDefaultCalibration();
    setCalibration(defaultCal);
    persistProfile(settingsRef.current, defaultCal);
  };

  const resetDetectionDefaults = () => {
    const prev = settingsRef.current;
    const defaults = getDefaultSettings();
    const updated: UserSettings = {
      ...defaults,
      deviceId: prev.deviceId,
      telemetryEnabled: prev.telemetryEnabled,
    };
    setSettings(updated);
    persistProfile(updated, calibrationRef.current);
  };

  const signIn = (displayName: string): { ok: true } | { ok: false; error: string } => {
    const validated = validateDisplayName(displayName);
    if (!validated.ok) return { ok: false, error: validated.error };
    try {
      const { profile } = createOrLoadUser(validated.displayName);
      setCurrentUser(profile);
      setSettings(profile.settings);
      setCalibration(profile.calibration);
      setUsers(listUsers());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not sign in.' };
    }
  };

  const switchUser = (userId: string) => {
    const profile = setActiveUser(userId);
    setCurrentUser(profile);
    setSettings(profile.settings);
    setCalibration(profile.calibration);
    setUsers(listUsers());
  };

  const signOut = () => {
    signOutActiveUser();
    setCurrentUser(null);
    setSettings(getDefaultSettings());
    setCalibration(getDefaultCalibration());
    setUsers(listUsers());
  };

  const deleteUser = (userId: string) => {
    deleteUserFromStore(userId);
    refreshUsers();
  };

  return (
    <AppContext.Provider
      value={{
        settings,
        calibration,
        currentUser,
        users,
        isUserReady,
        updateSettings,
        updateDetection,
        updateScoreWeights,
        updateAlertLevels,
        updateCalibration,
        resetCalibration,
        resetDetectionDefaults,
        signIn,
        switchUser,
        signOut,
        deleteUser,
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
