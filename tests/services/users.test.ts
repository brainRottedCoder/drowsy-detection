/**
 * @jest-environment jsdom
 */
import {
  createOrLoadUser,
  deleteUser,
  getActiveUser,
  getDirectory,
  listUsers,
  migrateLegacyIfNeeded,
  normalizeUserId,
  setActiveUser,
  signOutActiveUser,
  updateActiveUserData,
  validateDisplayName,
} from '../../services/users';
import { getDefaultCalibration, getDefaultSettings } from '../../services/storage';

const store: Record<string, string> = {};

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        Object.keys(store).forEach(k => delete store[k]);
      },
    },
  });
});

describe('users service', () => {
  it('U-01 creates first user and sets active', () => {
    const { profile, created } = createOrLoadUser('Shubh');
    expect(created).toBe(true);
    expect(profile.id).toBe('shubh');
    expect(profile.displayName).toBe('Shubh');
    expect(getActiveUser()?.id).toBe('shubh');
  });

  it('U-02 normalizes duplicate names to one profile', () => {
    createOrLoadUser('Shubh');
    const second = createOrLoadUser('  shubh ');
    expect(second.created).toBe(false);
    expect(listUsers()).toHaveLength(1);
  });

  it('U-03 rejects empty name', () => {
    expect(validateDisplayName('').ok).toBe(false);
    expect(validateDisplayName('   ').ok).toBe(false);
  });

  it('U-05 second user is isolated', () => {
    const a = createOrLoadUser('Alice').profile;
    updateActiveUserData({
      settings: { ...a.settings, sensitivity: 0.9 },
    });
    const b = createOrLoadUser('Bob').profile;
    expect(b.settings.sensitivity).toBe(getDefaultSettings().sensitivity);
    expect(getDirectory().users.alice.settings.sensitivity).toBe(0.9);
  });

  it('U-06 switch user loads that profile', () => {
    createOrLoadUser('Alice');
    createOrLoadUser('Bob');
    setActiveUser('alice');
    expect(getActiveUser()?.displayName).toBe('Alice');
  });

  it('U-07 settings persist per user', () => {
    createOrLoadUser('Alice');
    updateActiveUserData({
      settings: { ...getDefaultSettings(), sensitivity: 0.2 },
    });
    createOrLoadUser('Bob');
    updateActiveUserData({
      settings: { ...getDefaultSettings(), sensitivity: 0.8 },
    });
    setActiveUser('alice');
    expect(getActiveUser()?.settings.sensitivity).toBe(0.2);
  });

  it('U-08 calibration persists per user', () => {
    createOrLoadUser('Alice');
    updateActiveUserData({
      calibration: { ...getDefaultCalibration(), isCalibrated: true, baselineEAR: 0.35 },
    });
    createOrLoadUser('Bob');
    expect(getActiveUser()?.calibration.isCalibrated).toBe(false);
    setActiveUser('alice');
    expect(getActiveUser()?.calibration.baselineEAR).toBe(0.35);
  });

  it('U-09 sign out clears active user', () => {
    createOrLoadUser('Alice');
    signOutActiveUser();
    expect(getActiveUser()).toBeNull();
    expect(listUsers()).toHaveLength(1);
  });

  it('U-10 delete active user signs out', () => {
    createOrLoadUser('Alice');
    deleteUser('alice');
    expect(getActiveUser()).toBeNull();
    expect(listUsers()).toHaveLength(0);
  });

  it('U-11 delete inactive user keeps active', () => {
    createOrLoadUser('Alice');
    createOrLoadUser('Bob');
    setActiveUser('alice');
    deleteUser('bob');
    expect(getActiveUser()?.id).toBe('alice');
    expect(listUsers()).toHaveLength(1);
  });

  it('U-12 migrates legacy settings into Default', () => {
    store['drowsy-settings'] = JSON.stringify({ ...getDefaultSettings(), sensitivity: 0.77 });
    store['drowsy-calibration'] = JSON.stringify({
      ...getDefaultCalibration(),
      isCalibrated: true,
      baselineEAR: 0.28,
    });
    const dir = migrateLegacyIfNeeded();
    expect(dir.users.default).toBeDefined();
    expect(dir.activeUserId).toBe('default');
    expect(dir.users.default.settings.sensitivity).toBe(0.77);
    expect(dir.users.default.calibration.baselineEAR).toBe(0.28);
  });

  it('U-13 migration is idempotent', () => {
    store['drowsy-settings'] = JSON.stringify(getDefaultSettings());
    migrateLegacyIfNeeded();
    migrateLegacyIfNeeded();
    expect(Object.keys(getDirectory().users)).toEqual(['default']);
  });

  it('U-15 corrupt JSON recovers to empty directory', () => {
    store['drowsy-users'] = '{not-json';
    const dir = getDirectory();
    expect(dir.users).toEqual({});
    expect(dir.activeUserId).toBeNull();
  });

  it('normalizeUserId lowercases and trims', () => {
    expect(normalizeUserId('  Foo-Bar ')).toBe('foo-bar');
  });
});
