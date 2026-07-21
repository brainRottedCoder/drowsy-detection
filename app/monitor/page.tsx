'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useCamera } from '../../hooks/useCamera';
import { useFaceLandmarks } from '../../hooks/useFaceLandmarks';
import { useDrowsiness } from '../../hooks/useDrowsiness';
import { useEyeVisibility } from '../../hooks/useEyeVisibility';
import { CameraViewport } from '../../components/CameraViewport/CameraViewport';
import { StatusCard } from '../../components/StatusCard/StatusCard';
import { DetectionActivityPanel } from '../../components/DetectionActivityPanel/DetectionActivityPanel';
import { AlertModal } from '../../components/AlertModal/AlertModal';
import { CalibrationModal } from '../../components/CalibrationModal/CalibrationModal';
import { Button } from '../../components/ui/Button';
import { useAppContext } from '../../context/AppContext';

export default function MonitorPage() {
  const { videoRef, permissionGranted, error: cameraError } = useCamera();
  const { landmarks, isReady: isModelReady } = useFaceLandmarks(videoRef);
  const {
    alertLevel,
    drowsinessScore,
    currentEAR,
    currentMAR,
    isYawning,
    yawnCount,
    isYawnAlert,
    isMicrosleep,
    isDistracted,
    facePresence,
    blinkRate,
    isCalibrating,
    startCalibration,
    resetState,
  } = useDrowsiness(landmarks);
  const {
    left: leftEyeVisibility,
    right: rightEyeVisibility,
    eyesNotClearlyVisible,
    confidence: eyeVisibilityConfidence,
    debug: eyeVisibilityDebug,
  } = useEyeVisibility(videoRef, landmarks);

  const statusCardStatus =
    alertLevel === 'CRITICAL' ? 'DROWSY' :
    alertLevel === 'WARNING' ? 'WARNING' :
    alertLevel === 'CAUTION' ? 'CAUTION' : 'OK';

  const { calibration } = useAppContext();
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const detectionSnapshot = useMemo(
    () => ({
      alertLevel,
      drowsinessScore,
      currentEAR,
      currentMAR,
      isYawning,
      yawnCount,
      isYawnAlert,
      isMicrosleep,
      isDistracted,
      facePresence,
      blinkRate,
      leftEyeVisibility,
      rightEyeVisibility,
      eyesNotClearlyVisible,
      isModelReady,
      isCalibrating,
      landmarkCount: landmarks.length,
    }),
    [
      alertLevel,
      drowsinessScore,
      currentEAR,
      currentMAR,
      isYawning,
      yawnCount,
      isYawnAlert,
      isMicrosleep,
      isDistracted,
      facePresence,
      blinkRate,
      leftEyeVisibility,
      rightEyeVisibility,
      eyesNotClearlyVisible,
      isModelReady,
      isCalibrating,
      landmarks.length,
    ]
  );

  // Show calibration modal on first visit if not calibrated
  useEffect(() => {
    if (!calibration.isCalibrated && isModelReady) {
      setShowCalibrationModal(true);
    }
  }, [calibration.isCalibrated, isModelReady]);

  const handleAcknowledgeAlert = () => {
    resetState();
  };

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-6 flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <Link href="/" className="text-white font-bold text-xl flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          Drowsy Detector
        </Link>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowDebug(!showDebug)}
            className="hidden md:block"
          >
            {showDebug ? 'Hide Debug' : 'Show Debug'}
          </Button>
          <Link href="/settings">
            <Button variant="secondary" size="sm">Settings</Button>
          </Link>
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">

        {/* Left Column: Camera & Status (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-4 md:gap-6">
          {/* Camera View */}
          <div className="relative aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-800">
            {!permissionGranted && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <p>Requesting camera access...</p>
              </div>
            )}
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center text-red-400 bg-slate-900">
                <p>{cameraError}</p>
              </div>
            )}
            <CameraViewport
              videoRef={videoRef}
              landmarks={landmarks}
              showDebug={showDebug}
              isCalibrating={isCalibrating}
            />

            {/* Driver not visible overlay */}
            {facePresence === 'ABSENT' && !isCalibrating && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/85 backdrop-blur-sm">
                <div className="text-white text-center p-4">
                  <div className="text-4xl mb-3">👤</div>
                  <p className="text-lg font-semibold">Driver not visible</p>
                  <p className="text-sm opacity-70">Monitoring paused until your face is back in frame</p>
                </div>
              </div>
            )}

            {/* Distraction banner (looking away, but face still visible) */}
            {isDistracted && facePresence === 'PRESENT' && !isCalibrating && (
              <div className="absolute top-4 left-4 right-4 bg-amber-500/90 text-white text-sm font-medium px-4 py-2 rounded-xl backdrop-blur text-center">
                Eyes on the road — you've been looking away for a while
              </div>
            )}

            {/* Eyes not clearly visible — UI warning only; scoring continues */}
            {eyesNotClearlyVisible && facePresence !== 'ABSENT' && !isCalibrating && (
              <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-950/85 px-3 py-2 text-indigo-100 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200">
                <svg className="h-4 w-4 shrink-0 text-indigo-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
                <div className="leading-tight">
                  <p className="text-xs font-semibold tracking-wide">Eyes not clearly visible</p>
                  <p className="text-[10px] text-indigo-200/80">Remove sunglasses or coverings</p>
                </div>
              </div>
            )}

            {/* Overlay Controls */}
            <div className="absolute bottom-4 right-4">
              <Button
                size="sm"
                variant="secondary"
                className="bg-black/50 backdrop-blur text-white border-none hover:bg-black/70"
                onClick={() => setShowCalibrationModal(true)}
              >
                Recalibrate
              </Button>
            </div>
          </div>

          {/* Status Cards Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-40">
            <StatusCard
              status={statusCardStatus}
              score={drowsinessScore}
              ear={currentEAR}
              mar={currentMAR}
              isYawning={isYawning}
              blinkRate={blinkRate}
            />

            {/* Mini Stats / Info */}
            <div className="bg-slate-800 rounded-2xl p-6 text-slate-300 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-medium uppercase tracking-wider opacity-70">Session Stats</h3>
                <div className="mt-2 flex justify-between items-end">
                  <div>
                    <div className="text-2xl font-bold text-white">01:24:30</div>
                    <div className="text-xs">Monitoring Time</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white">{yawnCount}</div>
                    <div className="text-xs">Yawns</div>
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center text-xs opacity-50">
                <span>Model: MediaPipe FaceMesh (Client-side)</span>
                <span className={eyesNotClearlyVisible ? 'text-indigo-400 opacity-100' : ''}>
                  Eyes {leftEyeVisibility === 'VISIBLE' && rightEyeVisibility === 'VISIBLE' ? 'visible' : leftEyeVisibility === 'NOT_VISIBLE' || rightEyeVisibility === 'NOT_VISIBLE' ? 'blocked' : 'uncertain'} ({Math.round(eyeVisibilityConfidence * 100)}%)
                </span>
              </div>
              <div className="flex justify-between items-center text-xs opacity-50 mt-1">
                <span>Driver: {facePresence === 'PRESENT' ? 'In frame' : facePresence === 'FACE_LOST' ? 'Tracking...' : 'Not visible'}</span>
                {isDistracted && <span className="text-amber-400 opacity-100">Distracted</span>}
                {isYawnAlert && <span className="text-orange-400 opacity-100">Yawn alert</span>}
              </div>
              {showDebug && eyeVisibilityDebug && (
                <div className="mt-2 rounded-lg bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-indigo-200">
                  <div>
                    L {leftEyeVisibility} iris={eyeVisibilityDebug.left.irisInContour ? 'Y' : 'N'} w={eyeVisibilityDebug.left.eyeWidthOk ? 'Y' : 'N'} pose={eyeVisibilityDebug.left.poseOk ? 'Y' : 'N'}
                  </div>
                  <div>
                    R {rightEyeVisibility} iris={eyeVisibilityDebug.right.irisInContour ? 'Y' : 'N'} w={eyeVisibilityDebug.right.eyeWidthOk ? 'Y' : 'N'} pose={eyeVisibilityDebug.right.poseOk ? 'Y' : 'N'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Detection analysis & activity logs */}
        <div className="lg:col-span-4 h-full min-h-[300px]">
          <DetectionActivityPanel detection={detectionSnapshot} />
        </div>
      </div>

      {/* Non-blocking bottom-left warning — camera stays usable */}
      <AlertModal
        alertLevel={alertLevel}
        detections={{
          isMicrosleep,
          isYawning,
          isYawnAlert,
          isDistracted,
          eyesNotClearlyVisible,
          facePresence,
          blinkRate,
          score: drowsinessScore,
          ear: currentEAR,
        }}
        onAcknowledge={handleAcknowledgeAlert}
      />

      <CalibrationModal
        isOpen={showCalibrationModal}
        onStart={() => {
          setShowCalibrationModal(false);
          startCalibration();
        }}
        onClose={() => setShowCalibrationModal(false)}
      />
    </div>
  );
}
