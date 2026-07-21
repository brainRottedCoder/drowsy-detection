/**
 * Copy onnxruntime-web WASM binaries into public/ort so the browser can
 * load them same-origin (no third-party CDN for the runtime).
 * Run via npm postinstall.
 *
 * We use the plain SIMD threaded build (onnxruntime-web/wasm).
 * JSEP variants are for WebGPU and are intentionally not copied.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const destDir = join(root, 'public', 'ort');

const NEEDED = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
];

if (!existsSync(srcDir)) {
  console.warn('[copy-ort-wasm] onnxruntime-web not installed; skip');
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

for (const name of NEEDED) {
  const from = join(srcDir, name);
  if (!existsSync(from)) {
    console.warn(`[copy-ort-wasm] missing ${name}`);
    continue;
  }
  copyFileSync(from, join(destDir, name));
  console.log(`[copy-ort-wasm] ${name}`);
}
