import React, { useEffect } from 'react';
import { Button } from '../ui/Button';
import type { AlertLevel } from '../../hooks/useDrowsiness';
import { useAppContext } from '../../context/AppContext';

export interface DetectionFlags {
  isMicrosleep: boolean;
  isYawning: boolean;
  isYawnAlert: boolean;
  isDistracted: boolean;
  eyesNotClearlyVisible: boolean;
  facePresence: 'PRESENT' | 'FACE_LOST' | 'ABSENT';
  blinkRate: number;
  score: number;
  ear: number;
}

interface AlertModalProps {
  alertLevel: AlertLevel;
  detections: DetectionFlags;
  onAcknowledge: () => void;
}

type DisplayLevel = Exclude<AlertLevel, 'NONE'> | 'INFO';

const LEVEL_STYLES: Record<DisplayLevel, { border: string; badge: string; title: string }> = {
  CAUTION: {
    border: 'border-yellow-400',
    badge: 'bg-yellow-500',
    title: 'Caution',
  },
  WARNING: {
    border: 'border-amber-400',
    badge: 'bg-amber-500',
    title: 'Warning',
  },
  CRITICAL: {
    border: 'border-red-500',
    badge: 'bg-red-600 animate-pulse',
    title: 'Critical',
  },
  INFO: {
    border: 'border-indigo-400',
    badge: 'bg-indigo-500',
    title: 'Attention',
  },
};

function buildDetectionList(d: DetectionFlags): string[] {
  const items: string[] = [];
  if (d.isMicrosleep) items.push('Microsleep (eyes closed too long)');
  if (d.isYawnAlert) items.push('Frequent yawning detected — consider taking a break');
  else if (d.isYawning) items.push('Yawning');
  if (d.isDistracted) items.push('Looking away / distracted');
  if (d.eyesNotClearlyVisible) items.push('Eyes not clearly visible');
  if (d.facePresence === 'FACE_LOST') items.push('Face tracking unstable');
  if (d.facePresence === 'ABSENT') items.push('Driver not in frame');
  // Blink rate is display-only (footer / stats) — do not treat high/low as a warning reason.
  if (d.score >= 50 && items.length === 0) {
    items.push(`Elevated drowsiness score (${Math.round(d.score)}%)`);
  }
  if (items.length === 0) items.push(`Monitoring — score ${Math.round(d.score)}%`);
  return items;
}

function resolveDisplayLevel(alertLevel: AlertLevel, d: DetectionFlags): DisplayLevel | null {
  if (alertLevel !== 'NONE') return alertLevel;
  if (d.facePresence === 'ABSENT') return 'WARNING';
  if (d.isYawnAlert) return 'CAUTION';
  if (d.eyesNotClearlyVisible) return 'INFO';
  return null;
}

export const AlertModal: React.FC<AlertModalProps> = ({
  alertLevel,
  detections,
  onAcknowledge,
}) => {
  const { settings } = useAppContext();
  const isCritical = alertLevel === 'CRITICAL';
  const displayLevel = resolveDisplayLevel(alertLevel, detections);
  const visible = displayLevel !== null;

  useEffect(() => {
    if (!isCritical) return;

    const volume = Math.min(1, Math.max(0, settings.volume));
    const peak = 0.35 * volume;
    if (peak <= 0) return;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 800;

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(peak, now);
    gain.gain.setValueAtTime(0, now + 0.2);
    gain.gain.setValueAtTime(peak, now + 0.4);
    gain.gain.setValueAtTime(0, now + 0.6);
    osc.start();

    return () => {
      try {
        osc.stop();
        ctx.close();
      } catch {
        /* already closed */
      }
    };
  }, [isCritical, settings.volume]);

  if (!visible || !displayLevel) return null;

  const style = LEVEL_STYLES[displayLevel];
  const detectionsList = buildDetectionList(detections);

  const subtitle =
    detections.facePresence === 'ABSENT' && alertLevel === 'NONE'
      ? 'Face has been out of frame — please look at the camera.'
      : detections.isYawnAlert && alertLevel === 'NONE'
        ? 'Multiple yawns in a short time — take a break if you can.'
        : detections.eyesNotClearlyVisible && alertLevel === 'NONE'
          ? 'Eyes not clearly visible — remove sunglasses or coverings.'
          : isCritical
            ? 'Pull over safely when you can.'
            : 'Fatigue signals detected — stay alert.';

  return (
    <div
      className={`fixed bottom-4 left-4 z-50 w-[min(100%-2rem,22rem)] rounded-2xl border-2 bg-slate-950/95 text-white shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-4 fade-in duration-200 ${style.border}`}
      role="status"
      aria-live="polite"
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.badge}`}>
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide">{style.title}</h2>
              <span className="text-xs font-mono opacity-70">{Math.round(detections.score)}%</span>
            </div>
            <p className="mt-1 text-xs text-slate-300">{subtitle}</p>

            <ul className="mt-3 space-y-1.5">
              {detectionsList.map(item => (
                <li key={item} className="flex items-start gap-2 text-sm text-slate-100">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.badge}`} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
              <span>EAR {detections.ear.toFixed(3)}</span>
              <span>Blinks {Math.round(detections.blinkRate)}/min</span>
            </div>

            {isCritical && (
              <Button
                onClick={onAcknowledge}
                variant="danger"
                size="sm"
                className="mt-3 w-full"
              >
                I AM AWAKE
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
