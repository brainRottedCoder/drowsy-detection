import { useEffect, useRef, useState } from 'react';

export type FacePresenceState = 'PRESENT' | 'FACE_LOST' | 'ABSENT';

const FACE_LOST_GRACE_MS = 1500; // Momentary tracking dropouts, lighting flicker
const ABSENT_AFTER_MS = 4000; // Driver has actually left the frame

interface UseFacePresenceReturn {
  presence: FacePresenceState;
  /** ms since the face was last seen (0 while PRESENT) */
  absentDurationMs: number;
}

/**
 * Turns the raw per-frame landmark presence/absence into a debounced state
 * machine so a brief tracking glitch isn't treated the same as the driver
 * actually leaving the frame (e.g. leaning down to grab something, washing
 * their face). PRESENT/FACE_LOST are "keep monitoring as-is", ABSENT is
 * "driver not visible, stop scoring and warn".
 */
export const useFacePresence = (landmarks: any[]): UseFacePresenceReturn => {
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

    // No face this frame: poll elapsed time since last seen so the state
    // machine advances even though no new landmark frames are arriving.
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastSeenRef.current;
      setAbsentDurationMs(elapsed);
      if (elapsed >= ABSENT_AFTER_MS) {
        setPresence('ABSENT');
      } else if (elapsed >= FACE_LOST_GRACE_MS) {
        setPresence('FACE_LOST');
      }
    }, 200);

    return () => clearInterval(interval);
  }, [hasFace]);

  return { presence, absentDurationMs };
};
