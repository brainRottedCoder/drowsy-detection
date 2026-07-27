# Plan: Guided Face Profile Calibration + Name-Based User Profiles

**Status:** Implemented  
**Date:** 2026-07-27  
**Scope:** Private / local deployment only — no password auth, no backend security model.

---

## 1. Goals

### 1.1 Guided face profile (~30s)
Replace the current single-phase 5s “look naturally” calibration with a **multi-step, instruction-based** facial profile so EAR / MAR / head-pose / blink thresholds adapt to each person’s face geometry (including large population differences in eyelid shape).

### 1.2 Simple name-based “sign-in”
Add a lightweight local identity: user enters a **display name**, and all settings + calibration for that name are saved and restored. No passwords, email, OAuth, or server accounts. Suitable for a private LAN / kiosk / shared lab machine.

### 1.3 Non-goals
- Real authentication, encryption, multi-device sync, or cloud backup
- Changing the MediaPipe detection stack
- Server-side persistence
- Public multi-tenant security

---

## 2. Current state (baseline)

| Area | Today |
|------|--------|
| Calibration UX | `CalibrationModal` — 5s natural gaze |
| Calibration logic | `useDrowsiness` buffers EAR/yaw/pitch/blinks → `finishCalibration` |
| Closed EAR | Inferred: `baselineEAR × earClosedRatio` (not measured closed) |
| Open hysteresis | Hardcoded `closeAt + 0.04`; `earOpenRatio` stored but unused in runtime |
| Persistence | Global `localStorage` keys `drowsy-settings`, `drowsy-calibration` |
| Users | None — one shared profile per browser |
| Settings UI | Shows baselines + “Reset Calibration” only |

**Key files:**
- `hooks/useDrowsiness.ts`
- `services/storage.ts`
- `context/AppContext.tsx`
- `components/CalibrationModal/CalibrationModal.tsx`
- `app/monitor/page.tsx`
- `app/settings/page.tsx`
- `app/page.tsx`

---

## 3. Feature A — Guided Face Profile Calibration

### 3.1 User flow

```
Entry (first run | Settings “Recalibrate” | Monitor “Recalibrate”)
  → Wizard opens over live camera
  → Phase instructions auto-advance when samples are valid (or timeout + retry)
  → Summary screen (derived thresholds)
  → Confirm → save CalibrationData → resume monitoring
```

### 3.2 Phases (~30s total)

| # | Phase ID | Duration | Instruction | Samples |
|---|----------|----------|-------------|---------|
| 0 | `setup` | ~2s | Face camera, good light, eyes visible | Face present; landmarks stable |
| 1 | `open_eyes` | ~7s | Eyes wide open; look at camera; minimize blinks | Open EAR L/R, low blink blendshapes |
| 2 | `soft_blinks` | ~5s | Blink naturally 3–4 times | Blink trough EAR, duration, blendshape peaks |
| 3 | `closed_eyes` | ~5s | Gently close both eyes | Closed EAR L/R, high blink blendshapes |
| 4 | `head_pose` | ~6s | Look left → right → up → down → center | Yaw/pitch extremes + neutral |
| 5 | `mouth_open` | ~4s | Open mouth wide once (yawn-like) | Resting MAR + open MAR peak |
| — | `summary` | — | Review values; Confirm / Retry | — |

**Quality gates (per phase):**
- Face must be `PRESENT`
- Minimum frame counts (e.g. open ≥ 45, closed ≥ 30)
- `openEAR − closedEAR ≥ 0.05` before accepting profile
- Face lost → pause phase, show “Return to camera”, do not auto-finish with bad data

### 3.3 Derived values (extend `CalibrationData`)

```ts
export interface CalibrationData {
  // Existing
  baselineEAR: number;              // open-eye baseline (median of open samples)
  threshold: number;                // closeAt used for blink/microsleep
  isCalibrated: boolean;
  baselineBlinkRate: number;
  baselineBlinkDurationMs: number;
  baselineYaw: number;
  baselinePitch: number;

  // New
  closedEAR: number;                // measured closed median
  openThreshold: number;            // reopen hysteresis (wire earOpenRatio)
  leftBaselineEAR?: number;
  rightBaselineEAR?: number;
  yawGateThreshold?: number;        // personal look-away gate (optional override)
  pitchGateDelta?: number;          // personal pitch gate
  baselineMAR?: number;             // resting mouth
  yawnMarThreshold?: number;        // personal yawn threshold
  blendshapeBlinkEnter?: number;    // optional personalize 0.38 default
  blendshapeBlinkExit?: number;     // optional personalize 0.22 default
  calibratedAt?: number;            // Date.now()
  profileVersion?: number;          // schema version, start at 2
}
```

