# Drowsy Detector (Frontend)

A minimal, professional, browser-based drowsiness detection application using React, TypeScript, and MediaPipe FaceMesh. Runs fully offline after the one-time dependency install.

## Features

- **Real-time Drowsiness Detection**: Uses client-side computer vision to monitor Eye Aspect Ratio (EAR) and PERCLOS.
- **Privacy First**: All video processing happens locally in the browser. No video is uploaded.
- **Offline Ready**: MediaPipe WASM, face landmarker model, and ONNX runtimes are served from `public/` (no CDN at runtime).
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

- Node.js **20.9+** (required by Next.js 16)
- npm
- A webcam and a modern browser (Chrome, Edge, Firefox, or Safari)
- Network access **once** for `npm install` (downloads packages and, if missing, `face_landmarker.task`)

### Installation

1. Clone the repository and enter the project folder.

2. Install dependencies (also vendors offline ML assets via `postinstall`):

   ```bash
   npm install
   ```

   This runs `scripts/vendor-assets.mjs`, which:
   - Copies ONNX Runtime WASM → `public/ort/`
   - Copies MediaPipe WASM → `public/mediapipe/wasm/`
   - Downloads `face_landmarker.task` → `public/models/` if not already present

   You can re-run vendoring anytime with:

   ```bash
   npm run vendor:assets
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) and allow camera access.

### Production (offline-capable)

```bash
npm run build
npm start
```

After `npm install` has completed once, you can disconnect from the network and still use `npm run build` / `npm start` / `npm run dev` as long as `public/mediapipe/`, `public/models/face_landmarker.task`, and `public/ort/` are present.

### Offline verification

1. Complete `npm install` while online.
2. Turn on airplane mode (or disconnect Wi‑Fi/Ethernet).
3. Run `npm run build && npm start` (or `npm run dev`).
4. Open the Monitor page, grant camera access, and confirm face landmarks appear.
5. In DevTools → Network, confirm there are **no** requests to:
   - `cdn.jsdelivr.net`
   - `storage.googleapis.com`
   - `fonts.googleapis.com` / `fonts.gstatic.com`
   - `vercel` analytics endpoints

## Usage

1. **Grant Permissions**: Allow camera access when prompted.
2. **Calibrate**: Follow the on-screen instructions to calibrate the detector to your eyes.
3. **Monitor**: Keep the "Monitor" tab open while driving. The app will alert you if you show signs of drowsiness.
4. **Alerts**: If an alert triggers, tap "I AM AWAKE" to dismiss it.

## Project Structure

```
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
├─ scripts/             # Offline asset vendoring (postinstall)
├─ public/              # Static assets (mediapipe, models, ort)
└─ utils/               # Math & Helper functions
```

## Testing

Run the test suite:

```bash
npm test
```

## License

MIT
