'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useAppContext } from '../../context/AppContext';
import { Button } from '../../components/ui/Button';
import {
  SectionCard,
  SliderRow,
  NumberRow,
  WeightSumBanner,
} from '../../components/settings/SettingControls';
import type { ScoreWeights, DetectionSettings, AlertLevelSettings } from '../../services/storage';

function normalizeWeights<T extends Record<string, number>>(weights: T): T {
  const keys = Object.keys(weights) as (keyof T)[];
  const sum = keys.reduce((s, k) => s + Number(weights[k]), 0);
  if (sum <= 0) return weights;
  const next = { ...weights };
  for (const k of keys) {
    next[k] = (Number(weights[k]) / sum) as T[keyof T];
  }
  return next;
}

function clampAlertLevels(patch: Partial<AlertLevelSettings>, current: AlertLevelSettings): AlertLevelSettings {
  const next = { ...current, ...patch };
  let caution = Math.min(100, Math.max(0, next.cautionEnter));
  let warning = Math.min(100, Math.max(0, next.warningEnter));
  let critical = Math.min(100, Math.max(0, next.criticalEnter));

  if (caution >= warning) warning = Math.min(100, caution + 1);
  if (warning >= critical) critical = Math.min(100, warning + 1);
  if (caution >= warning) caution = Math.max(0, warning - 1);

  return {
    ...next,
    cautionEnter: caution,
    warningEnter: warning,
    criticalEnter: critical,
    downgradeHysteresis: Math.min(40, Math.max(0, next.downgradeHysteresis)),
    downgradeStableMs: Math.min(15_000, Math.max(500, next.downgradeStableMs)),
  };
}

