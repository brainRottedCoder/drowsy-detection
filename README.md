# Drowsy Detector (Frontend)

A minimal, professional, browser-based drowsiness detection application using React, TypeScript, and MediaPipe FaceMesh.

## Features

- **Real-time Drowsiness Detection**: Uses client-side computer vision to monitor Eye Aspect Ratio (EAR) and PERCLOS.
- **Privacy First**: All video processing happens locally in the browser. No video is uploaded.
- **Smart Alerts**: Visual and audio alarms trigger when drowsiness is detected.
- **Navigation Integration**: Suggests nearest rest stops when the driver is tired.
- **Responsive Design**: Optimized for desktop and tablet use.

## Tech Stack

- **Framework**: React (Next.js App Router for v0 compatibility)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Vision**: MediaPipe FaceMesh
- **State**: React Context
- **Audio**: Howler.js / Web Audio API

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. Clone the repository:
   \`\`\`bash
   git clone https://github.com/yourusername/drowsy-detector.git
   cd drowsy-detector
   \`\`\`

2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

3. Run the development server:
   \`\`\`bash
   npm run dev
   \`\`\`

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. **Grant Permissions**: Allow camera access when prompted.
2. **Calibrate**: Follow the on-screen instructions to calibrate the detector to your eyes.
3. **Monitor**: Keep the "Monitor" tab open while driving. The app will alert you if you show signs of drowsiness.
4. **Alerts**: If an alert triggers, tap "I AM AWAKE" to dismiss it.

## Project Structure

\`\`\`
frontend/
├─ app/                 # Next.js App Router pages
├─ components/          # Reusable UI components
│  ├─ ui/               # Basic UI elements (Button, etc.)
│  ├─ CameraViewport/   # Video & Canvas overlay
│  ├─ StatusCard/       # Drowsiness status display
│  └─ ...
├─ hooks/               # Custom React hooks
│  ├─ useCamera.ts      # Camera management
│  ├─ useDrowsiness.ts  # Detection logic (EAR, PERCLOS)
│  └─ useFaceLandmarks.ts # MediaPipe integration
├─ context/             # Global state (Settings, Calibration)
├─ services/            # Mock services (Maps, Storage)
└─ utils/               # Math & Helper functions
\`\`\`

## Testing

Run the test suite:

\`\`\`bash
npm test
\`\`\`

## License

MIT
