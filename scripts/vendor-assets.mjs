/**
 * Vendor all browser ML runtime assets into public/ for offline use.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

const steps = [
  'copy-ort-wasm.mjs',
  'copy-mediapipe-wasm.mjs',
  'fetch-face-landmarker.mjs',
];

for (const name of steps) {
  const script = join(scriptsDir, name);
  const result = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0 && result.status != null) {
    process.exit(result.status);
  }
}