### 3.4 Threshold formulas

Prefer **measured open/closed gap** over ratio-only inference:

```text
gap      = max(0.01, openEAR - closedEAR)
closeAt  = closedEAR + 0.35 * gap
openAt   = closedEAR + 0.55 * gap
           // or: openEAR * earOpenRatio when measured closed missing
```

Then clamp with `earThresholdMin` / `earThresholdMax`.

**Fallbacks:**
- If closed phase fails → keep today’s `deriveClosedThreshold(baselineEAR, detection)`
- If mouth phase skipped → keep global `yawnMarThreshold` from settings
- If head-pose range too small → keep global yaw/pitch gates

**Head pose:**
```text
neutralYaw/Pitch = mean of center samples
yawGate = clamp(0.6 * max(|left|, |right|), 0.12, 0.35)
pitchGate = clamp(0.6 * max(|up|, |down|), 0.08, 0.25)
```

**MAR:**
```text
yawnMarThreshold = restingMAR + 0.5 * (maxOpenMAR - restingMAR)
                   clamped to [0.40, 0.75]
```

### 3.5 Runtime wiring (`useDrowsiness`)

1. Replace single 5s calibrating buffer with a **phase state machine**:
   - `calibrationPhase`, `calibrationPhaseProgress`, sample refs per phase
2. During any calibration phase: **do not score** drowsiness (same early-return pattern as today)
3. Update `earCloseOpenThresholds()` to use:
   - `calibration.threshold` / `calibration.openThreshold`
   - measured `closedEAR` when present
4. Use personal `yawGateThreshold` / `pitchGateDelta` / `yawnMarThreshold` when set on calibration (else fall back to `settings.detection`)
5. Optionally use personal blendshape enter/exit if stored

### 3.6 UI components

| Component | Change |
|-----------|--------|
| `CalibrationModal` | Upgrade to multi-phase wizard (or rename `FaceProfileWizard`) |
| `CameraViewport` | Show current phase instruction + progress |
| `app/monitor/page.tsx` | First-run wizard; support `?calibrate=1` |
| `app/settings/page.tsx` | “Start guided recalibration” CTA; show new fields (closed EAR, open threshold, MAR, calibratedAt) |
| Activity panel | Log phase start/complete events (optional) |

### 3.7 Implementation steps (Feature A)

1. Extend `CalibrationData` + defaults + migration in `storage.ts`
2. Extract pure helpers: `derivePersonalThresholds`, `median`, phase validators → `utils/calibration.ts` (easy to unit test)
3. Refactor `useDrowsiness` calibration path to phase machine
4. Build wizard UI with instructions, progress, retry, summary
5. Wire Settings + Monitor entry points
6. Wire runtime consumers (`earCloseOpenThresholds`, yawn, head pose)
7. Add unit tests (see §6)
8. Manual QA on different faces / lighting

---

## 4. Feature B — Name-Based Local Sign-In

### 4.1 Concept

- User picks a **name** (e.g. `Shubh`, `Lab-PC-1`)
- App stores a map of profiles in `localStorage`
- Active user id is remembered
- Settings + face calibration are **per user**
- Switching user loads that user’s config instantly
- No passwords; names are case-insensitive keys (normalize: trim + lowercase for key, keep display casing)

### 4.2 Data model

```ts
export interface UserProfile {
  id: string;                 // normalized name key, e.g. "shubh"
  displayName: string;        // "Shubh"
  createdAt: number;
  updatedAt: number;
  settings: UserSettings;
  calibration: CalibrationData;
}

export interface UserDirectory {
  version: 1;
  activeUserId: string | null;
  users: Record<string, UserProfile>;
}
```

**localStorage keys (proposed):**

| Key | Purpose |
|-----|---------|
| `drowsy-users` | Full `UserDirectory` |
| `drowsy-active-user` | Optional shortcut for active id (or only inside directory) |

