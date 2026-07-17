// Utilities for EAR calculation and distance measurement

export interface Point {
  x: number;
  y: number;
  z?: number;
}

// Euclidean distance between two points
export const euclideanDistance = (p1: Point, p2: Point): number => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

// Calculate Eye Aspect Ratio (EAR)
// EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
// Indices correspond to MediaPipe FaceMesh landmarks for eyes
export const calculateEAR = (eyeLandmarks: Point[]): number => {
  // MediaPipe eye landmarks usually have 16 points per eye.
  // We need specific points for EAR.
  // Assuming the input array is ordered as [top1, top2, bottom1, bottom2, left, right]
  // However, usually we pass the full mesh and pick indices.
  // Let's assume the caller passes the 6 specific points needed for EAR:
  // [left_corner, top_1, top_2, right_corner, bottom_2, bottom_1]
  
  if (eyeLandmarks.length < 6) return 0;

  const p1 = eyeLandmarks[0]; // Left corner (outer)
  const p2 = eyeLandmarks[1]; // Top 1
  const p3 = eyeLandmarks[2]; // Top 2
  const p4 = eyeLandmarks[3]; // Right corner (inner)
  const p5 = eyeLandmarks[4]; // Bottom 2
  const p6 = eyeLandmarks[5]; // Bottom 1

  const vertical1 = euclideanDistance(p2, p6);
  const vertical2 = euclideanDistance(p3, p5);
  const horizontal = euclideanDistance(p1, p4);

  if (horizontal === 0) return 0;

  return (vertical1 + vertical2) / (2.0 * horizontal);
};

// Calculate Mouth Aspect Ratio (MAR) for yawn detection
// Same geometry as EAR: average vertical lip distance over horizontal mouth width.
// Expected point order: [left_corner, top_1, top_2, right_corner, bottom_2, bottom_1]
// Closed mouth ~0.0-0.1, talking ~0.3-0.5, yawning typically > 0.6
export const calculateMAR = (mouthLandmarks: Point[]): number => {
  return calculateEAR(mouthLandmarks);
};

// PERCLOS calculation (Percentage of Closures)
// window: array of binary states (1 = closed, 0 = open)
export const calculatePERCLOS = (history: boolean[]): number => {
  if (history.length === 0) return 0;
  const closedFrames = history.filter((isClosed) => isClosed).length;
  return closedFrames / history.length;
};
