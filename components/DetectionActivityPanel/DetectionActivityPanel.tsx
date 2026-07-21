'use client';

import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { AlertLevel } from '../../hooks/useDrowsiness';
import type { FacePresenceState } from '../../hooks/useFacePresence';
import type { EyeVisibilityState } from '../../hooks/eyeVisibility/types';

export interface DetectionSnapshot {
  alertLevel: AlertLevel;
  drowsinessScore: number;
  currentEAR: number;
  currentMAR: number;
  isYawning: boolean;
  yawnCount: number;
  isYawnAlert: boolean;
  isMicrosleep: boolean;
  isDistracted: boolean;
  facePresence: FacePresenceState;
  blinkRate: number;
  leftEyeVisibility: EyeVisibilityState;
  rightEyeVisibility: EyeVisibilityState;
  eyesNotClearlyVisible: boolean;
  isModelReady: boolean;
  isCalibrating: boolean;
  landmarkCount: number;
}

type LogSeverity = 'info' | 'caution' | 'warning' | 'critical';

interface ActivityLogEntry {
  id: string;
  time: string;
  message: string;
  severity: LogSeverity;
}

interface DetectionActivityPanelProps {
  detection: DetectionSnapshot;
}

const MAX_LOGS = 80;

const SEVERITY_STYLES: Record<LogSeverity, string> = {
  info: 'bg-slate-500',
  caution: 'bg-yellow-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
};

function formatTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function makeEntry(message: string, severity: LogSeverity): ActivityLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: formatTime(new Date()),
    message,
    severity,
  };
}

function MetricRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={clsx('font-mono font-medium tabular-nums', accent ?? 'text-slate-100')}>
        {value}
      </span>
    </div>
  );
}

function FlagChip({ active, label, tone }: { active: boolean; label: string; tone: string }) {
  return (
    <span
      className={clsx(
        'rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
        active ? tone : 'bg-slate-800 text-slate-500'
      )}
    >
      {label}
    </span>
  );
}

