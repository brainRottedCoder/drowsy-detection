import { useState, useEffect, useRef, useCallback } from 'react';

interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  devices: MediaDeviceInfo[];
  currentDeviceId: string;
  setDeviceId: (id: string) => void;
  isFacingUser: boolean;
  error: string | null;
  permissionGranted: boolean;
}

export const useCamera = (): UseCameraReturn => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);

  // List devices
  const getDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
      setDevices(videoDevices);
      
      // Default to first device if none selected
      if (videoDevices.length > 0 && !currentDeviceId) {
        setCurrentDeviceId(videoDevices[0].deviceId);
      }
    } catch (err) {
      console.error("Error enumerating devices:", err);
    }
  }, [currentDeviceId]);

  // Initialize camera stream
  useEffect(() => {
    let stream: MediaStream | null = null;

    // Try a chain of progressively looser constraints. A hard `exact`
    // deviceId throws OverconstrainedError the moment that device is stale,
    // busy, or (common on Windows laptops with an IR/Windows-Hello camera
    // alongside the regular webcam) simply doesn't support the requested
    // combination — with no fallback, the whole camera silently fails.
    const buildConstraintAttempts = (): MediaStreamConstraints[] => {
      const attempts: MediaStreamConstraints[] = [];
      if (currentDeviceId) {
        attempts.push({ video: { deviceId: { exact: currentDeviceId } }, audio: false });
        attempts.push({ video: { deviceId: { ideal: currentDeviceId } }, audio: false });
      }
      attempts.push({ video: { facingMode: 'user' }, audio: false });
      attempts.push({ video: true, audio: false });
      return attempts;
    };

    const startCamera = async () => {
      setError(null);
      const attempts = buildConstraintAttempts();
      let lastErr: any = null;

      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          // OverconstrainedError / NotFoundError → try the next, looser attempt.
          // NotAllowedError (permission denied) won't succeed on retry; stop early.
          if (err?.name === 'NotAllowedError') break;
        }
      }

      if (!stream) {
        console.error('Camera error:', lastErr);
        setError(
          lastErr?.name === 'NotAllowedError'
            ? 'Camera permission denied'
            : lastErr?.name === 'OverconstrainedError'
              ? 'Selected camera is unavailable — try a different camera in settings'
              : 'Could not access camera'
        );
        setPermissionGranted(false);
        return;
      }

      setPermissionGranted(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wait for metadata to load to ensure dimensions are correct
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(e => console.error('Play error:', e));
        };
      }

      // Refresh device list after permission is granted (labels become available)
      getDevices();
    };

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [currentDeviceId, getDevices]);

  return {
    videoRef,
    devices,
    currentDeviceId,
    setDeviceId: setCurrentDeviceId,
    isFacingUser: true, // Simplified assumption for now
    error,
    permissionGranted
  };
};