**Migration from current global keys:**
1. On first load, if `drowsy-users` missing and old `drowsy-settings` / `drowsy-calibration` exist:
   - Create user `"default"` (displayName `"Default"`) with existing data
   - Set as active
2. Keep reading old keys only for migration; thereafter write through user directory
3. Optionally leave old keys until migration succeeds (do not delete until verified)

### 4.3 UX

**Home (`app/page.tsx`) or small auth gate:**
- If no active user → show **Sign in / Create profile**
  - Text input: name
  - Buttons: **Continue** (create if new, load if exists), list of existing names
- If active user → show “Signed in as {name}” + Start Monitoring / Settings / Switch user

**Header / nav (monitor + settings):**
- Chip: current display name
- Menu: Switch user · Create new · Sign out (clear active only; keep data)

**Sign out:** sets `activeUserId = null`; does **not** delete profile  
**Delete profile:** confirm dialog; remove from directory; if active, sign out

### 4.4 AppContext changes

```ts
interface AppContextType {
  // existing settings/calibration APIs...

  currentUser: UserProfile | null;
  users: UserProfile[];                 // list for UI
  signIn: (displayName: string) => void; // create-or-load
  switchUser: (userId: string) => void;
  signOut: () => void;
  deleteUser: (userId: string) => void;
  renameUser?: (userId: string, displayName: string) => void;
}
```

**Persistence rule:** every `updateSettings` / `updateCalibration` / detection patch writes to **active user’s** slot in `drowsy-users`, not global orphan keys.

### 4.5 Implementation steps (Feature B)

1. Add `services/users.ts` (or extend `storage.ts`) with directory CRUD + migration
2. Expand `AppContext` with user APIs; load active profile on mount
3. Build `SignInPanel` / `UserSwitcher` components
4. Integrate on home page + sticky identity chip on monitor/settings
5. Ensure calibration wizard saves into active user
6. Unit tests for migrate / create / switch / delete
7. Manual: two names, different calibrations, switch and verify thresholds change

---

## 5. Suggested delivery order

| Phase | Deliverable | Depends on |
|-------|-------------|------------|
| **P0** | User directory + sign-in UI + migrate old storage | — |
| **P1** | Pure threshold helpers + extended `CalibrationData` | P0 (so saves go per user) |
| **P2** | Phase state machine in `useDrowsiness` | P1 |
| **P3** | Face Profile Wizard UI + Settings/Monitor entry | P2 |
| **P4** | Runtime consume personal open/closed/MAR/pose | P2 |
| **P5** | Tests + polish (retry, summary, delete user) | P0–P4 |

P0 before P1 avoids calibrating into a global bucket that later gets awkward to migrate.

---

## 6. Test cases

Legend: **Unit** = Jest / RTL; **Manual** = human with camera.

### 6.1 Name-based users (Unit)

| ID | Case | Steps / Input | Expected |
|----|------|---------------|----------|
| U-01 | Create first user | `signIn("Shubh")` on empty directory | Profile created; `activeUserId = "shubh"`; defaults for settings/calibration |
| U-02 | Normalize name key | `signIn("  Shubh ")` then `signIn("shubh")` | Same profile; no duplicate |
| U-03 | Reject empty name | `signIn("")` / `"   "` | No create; validation error |
| U-04 | Reject invalid chars (if enforced) | e.g. name with only symbols | Rejected with message |
| U-05 | Second user | Create `"Alex"` while Shubh active | Two users; active becomes Alex; Shubh data untouched |
| U-06 | Switch user | Switch Shubh → Alex | Context settings/calibration match Alex |
| U-07 | Persist settings per user | Change sensitivity on Shubh; switch to Alex; switch back | Shubh sensitivity restored |
| U-08 | Persist calibration per user | Calibrate Shubh; Alex uncalibrated | Only Shubh `isCalibrated === true` |
| U-09 | Sign out | `signOut()` | `currentUser === null`; directory still has users |
| U-10 | Delete active user | Delete while signed in | User removed; signed out |
| U-11 | Delete inactive user | Delete Alex while Shubh active | Alex gone; Shubh still active |
| U-12 | Migration | Old `drowsy-settings` + `drowsy-calibration` present, no directory | Creates Default user with old data; becomes active |
| U-13 | Migration idempotent | Run getDirectory twice | No duplicate Default users |
| U-14 | SSR / no window | Call getters without `window` | Safe defaults; no throw |
| U-15 | Corrupt JSON | Bad `drowsy-users` payload | Fallback empty directory or recover defaults |

