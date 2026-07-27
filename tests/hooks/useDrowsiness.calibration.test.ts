import { renderHook, act } from '@testing-library/react';
import { useDrowsiness } from '../../hooks/useDrowsiness';
import { getDefaultSettings, getDefaultCalibration } from '../../services/storage';

const updateCalibration = jest.fn();

const mockCalibration = {
  ...getDefaultCalibration(),
  threshold: 0.18,
  isCalibrated: true,
  baselineEAR: 0.3,
  openThreshold: 0.22,
  profileVersion: 2,
  yawnMarThreshold: 0.48,
  yawGateThreshold: 0.25,
};

jest.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    calibration: mockCalibration,
    settings: getDefaultSettings(),
    updateCalibration,
  }),
}));

jest.mock('../../hooks/useFacePresence', () => ({
  useFacePresence: () => ({ presence: 'PRESENT' }),
}));

describe('useDrowsiness calibration + runtime', () => {
  beforeEach(() => {
    updateCalibration.mockClear();
  });

  it('C-01 startCalibration enters setup phase', () => {
    const { result } = renderHook(() => useDrowsiness([]));
    act(() => {
      result.current.startCalibration();
    });
    expect(result.current.isCalibrating).toBe(true);
    expect(result.current.calibrationPhase).toBe('setup');
  });

  it('C-08 cancel discards and clears calibrating', () => {
    const { result } = renderHook(() => useDrowsiness([]));
    act(() => {
      result.current.startCalibration();
      result.current.stopCalibration();
    });
    expect(result.current.isCalibrating).toBe(false);
    expect(result.current.calibrationPhase).toBe('idle');
    expect(updateCalibration).not.toHaveBeenCalled();
  });

  it('C-09 no scoring while calibrating with empty landmarks still stays non-critical', () => {
    const { result } = renderHook(() => useDrowsiness([]));
    act(() => {
      result.current.startCalibration();
    });
    expect(result.current.alertLevel).toBe('NONE');
    expect(result.current.isDrowsy).toBe(false);
  });

  it('exposes confirm/retry APIs', () => {
    const { result } = renderHook(() => useDrowsiness([]));
    expect(typeof result.current.confirmCalibration).toBe('function');
    expect(typeof result.current.retryCalibration).toBe('function');
    expect(result.current).toHaveProperty('calibrationPhaseStartedAt');
  });

  it('R-01 mock calibration includes openThreshold for personal hysteresis', () => {
    expect(mockCalibration.openThreshold).toBe(0.22);
    expect(mockCalibration.profileVersion).toBe(2);
  });

  it('R-02 personal yawn override present on calibration', () => {
    expect(mockCalibration.yawnMarThreshold).toBe(0.48);
  });

  it('R-03 personal yaw gate present on calibration', () => {
    expect(mockCalibration.yawGateThreshold).toBe(0.25);
  });
});
