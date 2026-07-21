# Drowsy Detector — AI Project Context

> **How to use this file:** Paste the entire contents into Claude (or another AI) at the start of a session, or attach it as context when working on this repo. It summarizes architecture, conventions, and current behavior as of March 2026.

---

## 1. What This Project Is

**Drowsy Detector** is a browser-based real-time drowsiness monitoring app. It uses the user's webcam and **MediaPipe Face Landmarker** to detect facial landmarks entirely on the client — no video is uploaded.

**Primary user flow:**
1. Home (`/`) → Start Monitoring
2. Monitor (`/monitor`) → grant camera, calibrate (~5 s), continuous detection
3. Settings (`/settings`) → tune sensitivity, score weights, alert thresholds, detection params
4. Map (`/map`) → mock rest-stop / route visualization (placeholder)

**Core detection signals:** PERCLOS, EAR, blink rate, yawning (MAR), head pose, microsleep, distraction (look-away), face absence, eye visibility (UI warning only).

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4, Radix UI primitives, Lucide icons |
| Vision | `@mediapipe/tasks-vision` 0.10.22 — Face Landmarker (468 landmarks) |
| State | React Context (`AppContext`) + `localStorage` persistence |
| Audio | Web Audio API (AlertModal beep) |
| Tests | `@testing-library/react` (manual test scripts, no Jest config in package.json) |

**Run commands:**
```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

---

## 3. Directory Structure

```
drowsy-detector-frontend/
├── app/                          # Next.js App Router pages
│   ├── layout.tsx                # Root layout + AppProvider
│   ├── page.tsx                  # Landing / home
│   ├── monitor/page.tsx          # Main detection UI (orchestrator)
│   ├── settings/page.tsx         # All tunable detection settings
│   └── map/page.tsx              # Map view (mock data)
│
├── components/
│   ├── ui/                       # shadcn/Radix UI primitives (Button, Slider, etc.)
│   ├── CameraViewport/           # Video + landmark overlay canvas
│   ├── StatusCard/               # Score, EAR, MAR, blink rate display
│   ├── AlertModal/               # Non-blocking bottom-left alert panel
│   ├── CalibrationModal/         # First-run / recalibrate prompt
│   ├── DetectionActivityPanel/   # Live activity log sidebar
│   ├── MapPanel/                 # Embedded map on monitor page
│   └── settings/SettingControls.tsx  # Reusable settings UI (SectionCard, SliderRow, etc.)
│
├── context/
│   └── AppContext.tsx            # Global settings + calibration state
│
├── hooks/
│   ├── useCamera.ts              # Webcam stream + device selection
│   ├── useFaceLandmarks.ts       # MediaPipe Face Landmarker (rAF loop)
│   ├── useDrowsiness.ts          # Core scoring + alert levels + calibration
│   ├── useFacePresence.ts        # Debounced PRESENT / FACE_LOST / ABSENT
│   ├── useEyeVisibility.ts       # Sunglasses/occlusion UI warning (does NOT gate scoring)
│   └── eyeVisibility/            # Pluggable eye visibility backend
│       ├── types.ts
│       ├── createBackend.ts      # Factory (landmark backend default)
│       ├── landmarkBackend.ts    # Geometry + pixel-luma occlusion heuristics
│       └── cropHelpers.ts        # Eye region cropping from video frame
│
├── services/
│   ├── storage.ts                # localStorage types + defaults + getters/setters
│   └── maps.ts                   # Mock map / rest-stop data
│
├── utils/
│   ├── math.ts                   # EAR, MAR, head pose, PERCLOS helpers
│   └── visibility.ts             # DOM visibility helpers
│
└── tests/hooks/
    ├── useDrowsiness.test.ts
    ├── useCamera.test.ts
    └── eyeVisibility.test.ts
```

---

## 4. Architecture & Data Flow

```
Camera (getUserMedia)
    ↓
useCamera → videoRef
    ↓
