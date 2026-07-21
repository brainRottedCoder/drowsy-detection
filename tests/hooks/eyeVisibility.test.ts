import type { Point } from '../../utils/math';
import {
  evaluateEyeGeometry,
  pointInPolygon,
} from '../../hooks/eyeVisibility/landmarkBackend';

/** Build a minimal 478-point mesh for geometry tests. */
function makeLandmarks(overrides: {
  yaw?: 'center' | 'extreme';
  leftIrisInside?: boolean;
  rightIrisInside?: boolean;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  leftEarLow?: boolean;
  rightEarLow?: boolean;
} = {}): Point[] {
  const {
    yaw = 'center',
    leftIrisInside = true,
    rightIrisInside = true,
    leftCollapsed = false,
    rightCollapsed = false,
    leftEarLow = false,
    rightEarLow = false,
  } = overrides;

  const pts: Point[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

  const leftOuter = { x: 0.35, y: 0.42 };
  const leftInner = { x: leftCollapsed ? 0.36 : 0.45, y: 0.42 };
  const rightInner = { x: 0.55, y: 0.42 };
  const rightOuter = { x: rightCollapsed ? 0.56 : 0.65, y: 0.42 };

  const leftHalfH = leftEarLow ? 0.004 : 0.025;
  const rightHalfH = rightEarLow ? 0.004 : 0.025;

  const leftEye = [
    leftOuter,
    { x: 0.38, y: 0.42 - leftHalfH },
    { x: 0.42, y: 0.42 - leftHalfH },
    leftInner,
    { x: 0.42, y: 0.42 + leftHalfH },
    { x: 0.38, y: 0.42 + leftHalfH },
  ];
  const leftIndices = [33, 160, 158, 133, 153, 144];
  leftIndices.forEach((idx, i) => {
    pts[idx] = { ...leftEye[i], z: 0 };
  });

  const rightEye = [
    rightInner,
    { x: 0.58, y: 0.42 - rightHalfH },
    { x: 0.62, y: 0.42 - rightHalfH },
    rightOuter,
    { x: 0.62, y: 0.42 + rightHalfH },
    { x: 0.58, y: 0.42 + rightHalfH },
  ];
  const rightIndices = [362, 385, 387, 263, 373, 380];
  rightIndices.forEach((idx, i) => {
    pts[idx] = { ...rightEye[i], z: 0 };
  });

  pts[1] =
    yaw === 'extreme'
      ? { x: 0.72, y: 0.55, z: 0 }
      : { x: 0.5, y: 0.55, z: 0 };

  pts[468] = leftIrisInside
    ? { x: (leftOuter.x + leftInner.x) / 2, y: 0.42, z: 0 }
    : { x: 0.2, y: 0.2, z: 0 };
  pts[473] = rightIrisInside
    ? { x: (rightOuter.x + rightInner.x) / 2, y: 0.42, z: 0 }
    : { x: 0.9, y: 0.2, z: 0 };

  return pts;
}

const defaultOpts = {
  yawGate: 0.18,
  pitchGate: 0.14,
  baselinePitch: 0.43,
};

describe('pointInPolygon', () => {
  it('detects points inside a square', () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, square)).toBe(false);
  });
});

describe('evaluateEyeGeometry', () => {
  it('returns VISIBLE when iris is inside contour on a frontal face', () => {
    const landmarks = makeLandmarks({ leftIrisInside: true, rightIrisInside: true });
    const left = evaluateEyeGeometry(landmarks, 'left', defaultOpts);
    const right = evaluateEyeGeometry(landmarks, 'right', defaultOpts);
    expect(left.state).toBe('VISIBLE');
    expect(right.state).toBe('VISIBLE');
    expect(left.debug.irisInContour).toBe(true);
    expect(left.debug.poseOk).toBe(true);
  });

  it('returns UNKNOWN on extreme yaw (not NOT_VISIBLE)', () => {
    const landmarks = makeLandmarks({ yaw: 'extreme' });
    const left = evaluateEyeGeometry(landmarks, 'left', defaultOpts);
    expect(left.state).toBe('UNKNOWN');
    expect(left.debug.poseOk).toBe(false);
  });

  it('returns NOT_VISIBLE when iris is outside and eye is collapsed under frontal pose', () => {
    const landmarks = makeLandmarks({
      leftIrisInside: false,
      leftCollapsed: true,
    });
    const left = evaluateEyeGeometry(landmarks, 'left', defaultOpts);
    expect(left.state).toBe('NOT_VISIBLE');
    expect(left.debug.irisInContour).toBe(false);
    expect(left.debug.eyeWidthOk).toBe(false);
  });

  it('keeps closed eyes VISIBLE when iris remains in contour', () => {
    const landmarks = makeLandmarks({ leftEarLow: true, leftIrisInside: true });
    const left = evaluateEyeGeometry(landmarks, 'left', defaultOpts);
    expect(left.state).toBe('VISIBLE');
    expect(left.debug.earOk).toBe(true);
    expect(left.debug.irisInContour).toBe(true);
  });

  it('returns UNKNOWN for empty landmarks', () => {
    const result = evaluateEyeGeometry([], 'left', defaultOpts);
    expect(result.state).toBe('UNKNOWN');
  });
});
