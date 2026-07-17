import React from 'react';
import { Button } from '../ui/Button';

interface CalibrationModalProps {
  isOpen: boolean;
  onStart: () => void;
  onClose: () => void;
}

export const CalibrationModal: React.FC<CalibrationModalProps> = ({ isOpen, onStart, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="text-xl font-bold text-slate-900 mb-2">Calibrate Detector</h3>
        <p className="text-slate-600 mb-6 text-sm">
          We need to measure your normal eye openness. Please look at the camera naturally for 5 seconds.
        </p>
        
        <div className="flex gap-3">
          <Button onClick={onStart} className="flex-1">
            Start Calibration
          </Button>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};
