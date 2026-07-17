import { renderHook, act } from '@testing-library/react';
import { useCamera } from '../../hooks/useCamera';

describe('useCamera', () => {
  beforeAll(() => {
    // Mock navigator.mediaDevices
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        enumerateDevices: jest.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: '1', label: 'Camera 1' }
        ]),
        getUserMedia: jest.fn().mockResolvedValue({
          getTracks: () => [{ stop: jest.fn() }],
          getVideoTracks: () => [{ stop: jest.fn() }]
        })
      },
      writable: true
    });
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useCamera());
    expect(result.current.permissionGranted).toBe(false);
    expect(result.current.isStreaming).toBe(false);
  });

  it('should attempt to start camera when requested', async () => {
    const { result } = renderHook(() => useCamera());
    
    await act(async () => {
      await result.current.startCamera();
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
  });
});
