/**
 * Copy MediaPipe Tasks Vision WASM binaries into public/mediapipe/wasm
 * so the browser loads them same-origin (no jsDelivr CDN).
 * Run via npm postinstall / scripts/vendor-assets.mjs.
 */
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const destDir = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(srcDir)) {
  console.warn('[copy-mediapipe-wasm] @mediapipe/tasks-vision not installed; skip');
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

const files = readdirSync(srcDir);
let copied = 0;
for (const name of files) {
  const from = join(srcDir, name);
  copyFileSync(from, join(destDir, name));
  console.log(`[copy-mediapipe-wasm] ${name}`);
  copied += 1;
}

if (copied === 0) {
  console.warn('[copy-mediapipe-wasm] no files found in wasm package dir');
}
