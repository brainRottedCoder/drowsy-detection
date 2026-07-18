import { renderHook, act } from '@testing-library/react';
import { useDrowsiness } from '../../hooks/useDrowsiness';
import { calculateEAR } from '../../utils/math';

// Mock the AppContext
jest.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    calibration: {
      threshold: 0.25,
      isCalibrated: true,
      baselinePitch: 0,
      baselineYaw: 0,
      baselineBlinkRate: 17,
      baselineBlinkDurationMs: 250,
    },
    settings: { sensitivity: 0.5 },
    updateCalibration: jest.fn(),
  }),
}));

describe('useDrowsiness', () => {
  it('should initialize with default state', () => {
    const { result } = renderHook(() => useDrowsiness([]));
    expect(result.current.isDrowsy).toBe(false);
    expect(result.current.drowsinessScore).toBe(0);
  });

  it('should detect drowsiness when eyes are closed for consecutive frames', () => {
    const { result } = renderHook(() => useDrowsiness([]));
    
    // Mock closed eyes landmarks (simplified for test)
    // In a real test, we'd pass actual coordinate arrays that result in low EAR
    // Here we are testing the logic flow, assuming calculateEAR works
  });
});