export default function SettingsPage() {
  const {
    settings,
    updateSettings,
    updateDetection,
    updateScoreWeights,
    updateAlertLevels,
    calibration,
    resetCalibration,
    resetDetectionDefaults,
  } = useAppContext();

  const { detection: d, scoreWeights: w, alertLevels: a } = settings;

  const scoreSum = useMemo(
    () => w.perclos + w.ear + w.blinkRate + w.yawn + w.headPose,
    [w]
  );

  const setDetection = (patch: Partial<DetectionSettings>) => updateDetection(patch);

  const setAlert = (patch: Partial<AlertLevelSettings>) => {
    updateAlertLevels(clampAlertLevels(patch, a));
  };

  const setScore = (patch: Partial<ScoreWeights>) => {
    const next = { ...w, ...patch };
    for (const key of Object.keys(next) as (keyof ScoreWeights)[]) {
      next[key] = Math.min(1, Math.max(0, next[key]));
    }
    updateScoreWeights(next);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-2xl mx-auto pb-16">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link href="/monitor">
              <Button variant="ghost" size="sm">← Back</Button>
            </Link>
            <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm('Reset all detection, score, and alert settings to defaults?')) {
                resetDetectionDefaults();
              }
            }}
          >
            Reset detection defaults
          </Button>
        </div>

        <div className="space-y-6">
          {/* 1. General */}
          <SectionCard title="General" description="Overall sensitivity and alert sound.">
            <SliderRow
              label="Sensitivity"
              value={settings.sensitivity}
              min={0}
              max={1}
              step={0.05}
              display={`${Math.round(settings.sensitivity * 100)}%`}
              hint="Higher sensitivity amplifies the drowsiness score so alerts trigger earlier."
              onChange={v => updateSettings({ sensitivity: v })}
            />
            <SliderRow
              label="Alert volume"
              value={settings.volume}
              min={0}
              max={1}
              step={0.05}
              display={`${Math.round(settings.volume * 100)}%`}
              hint="Volume of the critical alert beep (0 = silent)."
              onChange={v => updateSettings({ volume: v })}
            />
          </SectionCard>

          {/* 2. Alert levels */}
          <SectionCard
            title="Alert levels"
            description="Score cutoffs for CAUTION / WARNING / CRITICAL. Levels are kept ordered automatically."
          >
            <SliderRow
              label="CAUTION enters at"
              value={a.cautionEnter}
              min={0}
              max={98}
              step={1}
              display={`${a.cautionEnter}`}
              onChange={v => setAlert({ cautionEnter: v })}
            />
            <SliderRow
              label="WARNING enters at"
              value={a.warningEnter}
              min={1}
              max={99}
              step={1}
              display={`${a.warningEnter}`}
              onChange={v => setAlert({ warningEnter: v })}
            />
            <SliderRow
              label="CRITICAL enters at"
              value={a.criticalEnter}
              min={2}
              max={100}
              step={1}
              display={`${a.criticalEnter}`}
              onChange={v => setAlert({ criticalEnter: v })}
            />
            <NumberRow
              label="Downgrade hysteresis"
              value={a.downgradeHysteresis}
              min={0}
              max={40}
              unit="pts"
              hint="Score must fall this far below the current level before de-escalating."
              onChange={v => setAlert({ downgradeHysteresis: v })}
            />
            <NumberRow
              label="Downgrade stable time"
              value={a.downgradeStableMs}
              min={500}
              max={15000}
              step={100}
              unit="ms"
              hint="How long the score must stay below before the alert level drops."
              onChange={v => setAlert({ downgradeStableMs: v })}
            />
          </SectionCard>

          {/* 3. Yawn alerts */}
          <SectionCard
            title="Yawn alerts"
            description="When to count a yawn and when frequent yawning raises its own alert."
          >
            <NumberRow
              label="Yawns to trigger alert"
              value={d.yawnAlertCount}
              min={2}
              max={10}
              hint="Alert when this many yawns occur inside the window below."
              onChange={v => setDetection({ yawnAlertCount: Math.round(v) })}
            />
            <NumberRow
              label="Yawn alert window"
              value={Math.round(d.yawnAlertWindowMs / 1000)}
              min={10}
              max={300}
              unit="sec"
              onChange={v => setDetection({ yawnAlertWindowMs: Math.round(v) * 1000 })}
            />
            <SliderRow
              label="Yawn MAR threshold"
              value={d.yawnMarThreshold}
              min={0.3}
              max={1.0}
              step={0.05}
              display={d.yawnMarThreshold.toFixed(2)}
              hint="Mouth aspect ratio above this counts toward a yawn."
              onChange={v => setDetection({ yawnMarThreshold: v })}
            />
            <NumberRow
              label="Sustained open-mouth frames"
              value={d.yawnFramesThreshold}
              min={5}
              max={60}
              hint="Consecutive frames above MAR before a yawn is registered (~30fps)."
              onChange={v => setDetection({ yawnFramesThreshold: Math.round(v) })}
            />
            <NumberRow
              label="Yawn memory (score)"
              value={Math.round(d.yawnMemoryMs / 60000)}
              min={1}
              max={30}
              unit="min"
              hint="How long past yawns keep contributing to the drowsiness score."
              onChange={v => setDetection({ yawnMemoryMs: Math.round(v) * 60000 })}
            />
          </SectionCard>

          {/* 4. Face absence */}
          <SectionCard
            title="Face absence"
            description="How long the face can leave the frame before alerting."
          >
            <NumberRow
              label="Tracking grace"
              value={d.faceLostGraceMs}
              min={500}
              max={5000}
              step={100}
              unit="ms"
              hint="Brief dropouts before marking face as 'tracking lost'."
              onChange={v => setDetection({ faceLostGraceMs: Math.round(v) })}
            />
            <NumberRow
              label="Absent after"
              value={Math.round(d.faceAbsentAfterMs / 1000)}
              min={5}
              max={30}
              unit="sec"
              hint="Client range is typically 10–15s (default 12)."
              onChange={v => setDetection({ faceAbsentAfterMs: Math.round(v) * 1000 })}
            />
          </SectionCard>

          {/* 5. Eye visibility */}
          <SectionCard
            title="Eye visibility"
            description="Warns when an eye is not clearly trackable (sunglasses, hand covering). Clear glasses and closed lids stay visible. Does not pause drowsiness scoring."
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-slate-900">Enable eye visibility warning</p>
                <p className="text-sm text-slate-500">
                  Shows a UI nudge when eyes are obscured.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={d.eyeVisibilityEnabled}
                  onChange={e => setDetection({ eyeVisibilityEnabled: e.target.checked })}
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
              </label>
            </div>
            <NumberRow
              label="Enter dwell"
              value={d.eyeVisibilityEnterMs}
              min={200}
              max={5000}
              step={100}
              unit="ms"
              hint="How long eyes must stay not-visible before warning."
              onChange={v => setDetection({ eyeVisibilityEnterMs: Math.round(v) })}
            />
            <NumberRow
              label="Exit dwell"
              value={d.eyeVisibilityExitMs}
              min={100}
              max={3000}
              step={100}
              unit="ms"
              hint="How long eyes must stay clear before clearing the warning."
              onChange={v => setDetection({ eyeVisibilityExitMs: Math.round(v) })}
            />
          </SectionCard>

          {/* 6. Score weights */}
          <SectionCard
            title="Drowsiness score weights"
            description="Score = Σ (weight × signal). Weights should sum to 1.0."
          >
            <WeightSumBanner sum={scoreSum} />
            <SliderRow
              label="PERCLOS"
              value={w.perclos}
              min={0}
              max={1}
              step={0.05}
              display={w.perclos.toFixed(2)}
              onChange={v => setScore({ perclos: v })}
            />
            <SliderRow
              label="EAR"
              value={w.ear}
              min={0}
              max={1}
              step={0.05}
              display={w.ear.toFixed(2)}
              onChange={v => setScore({ ear: v })}
            />
            <SliderRow
              label="Blink rate"
              value={w.blinkRate}
              min={0}
              max={1}
              step={0.05}
              display={w.blinkRate.toFixed(2)}
              onChange={v => setScore({ blinkRate: v })}
            />
            <SliderRow
              label="Yawning"
              value={w.yawn}
              min={0}
              max={1}
              step={0.05}
              display={w.yawn.toFixed(2)}
              onChange={v => setScore({ yawn: v })}
            />
            <SliderRow
              label="Head pose"
              value={w.headPose}
              min={0}
              max={1}
              step={0.05}
              display={w.headPose.toFixed(2)}
              onChange={v => setScore({ headPose: v })}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateScoreWeights(normalizeWeights(w))}
            >
              Normalize score weights
            </Button>
          </SectionCard>

          {/* 7. Eye closure / microsleep */}
          <SectionCard
            title="Eye closure & microsleep"
            description="How blinks, droops, and microsleeps are classified."
          >
            <NumberRow
              label="Max blink duration"
              value={d.blinkMaxMs}
              min={100}
              max={800}
              step={10}
              unit="ms"
              hint="Closures longer than this become eyelid droops. Natural blinks are often 100–500ms."
              onChange={v => setDetection({ blinkMaxMs: Math.round(v) })}
            />
            <NumberRow
              label="Microsleep duration"
              value={d.microsleepMs}
              min={800}
              max={15000}
              step={100}
              unit="ms"
              hint="Eyes closed this long forces a critical score. Default 8000 ms."
              onChange={v => setDetection({ microsleepMs: Math.round(v) })}
            />
            <NumberRow
              label="PERCLOS window"
              value={Math.round(d.perclosWindowMs / 1000)}
              min={10}
              max={180}
              unit="sec"
              onChange={v => setDetection({ perclosWindowMs: Math.round(v) * 1000 })}
            />
            <NumberRow
              label="Blink-stats window"
              value={Math.round(d.blinkStatsWindowMs / 1000)}
              min={10}
              max={180}
              unit="sec"
              onChange={v => setDetection({ blinkStatsWindowMs: Math.round(v) * 1000 })}
            />
            <SliderRow
              label="EAR closed ratio"
              value={d.earClosedRatio}
              min={0.35}
              max={0.85}
              step={0.05}
              display={d.earClosedRatio.toFixed(2)}
              hint="Closed threshold ≈ baseline EAR × this ratio (used at calibration)."
              onChange={v => setDetection({ earClosedRatio: v })}
            />
            <SliderRow
              label="EAR open ratio"
              value={d.earOpenRatio}
              min={0.45}
              max={0.95}
              step={0.05}
              display={d.earOpenRatio.toFixed(2)}
              hint="Hysteresis: stay closed until EAR recovers above this relative level."
              onChange={v => setDetection({ earOpenRatio: v })}
            />
            <SliderRow
              label="EAR threshold min"
              value={d.earThresholdMin}
              min={0.08}
              max={0.2}
              step={0.01}
              display={d.earThresholdMin.toFixed(2)}
              onChange={v => setDetection({ earThresholdMin: v })}
            />
            <SliderRow
              label="EAR threshold max"
              value={d.earThresholdMax}
              min={0.14}
              max={0.35}
              step={0.01}
              display={d.earThresholdMax.toFixed(2)}
              onChange={v => setDetection({ earThresholdMax: v })}
            />
            <NumberRow
              label="EAR score smooth frames"
              value={d.earScoreHistory}
              min={2}
              max={30}
              onChange={v => setDetection({ earScoreHistory: Math.round(v) })}
            />
          </SectionCard>

          {/* 8. Head pose / distraction */}
          <SectionCard
            title="Head pose & distraction"
            description="When looking away suspends eye scoring and raises a distraction flag."
          >
            <SliderRow
              label="Yaw gate"
              value={d.yawGateThreshold}
              min={0.05}
              max={0.4}
              step={0.01}
              display={d.yawGateThreshold.toFixed(2)}
              onChange={v => setDetection({ yawGateThreshold: v })}
            />
            <SliderRow
              label="Pitch gate"
              value={d.pitchGateDelta}
              min={0.05}
              max={0.4}
              step={0.01}
              display={d.pitchGateDelta.toFixed(2)}
              onChange={v => setDetection({ pitchGateDelta: v })}
            />
            <NumberRow
              label="Look-away distraction delay"
              value={d.lookAwayDistractionMs}
              min={1000}
              max={15000}
              step={250}
              unit="ms"
              onChange={v => setDetection({ lookAwayDistractionMs: Math.round(v) })}
            />
            <SliderRow
              label="Head-pose score range"
              value={d.headPoseScoreRange}
              min={0.1}
              max={0.8}
              step={0.05}
              display={d.headPoseScoreRange.toFixed(2)}
              hint="Combined |yaw|+|pitch| deviation that saturates the head-pose score term."
              onChange={v => setDetection({ headPoseScoreRange: v })}
            />
          </SectionCard>

          {/* 9. Calibration */}
          <SectionCard title="Calibration" description="Personal baselines from the last calibration run.">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500 text-xs uppercase tracking-wide">EAR threshold</p>
                <p className="font-mono font-semibold text-slate-900 mt-1">
                  {calibration.threshold.toFixed(3)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500 text-xs uppercase tracking-wide">Baseline EAR</p>
                <p className="font-mono font-semibold text-slate-900 mt-1">
                  {calibration.baselineEAR.toFixed(3)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500 text-xs uppercase tracking-wide">Blink rate</p>
                <p className="font-mono font-semibold text-slate-900 mt-1">
                  {calibration.baselineBlinkRate.toFixed(1)} / min
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500 text-xs uppercase tracking-wide">Status</p>
                <p className="font-semibold text-slate-900 mt-1">
                  {calibration.isCalibrated ? 'Calibrated' : 'Not calibrated'}
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={resetCalibration}>
              Reset Calibration
            </Button>
          </SectionCard>

          {/* 10. Privacy */}
          <SectionCard title="Privacy & Data">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-slate-900">Telemetry</p>
                <p className="text-sm text-slate-500">
                  Share anonymous usage statistics to help improve the model.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={settings.telemetryEnabled}
                  onChange={e => updateSettings({ telemetryEnabled: e.target.checked })}
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
              </label>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
              <p>
                <strong>Note:</strong> Video frames are processed entirely in your browser and are
                never sent to any server. Only anonymous performance metrics (if enabled) are
                collected.
              </p>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
