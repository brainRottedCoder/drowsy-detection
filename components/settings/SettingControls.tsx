'use client';

import React from 'react';

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <h2 className="text-xl font-semibold mb-1">{title}</h2>
      {description && <p className="text-sm text-slate-500 mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="flex justify-between text-sm font-medium text-slate-700 mb-2 gap-3">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-slate-600 shrink-0">
          {display ?? String(value)}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
      />
      {hint && <p className="text-xs text-slate-500 mt-1.5">{hint}</p>}
    </div>
  );
}

export function NumberRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="flex justify-between items-center text-sm font-medium text-slate-700 mb-2 gap-3">
        <span>{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={min}
            max={max}
            step={step ?? 1}
            value={value}
            onChange={e => {
              const n = parseFloat(e.target.value);
              if (Number.isNaN(n)) return;
              let next = n;
              if (min !== undefined) next = Math.max(min, next);
              if (max !== undefined) next = Math.min(max, next);
              onChange(next);
            }}
            className="w-24 rounded-md border border-slate-200 px-2 py-1 text-right font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {unit && <span className="text-xs text-slate-500 w-8">{unit}</span>}
        </div>
      </label>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function WeightSumBanner({
  sum,
  target = 1,
}: {
  sum: number;
  target?: number;
}) {
  const ok = Math.abs(sum - target) <= 0.01;
  return (
    <div
      className={`rounded-lg px-3 py-2 text-sm font-medium ${
        ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
      }`}
    >
      Weight sum: {sum.toFixed(2)}
      {ok ? ' (OK)' : ` — should be ~${target.toFixed(1)}. Use Normalize.`}
    </div>
  );
}