useFaceLandmarks (MediaPipe, ~30 FPS via requestAnimationFrame)
    ↓ landmarks[468]
    ├── useFacePresence → PRESENT | FACE_LOST | ABSENT
    ├── useEyeVisibility (400ms interval, UI only)
    └── useDrowsiness → alertLevel, drowsinessScore, signals
            ↓
MonitorPage → CameraViewport, StatusCard, DetectionActivityPanel, AlertModal
```

**Monitor page is the orchestrator.** It wires all hooks and passes a `detectionSnapshot` to `DetectionActivityPanel`.

**Settings flow:** `AppContext` reads/writes `services/storage.ts` → localStorage keys `drowsy-settings` and `drowsy-calibration`.

---

## 5. Detection Algorithm (useDrowsiness.ts)

### 5.1 Landmark Indices (MediaPipe Face Mesh)

```typescript
LEFT_EYE  = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]
MOUTH     = [61, 81, 311, 291, 402, 178]
```

### 5.2 Metrics

| Signal | Source | Notes |
|--------|--------|-------|
| **EAR** | `calculateEAR()` in `utils/math.ts` | Eye open ~0.2–0.4; closed below calibrated threshold |
| **MAR** | Same formula on mouth landmarks | Yawn when MAR > `yawnMarThreshold` for N frames |
| **PERCLOS** | Time-weighted closure intervals | Excludes blinks; uses `perclosWindowMs` (default 60 s) |
| **Blink rate** | Blink intervals in rolling window | Compared to calibration baseline |
| **Head pose** | `estimateHeadPose()` — nose vs eye midpoint | Yaw/pitch vs calibrated baseline |
| **Microsleep** | Eyes closed ≥ `microsleepMs` (default 2 s) | Forces score = 100 |
| **Distraction** | \|yaw\| > gate for ≥ `lookAwayDistractionMs` | Suspends eye closure tracking while looking away |
| **Yawn alert** | ≥ `yawnAlertCount` yawns in `yawnAlertWindowMs` | Independent of main score |

### 5.3 Eye Closure Hysteresis

- **Close threshold:** `calibration.threshold` (derived from baseline EAR × `earClosedRatio`)
- **Open threshold:** hysteresis via `earOpenRatio` — eyes stay "closed" until both eyes exceed open threshold
- **Closure types:** `blink` (< blinkMaxMs), `droop` (< microsleepMs), `microsleep` (≥ microsleepMs)

### 5.4 Drowsiness Score (0–100)

Weighted sum of normalized sub-scores:

```
score = (perclos×w.perclos + earScore×w.ear + blinkRateScore×w.blinkRate
         + yawnScore×w.yawn + headPoseScore×w.headPose) × 100
score *= (0.5 + sensitivity)   // sensitivity 0–1, default 0.5 → multiplier 1.0
if microsleep active → score = 100
```

**Default weights:** PERCLOS 0.40, EAR 0.20, blink 0.15, yawn 0.15, head pose 0.10

### 5.5 Alert Levels (with hysteresis)

| Level | Default enter score | Behavior |
|-------|---------------------|----------|
| NONE | — | No alert |
| CAUTION | ≥ 30 | Yellow |
| WARNING | ≥ 50 | Amber |
| CRITICAL | ≥ 75 | Red + audio beep |

- **Escalation:** immediate when score crosses threshold
- **De-escalation:** requires score below (current − `downgradeHysteresis`) for `downgradeStableMs`
- `isDrowsy` is true only when `alertLevel === 'CRITICAL'`

### 5.6 Calibration (5 seconds)

Collects EAR, yaw, pitch, blink events → computes:
- `baselineEAR` — median of upper half of EAR samples (open-eye baseline)
- `threshold` — `deriveClosedThreshold(baselineEAR, detectionSettings)`
- `baselineYaw`, `baselinePitch`
- `baselineBlinkRate`, `baselineBlinkDurationMs`

Stored in `CalibrationData` via `AppContext.updateCalibration()`.

---

## 6. Eye Visibility (useEyeVisibility.ts)

**Purpose:** UI warning when eyes are obscured (sunglasses, hand). **Does NOT pause or modify drowsiness scoring.**

- Samples every 400 ms via pluggable `EyeVisibilityBackend` (default: landmark + pixel-luma heuristics)
- States per eye: `VISIBLE` | `NOT_VISIBLE` | `UNKNOWN`
- Closed eyelids remain `VISIBLE`
- Bilateral opaque-lens detection for sunglasses
- Smoothed over 6-sample window with enter/exit dwell (`eyeVisibilityEnterMs` / `eyeVisibilityExitMs`)
- Toggle: `detection.eyeVisibilityEnabled`

Future: TFLite backend at `public/models/eye_visibility.tflite` (interface already defined in `types.ts`).

---

## 7. Key Types (services/storage.ts)

```typescript
interface UserSettings {
  sensitivity: number;          // 0–1
  volume: number;               // 0–1
  telemetryEnabled: boolean;
  deviceId: string;
  detection: DetectionSettings;
  scoreWeights: ScoreWeights;
  alertLevels: AlertLevelSettings;
}