export const DetectionActivityPanel: React.FC<DetectionActivityPanelProps> = ({ detection }) => {
  const [logs, setLogs] = useState<ActivityLogEntry[]>(() => [
    makeEntry('Monitoring session started', 'info'),
  ]);
  const prev = useRef<DetectionSnapshot | null>(null);
  const detectionRef = useRef(detection);
  const logScrollRef = useRef<HTMLDivElement>(null);

  detectionRef.current = detection;

  // Stable single dependency — avoids useEffect dep-array size churn on HMR
  const eventKey = [
    detection.alertLevel,
    detection.isYawning,
    detection.yawnCount,
    detection.isYawnAlert,
    detection.isMicrosleep,
    detection.isDistracted,
    detection.facePresence,
    detection.eyesNotClearlyVisible,
    detection.leftEyeVisibility,
    detection.rightEyeVisibility,
    detection.isModelReady,
    detection.isCalibrating,
  ].join('|');

  useEffect(() => {
    const current = detectionRef.current;
    const previous = prev.current;
    prev.current = current;

    const pushLog = (message: string, severity: LogSeverity) => {
      setLogs((entries) => {
        const next = [makeEntry(message, severity), ...entries];
        return next.slice(0, MAX_LOGS);
      });
    };

    if (!previous) {
      if (current.isModelReady) {
        pushLog('Face landmark model ready', 'info');
      }
      return;
    }

    if (!previous.isModelReady && current.isModelReady) {
      pushLog('Face landmark model ready', 'info');
    }

    if (!previous.isCalibrating && current.isCalibrating) {
      pushLog('Calibration started', 'info');
    }
    if (previous.isCalibrating && !current.isCalibrating) {
      pushLog('Calibration finished', 'info');
    }

    if (previous.facePresence !== current.facePresence) {
      if (current.facePresence === 'PRESENT') {
        pushLog('Face detected in frame', 'info');
      } else if (current.facePresence === 'FACE_LOST') {
        pushLog('Face tracking interrupted', 'caution');
      } else {
        pushLog('Driver not visible — monitoring paused', 'warning');
      }
    }

    if (previous.alertLevel !== current.alertLevel) {
      const level = current.alertLevel;
      if (level === 'CRITICAL') {
        pushLog(`Alert escalated to CRITICAL (score ${Math.round(current.drowsinessScore)})`, 'critical');
      } else if (level === 'WARNING') {
        pushLog(`Alert escalated to WARNING (score ${Math.round(current.drowsinessScore)})`, 'warning');
      } else if (level === 'CAUTION') {
        pushLog(`Alert raised to CAUTION (score ${Math.round(current.drowsinessScore)})`, 'caution');
      } else if (previous.alertLevel !== 'NONE') {
        pushLog('Alert cleared — driver alert', 'info');
      }
    }

    if (!previous.isMicrosleep && current.isMicrosleep) {
      pushLog('Microsleep detected (prolonged eye closure)', 'critical');
    }

    if (!previous.isYawning && current.isYawning) {
      pushLog(`Yawn detected (total: ${current.yawnCount})`, 'caution');
    } else if (previous.yawnCount < current.yawnCount) {
      pushLog(`Yawn count updated (${current.yawnCount})`, 'caution');
    }

    if (!previous.isYawnAlert && current.isYawnAlert) {
      pushLog('Frequent yawning alert — multiple yawns in 60s', 'warning');
    } else if (previous.isYawnAlert && !current.isYawnAlert) {
      pushLog('Frequent yawning alert cleared', 'info');
    }

    if (!previous.isDistracted && current.isDistracted) {
      pushLog('Distraction detected — looking away', 'warning');
    } else if (previous.isDistracted && !current.isDistracted) {
      pushLog('Gaze returned to forward view', 'info');
    }

    if (!previous.eyesNotClearlyVisible && current.eyesNotClearlyVisible) {
      pushLog('Eyes not clearly visible — remove sunglasses or coverings', 'info');
    } else if (previous.eyesNotClearlyVisible && !current.eyesNotClearlyVisible) {
      pushLog('Eyes clearly visible again', 'info');
    }
  }, [eventKey]);

  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = 0;
    }
  }, [logs.length]);

  const faceLabel =
    detection.facePresence === 'PRESENT'
      ? 'In frame'
      : detection.facePresence === 'FACE_LOST'
        ? 'Tracking…'
        : 'Absent';

  return (
    <div className="bg-slate-800 rounded-2xl shadow-lg overflow-hidden h-full min-h-[300px] flex flex-col border border-slate-700">
      <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/80">
        <h3 className="font-semibold text-slate-100 flex items-center gap-2 text-sm">
          <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Detection Analysis
        </h3>
        <span
          className={clsx(
            'text-[10px] font-mono uppercase tracking-wider',
            detection.isModelReady ? 'text-emerald-400' : 'text-slate-500'
          )}
        >
          {detection.isModelReady ? 'Model live' : 'Loading model'}
        </span>
      </div>

      <div className="p-4 space-y-3 border-b border-slate-700">
        <div className="flex flex-wrap gap-1.5">
          <FlagChip active={detection.isMicrosleep} label="Microsleep" tone="bg-red-600 text-white" />
          <FlagChip active={detection.isYawning} label="Yawning" tone="bg-amber-500 text-white" />
          <FlagChip active={detection.isYawnAlert} label="Yawn Alert" tone="bg-orange-600 text-white" />
          <FlagChip active={detection.isDistracted} label="Distracted" tone="bg-orange-500 text-white" />
          <FlagChip
            active={detection.leftEyeVisibility === 'NOT_VISIBLE'}
            label="L eye"
            tone="bg-indigo-600 text-white"
          />
          <FlagChip
            active={detection.rightEyeVisibility === 'NOT_VISIBLE'}
            label="R eye"
            tone="bg-indigo-600 text-white"
          />
          <FlagChip
            active={detection.eyesNotClearlyVisible}
            label="Eyes blocked"
            tone="bg-indigo-600 text-white"
          />
          <FlagChip
            active={detection.facePresence === 'PRESENT'}
            label={faceLabel}
            tone="bg-emerald-600 text-white"
          />
        </div>

        <div className="space-y-2">
          <MetricRow
            label="Alert level"
            value={detection.alertLevel}
            accent={
              detection.alertLevel === 'CRITICAL'
                ? 'text-red-400'
                : detection.alertLevel === 'WARNING'
                  ? 'text-amber-400'
                  : detection.alertLevel === 'CAUTION'
                    ? 'text-yellow-400'
                    : 'text-emerald-400'
            }
          />
          <MetricRow label="Drowsiness score" value={`${Math.round(detection.drowsinessScore)}%`} />
          <MetricRow label="EAR (eye aspect)" value={detection.currentEAR.toFixed(3)} />
          <MetricRow label="MAR (mouth aspect)" value={detection.currentMAR.toFixed(3)} />
          <MetricRow label="Blink rate" value={`${Math.round(detection.blinkRate)} / min`} />
          <MetricRow label="Yawn count" value={String(detection.yawnCount)} />
          <MetricRow
            label="L / R eye"
            value={`${detection.leftEyeVisibility} / ${detection.rightEyeVisibility}`}
            accent={
              detection.eyesNotClearlyVisible
                ? 'text-indigo-300'
                : detection.leftEyeVisibility === 'VISIBLE' && detection.rightEyeVisibility === 'VISIBLE'
                  ? 'text-emerald-400'
                  : 'text-slate-300'
            }
          />
          <MetricRow
            label="Landmarks"
            value={detection.landmarkCount > 0 ? `${detection.landmarkCount} points` : 'None'}
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wider text-slate-400">Activity Log</h4>
          <span className="text-[10px] text-slate-500 font-mono">{logs.length} events</span>
        </div>
        <div ref={logScrollRef} className="flex-1 overflow-y-auto px-4 pb-4 space-y-2 min-h-[140px]">
          {logs.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">No activity yet</p>
          ) : (
            logs.map((entry) => (
              <div
                key={entry.id}
                className="flex gap-2.5 items-start rounded-lg bg-slate-900/60 px-3 py-2 border border-slate-700/60"
              >
                <span
                  className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_STYLES[entry.severity])}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm text-slate-200 leading-snug">{entry.message}</p>
                    <time className="shrink-0 text-[10px] font-mono text-slate-500">{entry.time}</time>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
