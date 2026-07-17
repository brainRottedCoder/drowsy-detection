import React from 'react';
import { clsx } from 'clsx';

interface StatusCardProps {
  status: 'OK' | 'WARNING' | 'DROWSY';
  score: number;
  ear: number;
  mar?: number;
  isYawning?: boolean;
}

export const StatusCard: React.FC<StatusCardProps> = ({ status, score, ear, mar, isYawning }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'OK': return 'bg-emerald-500';
      case 'WARNING': return 'bg-amber-500';
      case 'DROWSY': return 'bg-red-600 animate-pulse';
      default: return 'bg-slate-500';
    }
  };

  return (
    <div className={clsx(
      "rounded-2xl p-6 text-white shadow-lg transition-colors duration-300 flex flex-col justify-between h-full",
      getStatusColor()
    )}>
      <div>
        <div className="flex justify-between items-start">
          <h2 className="text-sm font-medium opacity-90 uppercase tracking-wider">Driver Status</h2>
          {isYawning && (
            <span className="text-xs font-semibold bg-black/25 rounded-full px-3 py-1 animate-pulse">
              YAWNING
            </span>
          )}
        </div>
        <div className="mt-2 text-4xl font-bold tracking-tight">
          {status === 'DROWSY' ? 'WAKE UP!' : status}
        </div>
      </div>
      
      <div className="mt-6 space-y-2">
        <div className="flex justify-between text-sm opacity-90">
          <span>Drowsiness Score</span>
          <span>{Math.round(score)}%</span>
        </div>
        <div className="w-full bg-black/20 rounded-full h-2">
          <div 
            className="bg-white h-2 rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, score)}%` }}
          />
        </div>
        
        <div className="pt-2 text-xs font-mono opacity-70">
          EAR: {ear.toFixed(3)}
          {mar !== undefined && <span className="ml-3">MAR: {mar.toFixed(3)}</span>}
        </div>
      </div>
    </div>
  );
};