interface CalibrationData {
  baselineEAR: number;
  threshold: number;
  isCalibrated: boolean;
  baselineBlinkRate: number;
  baselineBlinkDurationMs: number;
  baselineYaw: number;
  baselinePitch: number;
}

interface DetectionSettings {
  // Eye closure: blinkMaxMs, microsleepMs, perclosWindowMs, earClosedRatio, etc.
  // Head pose: yawGateThreshold, pitchGateDelta, lookAwayDistractionMs
  // Yawn: yawnMarThreshold, yawnFramesThreshold, yawnAlertWindowMs, yawnAlertCount
  // Face: faceLostGraceMs, faceAbsentAfterMs
  // Eye visibility: eyeVisibilityEnabled, eyeVisibilityEnterMs, eyeVisibilityExitMs
}
```

All defaults are in `DEFAULT_DETECTION`, `DEFAULT_SCORE_WEIGHTS`, `DEFAULT_ALERT_LEVELS` in `storage.ts`.

---

## 8. Component Responsibilities

| Component | Role |
|-----------|------|
| `CameraViewport` | Renders `<video>` (mirrored) + canvas landmark dots; calibration spinner |
| `StatusCard` | Color-coded status (OK/CAUTION/WARNING/DROWSY), score, EAR, MAR, blink |
| `AlertModal` | Bottom-left non-blocking panel; plays beep on CRITICAL; shows detection reasons |
| `CalibrationModal` | Prompts user before first run; triggers `startCalibration()` |
| `DetectionActivityPanel` | Scrollable timestamped log of detection events |
| `SettingControls` | `SectionCard`, `SliderRow`, `NumberRow`, `WeightSumBanner` |

---

## 9. AppContext API

```typescript
const {
  settings, calibration,
  updateSettings,           // Partial<UserSettings>
  updateDetection,          // Partial<DetectionSettings>
  updateScoreWeights,       // Partial<ScoreWeights>
  updateAlertLevels,        // Partial<AlertLevelSettings>
  updateCalibration,        // Partial<CalibrationData>
  resetCalibration,
  resetDetectionDefaults,   // Keeps deviceId + telemetryEnabled
} = useAppContext();
```

---

## 10. Hook Return Types (Quick Reference)

### useCamera
`{ videoRef, devices, currentDeviceId, setDeviceId, error, permissionGranted }`

### useFaceLandmarks(videoRef)
`{ landmarks, isReady, error }` — landmarks is `Point[]` (468 points) or empty

### useDrowsiness(landmarks)
`{ alertLevel, drowsinessScore, currentEAR, currentMAR, isYawning, yawnCount, isYawnAlert, isMicrosleep, isDistracted, facePresence, blinkRate, isCalibrating, startCalibration, stopCalibration, calibrationProgress, resetState, isDrowsy }`

### useEyeVisibility(videoRef, landmarks)
`{ left, right, overall, confidence, eyesNotClearlyVisible, debug }`

### useFacePresence(landmarks)
`{ presence, absentDurationMs }`

---

## 11. Coding Conventions

- **Client components:** Pages using hooks have `'use client'` directive
- **Imports:** Relative paths (`../../hooks/...`), not path aliases (except `@/` in some ui components via shadcn)
- **Styling:** Tailwind utility classes; dark monitor page uses `bg-slate-900`, settings uses `bg-slate-50`
- **State in hooks:** Heavy use of `useRef` for frame-by-frame data to avoid re-render storms
- **Settings UI:** Grouped into numbered sections on settings page; validation/clamping in page handlers
- **Tests:** Pure function tests exported from hooks (e.g. `deriveClosedThreshold`) + hook behavior tests
- **Privacy:** All CV processing is client-side; telemetry is opt-in and not implemented server-side

---

## 12. Recent / In-Progress Changes (Git)

These are active or recent refactors — AI should treat as current:

- **Removed:** `hooks/useGlassesDetection.ts` — replaced by `useEyeVisibility` + `eyeVisibility/` module
- **Added:** Full settings page with granular detection tuning (10 sections)
- **Added:** Multi-level alerts (CAUTION/WARNING/CRITICAL) with hysteresis
- **Added:** Yawn detection, distraction detection, face presence states
- **Added:** `DetectionActivityPanel` for live event logging
- **Added:** Eye visibility warning (UI-only, landmark backend)
- **Updated:** Scoring from simple PERCLOS+consecutive to 5-factor weighted model

---

## 13. Known Limitations

- Single face only (`numFaces: 1` in MediaPipe config)
- Head pose is geometric approximation, not true 3D pose
- Map/rest stops are mock data (`services/maps.ts`)
- Session timer on monitor page is hardcoded placeholder ("01:24:30")
- No npm test script configured (tests exist but may need manual runner)
- Performance varies by device; GPU delegate preferred, CPU fallback via XNNPACK
- Sunglasses / poor lighting reduce landmark accuracy

---

## 14. Common Tasks for AI Assistants

| Task | Start Here |
|------|------------|
| Change detection sensitivity | `services/storage.ts` defaults, `useDrowsiness.ts` scoring |
| Add new detection signal | `useDrowsiness.ts` → add sub-score → `scoreWeights` in storage |
| Tune alert UI | `components/AlertModal/AlertModal.tsx` |
| Add settings control | `app/settings/page.tsx` + `SettingControls.tsx` |
| Fix camera issues | `hooks/useCamera.ts` (constraint fallback chain) |
| Fix MediaPipe loading | `hooks/useFaceLandmarks.ts` (CDN URLs, GPU/CPU fallback) |
| Eye visibility logic | `hooks/eyeVisibility/landmarkBackend.ts` |
| Persist new setting | Add field to `DetectionSettings` in `storage.ts`, merge in `getSettings()` |

---

## 15. File Index (Non-UI)

| File | Purpose |
|------|---------|
| `hooks/useDrowsiness.ts` | Core detection engine (~500 lines) |
| `hooks/useFaceLandmarks.ts` | MediaPipe init + rAF detection loop |
| `hooks/useEyeVisibility.ts` | Eye occlusion sampling + smoothing |
| `hooks/useFacePresence.ts` | Face absence debouncing |
| `hooks/useCamera.ts` | Webcam with constraint fallback |
| `services/storage.ts` | All persisted types and defaults |
| `context/AppContext.tsx` | Global state provider |
| `utils/math.ts` | EAR, MAR, head pose, PERCLOS |
| `app/monitor/page.tsx` | Main app wiring (~285 lines) |
| `app/settings/page.tsx` | Full settings UI (~555 lines) |
| `components/AlertModal/AlertModal.tsx` | Alert display + audio |
| `components/DetectionActivityPanel/DetectionActivityPanel.tsx` | Activity log |

---

## 16. Environment & Deployment

- **Node:** 18+
- **Deploy:** Vercel-friendly (Next.js); `@vercel/analytics` included
- **External CDN deps at runtime:** MediaPipe WASM + model from Google CDN / jsDelivr
- **No backend required** for core functionality
- **No `.env` required** for basic operation

---

*Generated for AI context. Update this file when architecture or major features change.*
