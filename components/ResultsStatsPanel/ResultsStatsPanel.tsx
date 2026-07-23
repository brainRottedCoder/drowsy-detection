'use client';

import React from 'react';
import { clsx } from 'clsx';
import type { FacePresenceState } from '../../hooks/useFacePresence';

export interface ResultsStatsPanelProps {
  drowsinessScore: number;
  yawnCount: number;
  blinkRate: number;
  facePresence: FacePresenceState;
  sunglassesDetected: boolean;
  sunglassesReady?: boolean;
}

function StatRow({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-900/50 border border-slate-700/60 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={clsx('mt-1.5 text-2xl font-semibold tabular-nums tracking-tight', valueClassName ?? 'text-slate-100')}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export const ResultsStatsPanel: React.FC<ResultsStatsPanelProps> = ({
  drowsinessScore,
  yawnCount,
  blinkRate,
  facePresence,
  sunglassesDetected,
  sunglassesReady = true,
}) => {
  const inFrame = facePresence === 'PRESENT';
  const tracking = facePresence === 'FACE_LOST';

  const personLabel = inFrame ? 'In frame' : tracking ? 'Tracking…' : 'Not in frame';
  const personAccent = inFrame
    ? 'text-emerald-400'
    : tracking
      ? 'text-amber-300'
      : 'text-rose-400';

  const eyesInFrameLabel = !sunglassesReady
    ? 'Checking…'
    : sunglassesDetected
      ? 'Not visible'
      : 'Visible';
  const eyesInFrameAccent = !sunglassesReady
    ? 'text-amber-300'
    : sunglassesDetected
      ? 'text-rose-400'
      : 'text-emerald-400';

  const scoreAccent =
    drowsinessScore >= 70
      ? 'text-red-400'
      : drowsinessScore >= 40
        ? 'text-amber-400'
        : 'text-emerald-400';

  return (
    <div className="bg-slate-800 rounded-2xl shadow-lg overflow-hidden h-full min-h-[300px] flex flex-col border border-slate-700">
      <div className="p-4 border-b border-slate-700 bg-slate-800/80">
        <h3 className="font-semibold text-slate-100 flex items-center gap-2 text-sm">
          <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Results Stats
        </h3>
      </div>

      <div className="flex-1 p-4 space-y-3">
        <StatRow
          label="Drowsiness score"
          value={`${Math.round(drowsinessScore)}%`}
          valueClassName={scoreAccent}
        />
        <StatRow label="Yawn count" value={String(yawnCount)} />
        <StatRow
          label="Blink rate"
          value={`${Math.round(blinkRate)} / min`}
          hint="Blinks counted in the last 60 seconds"
        />
        <StatRow
          label="Person in frame"
          value={personLabel}
          valueClassName={personAccent}
          hint={
            facePresence === 'ABSENT'
              ? 'Monitoring paused until face returns'
              : undefined
          }
        />
        <StatRow
          label="Eyes in the frame"
          value={eyesInFrameLabel}
          valueClassName={eyesInFrameAccent}
          hint={sunglassesDetected ? 'Adjust position or remove coverings so eyes are visible' : undefined}
        />
      </div>
    </div>
  );
};
