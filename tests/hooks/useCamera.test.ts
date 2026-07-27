import { renderHook, waitFor } from '@testing-library/react';
import { useCamera } from '../../hooks/useCamera';

describe('useCamera', () => {
  beforeAll(() => {
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        enumerateDevices: jest.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: '1', label: 'Camera 1' },
        ]),
        getUserMedia: jest.fn().mockResolvedValue({
          getTracks: () => [{ stop: jest.fn() }],
          getVideoTracks: () => [{ stop: jest.fn() }],
        }),
      },
      writable: true,
    });
  });

  it('should initialize with videoRef and no error', () => {
    const { result } = renderHook(() => useCamera());
    expect(result.current.videoRef).toBeDefined();
    expect(result.current.error).toBeNull();
    expect(typeof result.current.setDeviceId).toBe('function');
  });

  it('should request camera access on mount', async () => {
    renderHook(() => useCamera());
    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });
  });
});
