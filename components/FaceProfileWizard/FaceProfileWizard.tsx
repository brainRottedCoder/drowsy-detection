'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import {
  CalibrationPhase,
  CalibrationPreview,
  LIVE_CALIBRATION_PHASES,
  PHASE_INSTRUCTIONS,
  PHASE_MAX_MS,
  PHASE_TITLES,
} from '../../utils/calibration';

interface FaceProfileWizardProps {
  isOpen: boolean;
  isRunning: boolean;
  phase: CalibrationPhase;
  overallProgress: number;
  phaseProgress: number;
  phaseStartedAt: number | null;
  error: string | null;
  preview: CalibrationPreview | null;
  onBegin: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}

export const FaceProfileWizard: React.FC<FaceProfileWizardProps> = ({
  isOpen,
  isRunning,
  phase,
  overallProgress,
  phaseProgress,
  phaseStartedAt,
  error,
  preview,
  onBegin,
  onCancel,
  onConfirm,
  onRetry,
}) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen || !isRunning || phase === 'idle' || phase === 'summary' || !phaseStartedAt) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [isOpen, isRunning, phase, phaseStartedAt]);

  const showIntro = isOpen && !isRunning && phase === 'idle';
  const showSummary = isOpen && isRunning && phase === 'summary';
  const showLive = isOpen && isRunning && phase !== 'idle' && phase !== 'summary';

  if (!isOpen) return null;

  const phaseMaxMs =
    phase !== 'idle' && phase !== 'summary'
      ? PHASE_MAX_MS[phase as keyof typeof PHASE_MAX_MS]
      : 0;

  const elapsedMs = phaseStartedAt ? Math.max(0, now - phaseStartedAt) : 0;
  const remainingMs = Math.max(0, phaseMaxMs - elapsedMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const timerProgress = phaseMaxMs > 0 ? Math.min(1, elapsedMs / phaseMaxMs) : phaseProgress / 100;

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      {/* Soft vignette — keeps camera readable */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/70" />

      {/* Face guide ring while live */}
      {(showLive || showIntro) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={`rounded-[42%] border-2 transition-all duration-500 ${
              error
                ? 'border-amber-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]'
                : 'border-white/35 shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]'
            }`}
            style={{ width: 'min(42%, 220px)', aspectRatio: '3 / 4' }}
          />
        </div>
      )}

      {showIntro && <IntroOverlay onBegin={onBegin} onCancel={onCancel} />}

      {showLive && (
        <LiveOverlay
          phase={phase as Exclude<CalibrationPhase, 'idle' | 'summary'>}
          overallProgress={overallProgress}
          remainingSec={remainingSec}
          timerProgress={timerProgress}
          error={error}
          onCancel={onCancel}
        />
      )}

      {showSummary && preview && (
        <SummaryOverlay
          preview={preview}
          onConfirm={onConfirm}
          onRetry={onRetry}
          onCancel={onCancel}
        />
      )}
    </div>
  );
};

function IntroOverlay({ onBegin, onCancel }: { onBegin: () => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-between p-4 md:p-6 pointer-events-none">
      <div className="flex justify-between items-start gap-3">
        <div className="rounded-2xl bg-black/55 backdrop-blur-md border border-white/10 px-4 py-3 text-white max-w-md animate-in fade-in slide-in-from-top-2 duration-300">
          <p className="text-xs uppercase tracking-[0.16em] text-sky-300 font-semibold mb-1">
            Face profile
          </p>
          <h3 className="text-lg md:text-xl font-bold leading-tight">Calibrate to your face</h3>
          <p className="text-sm text-white/75 mt-1.5 leading-relaxed">
            About 20–23 seconds on the live camera: open eyes, natural blinks, then closed eyes.
            Head position is measured quietly in the background while you do this.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="pointer-events-auto rounded-full bg-black/50 hover:bg-black/70 text-white/90 text-sm px-3 py-1.5 border border-white/15 backdrop-blur-md transition-colors"
        >
          Close
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pointer-events-auto animate-in fade-in slide-in-from-bottom-3 duration-300">
        <Button onClick={onBegin} size="lg" className="flex-1 shadow-lg shadow-blue-900/40">
          Start calibration
        </Button>
        <Button onClick={onCancel} variant="secondary" size="lg" className="sm:w-auto">
          Not now
        </Button>
      </div>
    </div>
  );
}

