import React, { useEffect, useRef } from 'react';

interface CameraViewportProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  landmarks?: any[];
  showDebug?: boolean;
}

export const CameraViewport: React.FC<CameraViewportProps> = ({
  videoRef,
  landmarks,
  showDebug = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!showDebug || !canvasRef.current || !videoRef.current || !landmarks) {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && canvasRef.current) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const video = videoRef.current;

    if (!ctx) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#00ff00';
    landmarks.forEach((point: any) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, 2 * Math.PI);
      ctx.fill();
    });
  }, [landmarks, showDebug, videoRef]);

  return (
    <div className="relative w-full h-full bg-black rounded-2xl overflow-hidden shadow-inner">
      <video
        ref={videoRef}
        className="w-full h-full object-cover transform -scale-x-100"
        playsInline
        muted
        autoPlay
      />
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none transform -scale-x-100"
      />
    </div>
  );
};
