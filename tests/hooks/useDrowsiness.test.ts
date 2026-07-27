import { renderHook } from '@testing-library/react';
import { useDrowsiness } from '../../hooks/useDrowsiness';
import { getDefaultSettings } from '../../services/storage';

jest.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    calibration: {
      threshold: 0.18,
      isCalibrated: true,
      baselineEAR: 0.30,
      baselinePitch: 0,
      baselineYaw: 0,
      baselineBlinkRate: 17,
      baselineBlinkDurationMs: 250,
    },
    settings: getDefaultSettings(),
    updateCalibration: jest.fn(),
  }),
}));

jest.mock('../../hooks/useFacePresence', () => ({
  useFacePresence: () => ({ presence: 'PRESENT' }),
}));

describe('useDrowsiness', () => {
  it('should initialize with default state', () => {
    const { result } = renderHook(() => useDrowsiness([]));
    expect(result.current.isDrowsy).toBe(false);
    expect(result.current.drowsinessScore).toBe(0);
    expect(result.current.alertLevel).toBe('NONE');
    expect(result.current.isYawnAlert).toBe(false);
  });

  it('exposes client-aligned alert and metric fields', () => {
    const { result } = renderHook(() => useDrowsiness([]));
    expect(result.current).toHaveProperty('isYawnAlert');
    expect(result.current).toHaveProperty('blinkRate');
    expect(result.current).toHaveProperty('currentEAR');
    expect(result.current).toHaveProperty('facePresence');
    expect(typeof result.current.resetState).toBe('function');
  });
});