function LiveOverlay({
  phase,
  overallProgress,
  remainingSec,
  timerProgress,
  error,
  onCancel,
}: {
  phase: Exclude<CalibrationPhase, 'idle' | 'summary'>;
  overallProgress: number;
  remainingSec: number;
  timerProgress: number;
  error: string | null;
  onCancel: () => void;
}) {
  const stepIndex = LIVE_CALIBRATION_PHASES.indexOf(phase);
  const circumference = 2 * Math.PI * 34;
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, timerProgress)));

  return (
    <div className="absolute inset-0 flex flex-col justify-between p-3 md:p-5 pointer-events-none">
      {/* Top: steps + overall */}
      <div className="space-y-3 animate-in fade-in duration-300">
        <div className="flex items-center justify-between gap-3">
          <div className="rounded-full bg-black/55 backdrop-blur-md border border-white/10 px-3 py-1.5 text-white text-xs font-medium">
            Step {Math.max(1, stepIndex + 1)} of {LIVE_CALIBRATION_PHASES.length}
          </div>
          <div className="rounded-full bg-black/55 backdrop-blur-md border border-white/10 px-3 py-1.5 text-white text-xs tabular-nums">
            {Math.round(overallProgress)}% overall
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {LIVE_CALIBRATION_PHASES.map((p, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <div
                key={p}
                className={`h-1.5 flex-1 min-w-[28px] rounded-full transition-all duration-500 ${
                  done ? 'bg-sky-400' : active ? 'bg-white' : 'bg-white/25'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Center-right countdown */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 md:right-5 pointer-events-none">
        <div className="relative w-[84px] h-[84px]">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80" aria-hidden>
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="5" />
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke={error ? '#fbbf24' : '#38bdf8'}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset] duration-100 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <span className="text-2xl font-bold tabular-nums leading-none">{remainingSec}</span>
            <span className="text-[10px] uppercase tracking-wider text-white/70 mt-0.5">sec</span>
          </div>
        </div>
      </div>

      {/* Bottom instruction + actions */}
      <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {error && (
          <div className="rounded-xl bg-amber-500/90 text-slate-950 text-sm font-medium px-4 py-2.5 backdrop-blur-md shadow-lg">
            {error}
          </div>
        )}

        <div
          key={phase}
          className="rounded-2xl bg-black/60 backdrop-blur-md border border-white/10 px-4 py-3.5 text-white shadow-xl animate-in fade-in zoom-in-95 duration-300"
        >
          <p className="text-sky-300 text-xs font-semibold uppercase tracking-[0.14em] mb-1">
            {PHASE_TITLES[phase]}
          </p>
          <p className="text-base md:text-lg font-semibold leading-snug">
            {PHASE_INSTRUCTIONS[phase]}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pointer-events-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-white/80 hover:text-white hover:bg-white/10"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryOverlay({
  preview,
  onConfirm,
  onRetry,
  onCancel,
}: {
  preview: CalibrationPreview;
  onConfirm: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const stats = useMemo(
    () => [
      { label: 'Open EAR', value: preview.baselineEAR.toFixed(3) },
      { label: 'Closed EAR', value: preview.closedEAR.toFixed(3) },
      { label: 'Close at', value: preview.threshold.toFixed(3) },
      { label: 'Open at', value: preview.openThreshold.toFixed(3) },
      { label: 'Yaw gate', value: preview.yawGateThreshold.toFixed(3) },
      { label: 'Pitch gate', value: preview.pitchGateDelta.toFixed(3) },
      { label: 'Blink ms', value: String(Math.round(preview.baselineBlinkDurationMs)) },
      {
        label: 'Yawn MAR',
        value: 'default',
      },
    ],
    [preview]
  );

  return (
    <div className="absolute inset-0 flex items-end md:items-center justify-center p-3 md:p-6 pointer-events-none">
      <div className="w-full max-w-lg rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-white/15 text-white shadow-2xl p-4 md:p-5 pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-400">
        <p className="text-sky-300 text-xs font-semibold uppercase tracking-[0.14em] mb-1">
          {PHASE_TITLES.summary}
        </p>
        <h3 className="text-xl font-bold mb-3">Review & confirm</h3>

        {!preview.gapOk ? (
          <p className="text-sm text-red-200 bg-red-500/20 border border-red-400/30 rounded-xl px-3 py-2.5 mb-4">
            {preview.gapError ?? 'Calibration could not separate open vs closed eyes.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-sm mb-4">
            {stats.map(s => (
              <div key={s.label} className="rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-white/50">{s.label}</p>
                <p className="font-mono font-semibold mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {preview.gapOk && (
            <Button onClick={onConfirm} className="flex-1 min-w-[140px]">
              Confirm profile
            </Button>
          )}
          <Button onClick={onRetry} variant="secondary" className="flex-1 min-w-[100px]">
            Retry
          </Button>
          <Button
            onClick={onCancel}
            variant="ghost"
            className="text-white/80 hover:text-white hover:bg-white/10"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
