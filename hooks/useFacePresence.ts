import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';

export type FacePresenceState = 'PRESENT' | 'FACE_LOST' | 'ABSENT';

interface UseFacePresenceReturn {
  presence: FacePresenceState;
  /** ms since the face was last seen (0 while PRESENT) */
  absentDurationMs: number;
}

/**
 * Turns the raw per-frame landmark presence/absence into a debounced state
 * machine so a brief tracking glitch isn't treated the same as the driver
 * actually leaving the frame.
 */
export const useFacePresence = (landmarks: any[]): UseFacePresenceReturn => {
  const { settings } = useAppContext();
  const faceLostGraceMs = Math.max(500, settings.detection.faceLostGraceMs);
  const absentAfterMs = Math.max(faceLostGraceMs + 500, settings.detection.faceAbsentAfterMs);

  const [presence, setPresence] = useState<FacePresenceState>('PRESENT');
  const [absentDurationMs, setAbsentDurationMs] = useState(0);

  const lastSeenRef = useRef<number>(Date.now());
  const hasFace = !!landmarks && landmarks.length > 0;

  useEffect(() => {
    if (hasFace) {
      lastSeenRef.current = Date.now();
      setPresence('PRESENT');
      setAbsentDurationMs(0);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastSeenRef.current;
      setAbsentDurationMs(elapsed);
      if (elapsed >= absentAfterMs) {
        setPresence('ABSENT');
      } else if (elapsed >= faceLostGraceMs) {
        setPresence('FACE_LOST');
      }
    }, 200);

    return () => clearInterval(interval);
  }, [hasFace, absentAfterMs, faceLostGraceMs]);

  return { presence, absentDurationMs };
};
