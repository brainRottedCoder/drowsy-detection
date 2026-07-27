import {
  deriveClosedThreshold,
  derivePersonalEarThresholds,
  deriveYawPitchGates,
  deriveYawnMarThreshold,
  median,
  openEyeBaseline,
  validateOpenClosedGap,
  buildCalibrationPreview,
  emptyCalibrationBuffers,
  previewToCalibrationData,
} from '../../utils/calibration';
import { DEFAULT_DETECTION } from '../../services/storage';

describe('calibration helpers', () => {
  it('T-01 measured gap yields closeAt between open and closed', () => {
    const { closeAt, openAt, usedFallback } = derivePersonalEarThresholds(0.32, 0.12, DEFAULT_DETECTION);
    expect(usedFallback).toBe(false);
    expect(closeAt).toBeGreaterThan(0.12);
    expect(closeAt).toBeLessThan(0.32);
    expect(openAt).toBeGreaterThan(closeAt);
  });

  it('T-02 clamps high open EAR thresholds', () => {
    const { closeAt, openAt } = derivePersonalEarThresholds(0.9, 0.1, DEFAULT_DETECTION);
    expect(closeAt).toBeLessThanOrEqual(DEFAULT_DETECTION.earThresholdMax);
    expect(openAt).toBeGreaterThanOrEqual(closeAt);
  });

  it('T-03 clamps low values to min', () => {
    const { closeAt } = derivePersonalEarThresholds(0.15, 0.05, {
      ...DEFAULT_DETECTION,
      earThresholdMin: 0.12,
    });
    expect(closeAt).toBeGreaterThanOrEqual(0.12);
  });

  it('T-04 falls back when closed missing', () => {
    const { closeAt, usedFallback } = derivePersonalEarThresholds(0.3, null, DEFAULT_DETECTION);
    expect(usedFallback).toBe(true);
    expect(closeAt).toBeCloseTo(deriveClosedThreshold(0.3, DEFAULT_DETECTION), 5);
  });

  it('T-05 gap too small fails validation', () => {
    const result = validateOpenClosedGap(0.2, 0.18);
    expect(result.ok).toBe(false);
  });

  it('T-06 MAR personal threshold in range', () => {
    const t = deriveYawnMarThreshold(0.2, 0.7);
    expect(t).toBeGreaterThanOrEqual(0.4);
    expect(t).toBeLessThanOrEqual(0.75);
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThan(0.7);
  });

  it('T-07 yaw gate from extremes', () => {
    const gates = deriveYawPitchGates([-0.4, 0.3, 0], [0.1, -0.05], 0, 0);
    expect(gates.yawGateThreshold).toBeCloseTo(0.6 * 0.4, 5);
    expect(gates.yawGateThreshold).toBeGreaterThanOrEqual(0.12);
    expect(gates.yawGateThreshold).toBeLessThanOrEqual(0.35);
  });

  it('T-08 median odd and even', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('openEyeBaseline prefers upper half', () => {
    const baseline = openEyeBaseline([0.1, 0.12, 0.3, 0.32, 0.34, 0.36]);
    expect(baseline).toBeGreaterThan(0.2);
  });

  it('buildCalibrationPreview and previewToCalibrationData', () => {
    const buffers = emptyCalibrationBuffers();
    for (let i = 0; i < 50; i++) buffers.openEAR.push(0.3 + (i % 5) * 0.01);
    for (let i = 0; i < 40; i++) buffers.closedEAR.push(0.1 + (i % 3) * 0.005);
    buffers.yaw.push(0, 0.2, -0.2);
    buffers.pitch.push(0, 0.1, -0.1);
    buffers.centerYaw.push(0);
    buffers.centerPitch.push(0);
    buffers.blinkEvents.push({ durationMs: 200 }, { durationMs: 250 });

    const preview = buildCalibrationPreview(buffers, DEFAULT_DETECTION, {
      durationMs: 30_000,
      skippedMouth: true,
    });
    expect(preview.gapOk).toBe(true);
    expect(preview.skippedMouth).toBe(true);

    const data = previewToCalibrationData(preview);
    expect(data.isCalibrated).toBe(true);
    expect(data.profileVersion).toBe(2);
    expect(data.openThreshold).toBeDefined();
    expect(data.closedEAR).toBeDefined();
  });
});
