/**
 * Download face_landmarker.task into public/models if missing.
 * Network is only needed once; afterward the app runs offline.
 * Run via npm postinstall / scripts/vendor-assets.mjs.
 */
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const destDir = join(root, 'public', 'models');
const destPath = join(destDir, 'face_landmarker.task');

if (existsSync(destPath)) {
  console.log('[fetch-face-landmarker] already present; skip');
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

console.log('[fetch-face-landmarker] downloading face_landmarker.task …');

try {
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const tmpPath = `${destPath}.tmp`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmpPath));

  // Atomic-ish rename via copy+unlink if rename fails across volumes
  const { renameSync } = await import('node:fs');
  try {
    renameSync(tmpPath, destPath);
  } catch {
    const { copyFileSync } = await import('node:fs');
    copyFileSync(tmpPath, destPath);
    unlinkSync(tmpPath);
  }

  console.log('[fetch-face-landmarker] saved public/models/face_landmarker.task');
} catch (err) {
  console.warn(
    `[fetch-face-landmarker] failed: ${err instanceof Error ? err.message : err}`
  );
  console.warn(
    '[fetch-face-landmarker] Place face_landmarker.task manually in public/models/ for offline use.'
  );
  process.exitCode = 0; // do not fail npm install
}
