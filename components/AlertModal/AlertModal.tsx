import React, { useEffect, useMemo } from 'react';
import { Button } from '../ui/Button';
import type { AlertLevel } from '../../hooks/useDrowsiness';
import { useAppContext } from '../../context/AppContext';

export interface DetectionFlags {
  isMicrosleep: boolean;
  isYawning: boolean;
  isYawnAlert: boolean;
  yawnsPerMinute: number;
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
  isCalibrating?: boolean;
  onAcknowledge: () => void;
}

type AlertKind = 'person_absent' | 'eyes_not_found' | 'yawn_rate' | 'drowsiness';

interface AlertStyle {
  border: string;
  badge: string;
  titleColor: string;
  pulse?: boolean;
}

interface ActiveAlert {
  kind: AlertKind;
  title: string;
  message: string;
  style: AlertStyle;
  showAcknowledge?: boolean;
}

const ALERT_STYLES: Record<Exclude<AlertKind, 'drowsiness'>, AlertStyle> = {
  person_absent: {
    border: 'border-violet-500',
    badge: 'bg-violet-500',
    titleColor: 'text-violet-300',
  },
  eyes_not_found: {
    border: 'border-cyan-400',
    badge: 'bg-cyan-500',
    titleColor: 'text-cyan-300',
  },
  yawn_rate: {
    border: 'border-orange-400',
    badge: 'bg-orange-500',
    titleColor: 'text-orange-300',
  },
};

const DROWSINESS_STYLES: Record<Exclude<AlertLevel, 'NONE'>, AlertStyle> = {
  CAUTION: {
    border: 'border-yellow-400',
    badge: 'bg-yellow-500',
    titleColor: 'text-yellow-300',
  },
  WARNING: {
    border: 'border-amber-400',
    badge: 'bg-amber-500',
    titleColor: 'text-amber-300',
  },
  CRITICAL: {
    border: 'border-red-500',
    badge: 'bg-red-600 animate-pulse',
    titleColor: 'text-red-300',
    pulse: true,
  },
};

function buildActiveAlerts(
  alertLevel: AlertLevel,
  d: DetectionFlags,
  yawnThresholdPerMin: number
): ActiveAlert[] {
  const alerts: ActiveAlert[] = [];

  if (d.facePresence === 'ABSENT') {
    alerts.push({
      kind: 'person_absent',
      title: 'Person not in frame',
      message: 'Your face has left the camera view. Look back at the camera to resume monitoring.',
      style: ALERT_STYLES.person_absent,
    });
  }

  if (d.eyesNotClearlyVisible && d.facePresence !== 'ABSENT') {
    alerts.push({
      kind: 'eyes_not_found',
      title: 'Eyes not found',
      message: 'Eyes are not clearly visible. Adjust position or remove coverings.',
      style: ALERT_STYLES.eyes_not_found,
    });
  }

  if (d.isYawnAlert) {
    alerts.push({
      kind: 'yawn_rate',
      title: 'High yawn rate',
      message: `${d.yawnsPerMinute.toFixed(1)} yawns/min exceeds threshold of ${yawnThresholdPerMin.toFixed(1)}/min — consider taking a break.`,
      style: ALERT_STYLES.yawn_rate,
    });
  }

  if (alertLevel !== 'NONE') {
    const style = DROWSINESS_STYLES[alertLevel];
    const levelLabel =
      alertLevel === 'CRITICAL' ? 'Critical' : alertLevel === 'WARNING' ? 'Warning' : 'Caution';
    const extras: string[] = [];
    if (d.isMicrosleep) extras.push('microsleep detected');
    if (d.isDistracted) extras.push('looking away');

    alerts.push({
      kind: 'drowsiness',
      title: `Drowsiness — ${levelLabel}`,
      message:
        extras.length > 0
          ? `Score ${Math.round(d.score)}%. Signs: ${extras.join(', ')}. Pull over safely when you can.`
          : `Drowsiness score is ${Math.round(d.score)}%. Stay alert or take a break.`,
      style,
      showAcknowledge: alertLevel === 'CRITICAL',
    });
  }

  return alerts;
}

function AlertCard({
  alert,
  onAcknowledge,
}: {
  alert: ActiveAlert;
  onAcknowledge: () => void;
}) {
  const { style, title, message, showAcknowledge } = alert;

  return (
    <div
      className={`w-[min(100vw-2rem,22rem)] rounded-2xl border-2 bg-slate-950/95 text-white shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-4 fade-in duration-200 ${style.border}`}
      role="status"
      aria-live="polite"
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.badge}`}
          >
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
            <h2 className={`text-sm font-bold uppercase tracking-wide ${style.titleColor}`}>
              {title}
            </h2>
            <p className="mt-1 text-xs text-slate-300">{message}</p>

            {showAcknowledge && (
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
}

export const AlertModal: React.FC<AlertModalProps> = ({
  alertLevel,
  detections,
  isCalibrating = false,
  onAcknowledge,
}) => {
  const { settings } = useAppContext();
  const isCritical = alertLevel === 'CRITICAL';

  const yawnThresholdPerMin = useMemo(() => {
    const { yawnAlertCount, yawnAlertWindowMs } = settings.detection;
    const windowMs = Math.max(10_000, yawnAlertWindowMs);
    return (Math.max(2, Math.round(yawnAlertCount)) / windowMs) * 60_000;
  }, [settings.detection]);

  const activeAlerts = useMemo(
    () => buildActiveAlerts(alertLevel, detections, yawnThresholdPerMin),
    [alertLevel, detections, yawnThresholdPerMin]
  );

  useEffect(() => {
    if (!isCritical || isCalibrating) return;

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
  }, [isCritical, isCalibrating, settings.volume]);

  if (isCalibrating || activeAlerts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col-reverse gap-2 pointer-events-none">
      {activeAlerts.map(alert => (
        <div key={alert.kind} className="pointer-events-auto">
          <AlertCard alert={alert} onAcknowledge={onAcknowledge} />
        </div>
      ))}
    </div>
  );
};