### 6.2 Threshold derivation helpers (Unit)

| ID | Case | Input | Expected |
|----|------|-------|----------|
| T-01 | Measured gap | open=0.32, closed=0.12 | `closeAt` between closed and open; `openAt > closeAt` |
| T-02 | Clamp high | Very large open EAR | Thresholds within min/max |
| T-03 | Clamp low | Tiny open/closed | Does not go below `earThresholdMin` |
| T-04 | Fallback no closed | closed missing / NaN | Uses `deriveClosedThreshold(open, detection)` |
| T-05 | Gap too small | open≈closed | Fail validation (`openEAR - closedEAR < 0.05`) |
| T-06 | MAR personal | resting=0.2, open=0.7 | yawn threshold in [0.40, 0.75] and between them |
| T-07 | Yaw gate | left=-0.4, right=0.3 | Gate ≈ 0.6×0.4 clamped |
| T-08 | Median helper | Odd/even sample arrays | Correct median |
| T-09 | openEyeBaseline | Mixed blink + open samples | Prefers upper-half (existing behavior preserved) |

### 6.3 Calibration phase machine (Unit)

| ID | Case | Steps | Expected |
|----|------|-------|----------|
| C-01 | Start | `startCalibration()` | Phase `setup` or `open_eyes`; `isCalibrating true`; score frozen |
| C-02 | Progress | Feed frames for open phase | Progress increases; samples accumulate |
| C-03 | Auto-advance | Enough valid open samples | Moves to `soft_blinks` |
| C-04 | Face lost | Clear landmarks mid-phase | Phase pauses; does not advance; instruction warns |
| C-05 | Closed phase | Feed low EAR frames | `closedEAR` samples collected |
| C-06 | Finish success | All phases valid | `updateCalibration` called with `isCalibrated`, `closedEAR`, `openThreshold`, `calibratedAt` |
| C-07 | Finish fail gap | open≈closed | Does not mark calibrated; exposes retry reason |
| C-08 | Stop / cancel | `stopCalibration()` | Clears phase state; no partial write (or discard) |
| C-09 | No scoring during cal | High PERCLOS-like frames while calibrating | `alertLevel` stays NONE / score not updated |
| C-10 | Legacy 5s path removed | — | Only phase machine path remains (or feature-flagged) |

### 6.4 Runtime use of personal calibration (Unit)

| ID | Case | Setup | Expected |
|----|------|-------|----------|
| R-01 | Uses openThreshold | Personal open/close set | Hysteresis uses stored open, not `+ 0.04` only |
| R-02 | Uses personal yawn MAR | `calibration.yawnMarThreshold = 0.48` | Yawn triggers vs 0.48, not global 0.55 |
| R-03 | Uses personal yaw gate | Personal yaw gate 0.25 | Distraction only beyond 0.25 |
| R-04 | Fallback to settings | Personal fields undefined | Uses `settings.detection` values |
| R-05 | EAR score vs baseline | Different baselines | Score relative to that user’s `baselineEAR` |

### 6.5 UI / integration (Manual)

| ID | Case | Steps | Expected |
|----|------|-------|----------|
| M-01 | First visit | Open app with empty storage | Sign-in screen; cannot skip into orphan global state (or allow guest — decide and document) |
| M-02 | Create + monitor | Sign in → Start Monitoring | Camera works; if not calibrated, wizard opens |
| M-03 | Full 30s wizard | Complete all phases | Summary shows open/closed EAR; Confirm enables detection |
| M-04 | Retry closed eyes | Fail gap → Retry | Re-runs closed (or full) phase |
| M-05 | Cancel wizard | Cancel mid-way | Previous calibration kept if any |
| M-06 | Settings recalibrate | Settings → Recalibrate | Navigates/opens wizard for active user |
| M-07 | Two users different faces | Calibrate A and B differently | Switching users changes displayed baselines and live thresholds |
| M-08 | Refresh page | Reload mid-session | Still signed in as last active user |
| M-09 | Sign out + sign in | Sign out, choose existing name | Same calibration restored |
| M-10 | Delete user | Delete from switcher | Gone from list; data not loadable |
| M-11 | Low light | Run wizard in poor light | Clear failure / retry messaging |
| M-12 | Glasses / monolid | Real user with low open EAR | Measured closed still separates; blinks work better than global 0.18 |
| M-13 | Alert muted in cal | Force drowsy-looking face during wizard | No CRITICAL beep |
| M-14 | Guest mode (if built) | Use without name | Documented behavior: ephemeral or Default user |

