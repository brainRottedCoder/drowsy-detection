import { useEffect, useRef, useState } from 'react';

// We use a simplified interface for the hook
interface UseFaceLandmarksReturn {
  landmarks: any[]; // Raw landmarks
  isReady: boolean;
  error: string | null;
}

const MEDIAPIPE_VERSION = '0.10.22-rc.20250304';
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** TFLite logs routine CPU-delegate INFO via console.error; Next.js surfaces that as a red overlay. */
const isBenignTfLiteLog = (args: unknown[]) => {
  const text = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
  return (
    text.includes('XNNPACK delegate') ||
    text.includes('Created TensorFlow Lite') ||
    text.includes('TensorFlow Lite XNNPACK')
  );
};

const withQuietTfLiteLogs = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = {
    error: console.error,
    warn: console.warn,
    log: console.log,
    info: console.info,
  };

  const filter =
    (method: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      if (isBenignTfLiteLog(args)) return;
      method(...args);
    };

  console.error = filter(original.error);
  console.warn = filter(original.warn);
  console.log = filter(original.log);
  console.info = filter(original.info);

  try {
    return await fn();
  } finally {
    console.error = original.error;
    console.warn = original.warn;
    console.log = original.log;
    console.info = original.info;
  }
};

export const useFaceLandmarks = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  isEnabled: boolean = true
): UseFaceLandmarksReturn => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [landmarks, setLandmarks] = useState<any[]>([]);

  const faceLandmarkerRef = useRef<any | null>(null);
  const requestRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(-1);

  useEffect(() => {
    let cancelled = false;

    const createLandmarker = async (FaceLandmarker: any, filesetResolver: any, delegate: 'GPU' | 'CPU') => {
      return FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: MODEL_PATH,
          delegate,
        },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
    };

    const initMediaPipe = async () => {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const { FilesetResolver, FaceLandmarker } = vision;

        const filesetResolver = await FilesetResolver.forVisionTasks(WASM_ROOT);

        // Prefer GPU; many browsers/machines fall back to CPU (XNNPACK) which is fine.
        // Quiet the known TFLite INFO spam so Next.js doesn't treat it as an app error.
        const landmarker = await withQuietTfLiteLogs(async () => {
          try {
            return await createLandmarker(FaceLandmarker, filesetResolver, 'GPU');
          } catch {
            return await createLandmarker(FaceLandmarker, filesetResolver, 'CPU');
          }
        });

        if (cancelled) {
          landmarker.close();
          return;
        }

        faceLandmarkerRef.current = landmarker;
        setIsReady(true);
      } catch (err: any) {
        console.error('MediaPipe init error:', err);
        if (!cancelled) setError('Failed to load face detection model');
      }
    };

    if (isEnabled && !faceLandmarkerRef.current) {
      initMediaPipe();
    }

    return () => {
      cancelled = true;
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
    };
  }, [isEnabled]);

  const predict = () => {
    if (
      faceLandmarkerRef.current &&
      videoRef.current &&
      videoRef.current.readyState >= 2 // HAVE_CURRENT_DATA
    ) {
      const video = videoRef.current;
      const startTimeMs = performance.now();

      if (video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const results = faceLandmarkerRef.current.detectForVideo(video, startTimeMs);

        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
          setLandmarks(results.faceLandmarks[0]);
        } else {
          setLandmarks([]);
        }
      }
    }
    requestRef.current = requestAnimationFrame(predict);
  };

  useEffect(() => {
    if (isReady && isEnabled) {
      requestRef.current = requestAnimationFrame(predict);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [isReady, isEnabled]);

  return { landmarks, isReady, error };
};
