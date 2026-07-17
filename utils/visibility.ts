// Helper for visibility states and face tracking status

export const isFaceVisible = (landmarks: any): boolean => {
  return !!landmarks && landmarks.length > 0;
};

export const getHeadPose = (landmarks: any) => {
  // Placeholder for head pose estimation if needed later
  // Could return { pitch, yaw, roll }
  return { pitch: 0, yaw: 0, roll: 0 };
};