### 6.6 Regression (Unit + Manual)

| ID | Case | Expected |
|----|------|----------|
| X-01 | Existing `useDrowsiness` init tests still pass | No break |
| X-02 | Eye visibility tests still pass | No break |
| X-03 | Microsleep / yawn / distraction still fire after calibration | Same semantics, personal thresholds |
| X-04 | Settings sliders still update active user detection | Persisted under active name |
| X-05 | Reset calibration | Clears active user’s calibration; next monitor visit prompts wizard |

---

## 7. File change checklist

### New
- [ ] `PLAN_FACE_PROFILE_AND_USERS.md` (this file)
- [ ] `utils/calibration.ts` — pure derive/validate helpers
- [ ] `services/users.ts` — directory CRUD + migration (or fold into `storage.ts`)
- [ ] `components/SignInPanel/SignInPanel.tsx`
- [ ] `components/UserSwitcher/UserSwitcher.tsx`
- [ ] `components/FaceProfileWizard/FaceProfileWizard.tsx` (upgrade of CalibrationModal)
- [ ] `tests/utils/calibration.test.ts`
- [ ] `tests/services/users.test.ts`
- [ ] `tests/hooks/useDrowsiness.calibration.test.ts`

### Update
- [ ] `services/storage.ts` — extended `CalibrationData`, defaults, migrations
- [ ] `context/AppContext.tsx` — user session APIs; per-user save
- [ ] `hooks/useDrowsiness.ts` — phase machine + personal threshold consumers
- [ ] `components/CalibrationModal/*` — replace or wrap with wizard
- [ ] `components/CameraViewport/CameraViewport.tsx` — phase instruction overlay
- [ ] `app/page.tsx` — sign-in entry
- [ ] `app/monitor/page.tsx` — wizard + user chip + `?calibrate=1`
- [ ] `app/settings/page.tsx` — recalibrate CTA + richer readout + user chip
- [ ] `components/DetectionActivityPanel/*` — optional phase logs
- [ ] `PROJECT_CONTEXT.md` — short note after ship (optional)

---

## 8. Acceptance criteria

1. User can create/select a name and see “Signed in as …”
2. Settings + face calibration are isolated per name and survive refresh
3. Guided ~30s wizard collects open + closed eyes (+ blinks, head, mouth)
4. Detection uses measured personal close/open thresholds when available
5. Recalibrate available from Settings (and ideally Monitor)
6. Old single-user localStorage migrates into a Default profile without data loss
7. Unit tests in §6.1–§6.4 pass; manual checklist §6.5 signed off for at least two people

---

## 9. Open decisions (resolve before / during P0)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Require sign-in before Monitor? | **Yes** for clarity; optional “Continue as Guest” → Default ephemeral |
| D2 | Max name length / charset | 2–32 chars; letters, numbers, spaces, `-_` |
| D3 | Soft blinks phase mandatory? | Preferred; allow skip with warning |
| D4 | Mouth phase mandatory? | Optional skip → keep global MAR |
| D5 | Store personal gates on calibration vs copy into `detection` | Store on **calibration** (overrides); keep settings as global defaults for that user |
| D6 | Delete last remaining user | Allow; force sign-in screen |

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Closed-eye phase cheated (still slightly open) | Gap validation + retry copy |
| Users confuse Reset vs Recalibrate | Clear button labels |
| Migration doubles Default user | Idempotent migration keyed by existence of `drowsy-users` |
| Phase machine complexity in hook | Extract pure helpers; keep hook as orchestrator |
| Shared machine privacy | Document: names are not secure; anyone can pick another name (acceptable for private deploy) |

---

## 11. Out of scope for this plan (future)

- Password / PIN per name
- Export/import profile JSON
- Cloud sync
- Auto ethnicity / demographic presets (calibration replaces this)
- Server-side analytics of calibration quality
