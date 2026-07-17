import { useEffect, useRef, useState } from 'react';

// We use a simplified interface for the hook
interface UseFaceLandmarksReturn {
  landmarks: any[]; // Raw landmarks
  isReady: boolean;
  error: string | null;
}

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
    const initMediaPipe = async () => {
      try {
        const vision = await new Function('return import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm")')();
        const { FilesetResolver, FaceLandmarker } = vision;
        
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        
        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });
        
        setIsReady(true);
      } catch (err: any) {
        console.error("MediaPipe init error:", err);
        setError("Failed to load face detection model");
      }
    };

    if (isEnabled && !faceLandmarkerRef.current) {
      initMediaPipe();
    }

    return () => {
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
