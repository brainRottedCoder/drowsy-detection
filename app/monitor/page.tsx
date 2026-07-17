'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useCamera } from '../../hooks/useCamera';
import { useFaceLandmarks } from '../../hooks/useFaceLandmarks';
import { useDrowsiness } from '../../hooks/useDrowsiness';
import { useGlassesDetection } from '../../hooks/useGlassesDetection';
import { CameraViewport } from '../../components/CameraViewport/CameraViewport';
import { StatusCard } from '../../components/StatusCard/StatusCard';
import { MapPanel } from '../../components/MapPanel/MapPanel';
import { AlertModal } from '../../components/AlertModal/AlertModal';
import { CalibrationModal } from '../../components/CalibrationModal/CalibrationModal';
import { Button } from '../../components/ui/Button';
import { useAppContext } from '../../context/AppContext';

export default function MonitorPage() {
  const { videoRef, permissionGranted, error: cameraError } = useCamera();
  const { landmarks, isReady: isModelReady } = useFaceLandmarks(videoRef);
  const { 
    isDrowsy, 
    drowsinessScore, 
    currentEAR, 
    currentMAR,
    isYawning,
    yawnCount,
    isCalibrating, 
    startCalibration, 
    stopCalibration,
    resetState
  } = useDrowsiness(landmarks);
  const { hasGlasses } = useGlassesDetection(videoRef, landmarks);
  
  const { calibration } = useAppContext();
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

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
              status={isDrowsy ? 'DROWSY' : drowsinessScore > 30 ? 'WARNING' : 'OK'} 
              score={drowsinessScore}
              ear={currentEAR}
              mar={currentMAR}
              isYawning={isYawning}
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
                <span className={hasGlasses ? 'text-sky-400 opacity-100' : ''}>
                  {hasGlasses ? 'Glasses detected' : 'No glasses'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Map (4 cols) */}
        <div className="lg:col-span-4 h-full min-h-[300px]">
          <MapPanel isDrowsy={isDrowsy} />
        </div>
      </div>

      {/* Modals */}
      <AlertModal 
        isOpen={isDrowsy} 
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
