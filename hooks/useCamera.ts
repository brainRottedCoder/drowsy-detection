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

    const startCamera = async () => {
      try {
        setError(null);
        
        const constraints: MediaStreamConstraints = {
          video: currentDeviceId 
            ? { deviceId: { exact: currentDeviceId } } 
            : { facingMode: 'user' },
          audio: false
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        setPermissionGranted(true);
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Wait for metadata to load to ensure dimensions are correct
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(e => console.error("Play error:", e));
          };
        }

        // Refresh device list after permission is granted (labels become available)
        getDevices();

      } catch (err: any) {
        console.error("Camera error:", err);
        setError(err.name === 'NotAllowedError' ? 'Camera permission denied' : 'Could not access camera');
        setPermissionGranted(false);
      }
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
