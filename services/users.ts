import {
  CalibrationData,
  UserSettings,
  getCalibration,
  getDefaultCalibration,
  getDefaultSettings,
  getSettings,
} from './storage';

const USERS_KEY = 'drowsy-users';

export interface UserProfile {
  id: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
  settings: UserSettings;
  calibration: CalibrationData;
}

export interface UserDirectory {
  version: 1;
  activeUserId: string | null;
  users: Record<string, UserProfile>;
}

export type NameValidation =
  | { ok: true; displayName: string; id: string }
  | { ok: false; error: string };

const NAME_RE = /^[A-Za-z0-9 _-]{2,32}$/;

const emptyDirectory = (): UserDirectory => ({
  version: 1,
  activeUserId: null,
  users: {},
});

export const normalizeUserId = (displayName: string): string =>
  displayName.trim().toLowerCase();

export const validateDisplayName = (raw: string): NameValidation => {
  const displayName = raw.trim();
  if (!displayName) {
    return { ok: false, error: 'Enter a name (2–32 characters).' };
  }
  if (!NAME_RE.test(displayName)) {
    return {
      ok: false,
      error: 'Use 2–32 letters, numbers, spaces, hyphens, or underscores.',
    };
  }
  return { ok: true, displayName, id: normalizeUserId(displayName) };
};

export const getDirectory = (): UserDirectory => {
  if (typeof window === 'undefined') return emptyDirectory();

  migrateLegacyIfNeeded();

  const stored = localStorage.getItem(USERS_KEY);
  if (!stored) return emptyDirectory();

  try {
    const parsed = JSON.parse(stored) as Partial<UserDirectory>;
    if (!parsed || typeof parsed !== 'object' || !parsed.users) {
      return emptyDirectory();
    }
    return {
      version: 1,
      activeUserId: parsed.activeUserId ?? null,
      users: parsed.users ?? {},
    };
  } catch {
    return emptyDirectory();
  }
};

export const saveDirectory = (directory: UserDirectory): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USERS_KEY, JSON.stringify(directory));
};

/** Migrate pre-user global settings/calibration into a Default profile once. */
export const migrateLegacyIfNeeded = (): UserDirectory => {
  if (typeof window === 'undefined') return emptyDirectory();

  const existing = localStorage.getItem(USERS_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as UserDirectory;
      if (parsed?.users && typeof parsed.users === 'object') {
        return {
          version: 1,
          activeUserId: parsed.activeUserId ?? null,
          users: parsed.users,
        };
      }
    } catch {
      // fall through to rebuild
    }
  }

  const legacySettingsRaw = localStorage.getItem('drowsy-settings');
  const legacyCalibrationRaw = localStorage.getItem('drowsy-calibration');

  if (!legacySettingsRaw && !legacyCalibrationRaw) {
    const empty = emptyDirectory();
    saveDirectory(empty);
    return empty;
  }

  const now = Date.now();
  const profile: UserProfile = {
    id: 'default',
    displayName: 'Default',
    createdAt: now,
    updatedAt: now,
    settings: getSettings(),
    calibration: getCalibration(),
  };

  const directory: UserDirectory = {
    version: 1,
    activeUserId: 'default',
    users: { default: profile },
  };
  saveDirectory(directory);
  return directory;
};

export const listUsers = (directory?: UserDirectory): UserProfile[] => {
  const dir = directory ?? getDirectory();
  return Object.values(dir.users).sort((a, b) => a.displayName.localeCompare(b.displayName));
};

export const getActiveUser = (directory?: UserDirectory): UserProfile | null => {
  const dir = directory ?? getDirectory();
  if (!dir.activeUserId) return null;
  return dir.users[dir.activeUserId] ?? null;
};

export const createOrLoadUser = (rawName: string): { profile: UserProfile; created: boolean } => {
  const validated = validateDisplayName(rawName);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const dir = getDirectory();
  const existing = dir.users[validated.id];
  if (existing) {
    dir.activeUserId = existing.id;
    saveDirectory(dir);
    return { profile: existing, created: false };
  }

  const now = Date.now();
  const profile: UserProfile = {
    id: validated.id,
    displayName: validated.displayName,
    createdAt: now,
    updatedAt: now,
    settings: getDefaultSettings(),
    calibration: getDefaultCalibration(),
  };
  dir.users[profile.id] = profile;
  dir.activeUserId = profile.id;
  saveDirectory(dir);
  return { profile, created: true };
};

export const setActiveUser = (userId: string): UserProfile => {
  const dir = getDirectory();
  const profile = dir.users[userId];
  if (!profile) {
    throw new Error('User not found.');
  }
  dir.activeUserId = userId;
  saveDirectory(dir);
  return profile;
};

export const signOutActiveUser = (): void => {
  const dir = getDirectory();
  dir.activeUserId = null;
  saveDirectory(dir);
};

export const deleteUser = (userId: string): void => {
  const dir = getDirectory();
  if (!dir.users[userId]) return;
  delete dir.users[userId];
  if (dir.activeUserId === userId) {
    dir.activeUserId = null;
  }
  saveDirectory(dir);
};

export const updateActiveUserData = (
  patch: Partial<Pick<UserProfile, 'settings' | 'calibration'>>
): UserProfile | null => {
  const dir = getDirectory();
  if (!dir.activeUserId) return null;
  const profile = dir.users[dir.activeUserId];
  if (!profile) return null;

  const updated: UserProfile = {
    ...profile,
    settings: patch.settings ?? profile.settings,
    calibration: patch.calibration ?? profile.calibration,
    updatedAt: Date.now(),
  };
  dir.users[updated.id] = updated;
  saveDirectory(dir);
  return updated;
};
