/**
 * Dual glasses-detector classifiers → 3-way eyewear partition.
 *
 *   sunglasses+              → opaque      → NOT_VISIBLE (occlusion)
 *   eyeglasses+ & sunglasses− → transparent → VISIBLE (clear power glasses)
 *   both−                    → bare         → VISIBLE
 *   both+ (rare)             → opaque       → NOT_VISIBLE
 *
 * Full-face crop only (models were trained on faces, not eye patches).
 * Models: /models/glasses_eyeglasses.onnx + /models/glasses_sunglasses.onnx
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web';
import type {
  EyeVisibilityBackend,
  EyeVisibilityEvaluateInput,
  EyeVisibilitySample,
  EyewearPartition,
} from './types';
import { faceCropRegionFromLandmarks } from './cropHelpers';

const INPUT_W = 256;
const INPUT_H = 256;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

const DEFAULT_WASM_PATHS = '/ort/';
const DEFAULT_EYEGLASSES_URL = '/models/glasses_eyeglasses.onnx';
const DEFAULT_SUNGLASSES_URL = '/models/glasses_sunglasses.onnx';
const DEFAULT_THRESHOLD = 0.5;

const OPAQUE_AGREE_BOOST = 0.18;
const VISIBLE_AGREE_BOOST = 0.05;

export interface OnnxOpaqueOptions {
  /** @deprecated Use sunglassesModelUrl. Kept as alias for sunglasses ONNX. */
  modelUrl?: string;
  eyeglassesModelUrl?: string;
  sunglassesModelUrl?: string;
  threshold?: number;
  wasmPaths?: string;
}

export interface DualGlassesScore {
  eyeglassesProb: number;
  sunglassesProb: number;
  partition: EyewearPartition;
  /** True when partition === 'opaque' (sunglasses fires, or both rare). */
  opaque: boolean;
}

type OrtModule = typeof import('onnxruntime-web/wasm');

let ortModule: OrtModule | null = null;
let wasmConfigured = false;

async function getOrt(wasmPaths: string): Promise<OrtModule | null> {
  if (typeof window === 'undefined') return null;
  if (!ortModule) {
    ortModule = await import('onnxruntime-web/wasm');
  }
  if (!wasmConfigured) {
    ortModule.env.wasm.wasmPaths = wasmPaths;
    ortModule.env.wasm.numThreads = 1;
    ortModule.env.wasm.proxy = false;
    wasmConfigured = true;
  }
  return ortModule;
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

export function combineEyewearPartition(
  eyeglassesProb: number,
  sunglassesProb: number,
  threshold: number
): EyewearPartition {
  const sun = sunglassesProb >= threshold;
  const eye = eyeglassesProb >= threshold;
  if (sun) return 'opaque';
  if (eye) return 'transparent';
  return 'bare';
}

function buildFaceTensor(
  ort: OrtModule,
  video: HTMLVideoElement,
  landmarks: EyeVisibilityEvaluateInput['landmarks']
): Tensor | null {
  const region = faceCropRegionFromLandmarks(landmarks);
  if (!region) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const sx = Math.max(0, Math.min((region.x - region.w / 2) * vw, vw - 4));
  const sy = Math.max(0, Math.min((region.y - region.h / 2) * vh, vh - 4));
  const sw = Math.max(4, Math.min(region.w * vw, vw - sx));
  const sh = Math.max(4, Math.min(region.h * vh, vh - sy));

  const canvas = document.createElement('canvas');
  canvas.width = INPUT_W;
  canvas.height = INPUT_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, INPUT_W, INPUT_H);

  const scale = Math.min(INPUT_W / sw, INPUT_H / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const dx = Math.floor((INPUT_W - dw) / 2);
  const dy = Math.floor((INPUT_H - dh) / 2);
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);

  const { data } = ctx.getImageData(0, 0, INPUT_W, INPUT_H);
  const floats = new Float32Array(1 * 3 * INPUT_H * INPUT_W);
  const plane = INPUT_H * INPUT_W;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    floats[i] = (r - MEAN[0]) / STD[0];
    floats[plane + i] = (g - MEAN[1]) / STD[1];
    floats[2 * plane + i] = (b - MEAN[2]) / STD[2];
  }

  return new ort.Tensor('float32', floats, [1, 3, INPUT_H, INPUT_W]);
}

async function runLogitSession(
  session: InferenceSession,
  tensor: Tensor
): Promise<number | null> {
  const feeds: Record<string, Tensor> = {};
  feeds[session.inputNames[0] ?? 'input'] = tensor;
  const out = await session.run(feeds);
  const data = out[session.outputNames[0] ?? 'logit']?.data;
  if (!data || data.length === 0) return null;
  const logit = Number(data[0]);
  return Number.isFinite(logit) ? sigmoid(logit) : null;
}

class DualGlassesSession {
  private eyeglasses: InferenceSession | null = null;
  private sunglasses: InferenceSession | null = null;
  private loadPromise: Promise<boolean> | null = null;
  private failed = false;
  private frameCache: { key: string; result: DualGlassesScore } | null = null;

  constructor(
    private readonly eyeglassesUrl: string,
    private readonly sunglassesUrl: string,
    private readonly wasmPaths: string
  ) {}

  private async load(): Promise<boolean> {
    if (this.eyeglasses && this.sunglasses) return true;
    if (this.failed) return false;
    if (typeof window === 'undefined') return false;

    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const ort = await getOrt(this.wasmPaths);
          if (!ort) return false;
          const opts = {
            executionProviders: ['wasm'] as const,
            graphOptimizationLevel: 'all' as const,
          };
          const [eye, sun] = await Promise.all([
            ort.InferenceSession.create(this.eyeglassesUrl, opts),
            ort.InferenceSession.create(this.sunglassesUrl, opts),
          ]);
          this.eyeglasses = eye;
          this.sunglasses = sun;
          return true;
        } catch (err) {
          console.warn('[onnxOpaque] failed to load dual models', err);
          this.failed = true;
          return false;
        }
      })();
    }
    return this.loadPromise;
  }

  async score(
    input: EyeVisibilityEvaluateInput,
    threshold: number
  ): Promise<DualGlassesScore | null> {
    if (!input.video || input.video.readyState < 2) return null;

    const tip = input.landmarks[1];
    const cacheKey = `${input.video.currentTime.toFixed(3)}:${tip?.x.toFixed(4)}:${tip?.y.toFixed(4)}:${threshold}`;
    if (this.frameCache?.key === cacheKey) {
      return this.frameCache.result;
    }

    if (!(await this.load()) || !this.eyeglasses || !this.sunglasses) return null;

    try {
      const ort = await getOrt(this.wasmPaths);
      if (!ort) return null;

      const tensor = buildFaceTensor(ort, input.video, input.landmarks);
      if (!tensor) return null;

      // Same crop tensor; run sequentially — ORT may not like concurrent use of one Tensor.
      const eyeglassesProb = await runLogitSession(this.eyeglasses, tensor);
      const sunglassesProb = await runLogitSession(this.sunglasses, tensor);
      if (eyeglassesProb == null || sunglassesProb == null) return null;

      const partition = combineEyewearPartition(eyeglassesProb, sunglassesProb, threshold);
      const result: DualGlassesScore = {
        eyeglassesProb,
        sunglassesProb,
        partition,
        opaque: partition === 'opaque',
      };
      this.frameCache = { key: cacheKey, result };
      return result;
    } catch (err) {
      console.warn('[onnxOpaque] dual inference failed', err);
      return null;
    }
  }
}

function emptyOnnxDebug(): EyeVisibilitySample['debug'] {
  return {
    irisInContour: false,
    eyeWidthOk: false,
    poseOk: false,
    earOk: false,
    geometryScore: 0,
    usedSecondaryOcclusion: false,
    onnxScore: null,
    onnxOpaque: null,
    eyeglassesProb: null,
    sunglassesProb: null,
    eyewearPartition: null,
    agree: null,
    onnxReady: false,
  };
}

function applyOnnxDebug(
  base: EyeVisibilitySample['debug'],
  score: DualGlassesScore
): EyeVisibilitySample['debug'] {
  return {
    ...base,
    onnxScore: score.sunglassesProb,
    onnxOpaque: score.opaque,
    eyeglassesProb: score.eyeglassesProb,
    sunglassesProb: score.sunglassesProb,
    eyewearPartition: score.partition,
    onnxReady: true,
  };
}

function resolveUrls(options: OnnxOpaqueOptions) {
  return {
    eyeglasses: options.eyeglassesModelUrl ?? DEFAULT_EYEGLASSES_URL,
    sunglasses:
      options.sunglassesModelUrl ?? options.modelUrl ?? DEFAULT_SUNGLASSES_URL,
    wasm: options.wasmPaths ?? DEFAULT_WASM_PATHS,
    threshold: options.threshold ?? DEFAULT_THRESHOLD,
  };
}

/**
 * Standalone dual ONNX backend.
 * opaque → NOT_VISIBLE; transparent / bare → VISIBLE.
 */
export function createOnnxOpaqueBackend(options: OnnxOpaqueOptions = {}): EyeVisibilityBackend {
  const { eyeglasses, sunglasses, wasm, threshold } = resolveUrls(options);
  const session = new DualGlassesSession(eyeglasses, sunglasses, wasm);

  return {
    async evaluate(input: EyeVisibilityEvaluateInput): Promise<EyeVisibilitySample> {
      const result = await session.score(input, threshold);
      if (!result) {
        return { state: 'UNKNOWN', confidence: 0, debug: emptyOnnxDebug() };
      }

      const state = result.opaque ? 'NOT_VISIBLE' : 'VISIBLE';
      const confidence = result.opaque
        ? result.sunglassesProb
        : result.partition === 'transparent'
          ? result.eyeglassesProb
          : Math.max(1 - result.eyeglassesProb, 1 - result.sunglassesProb);

      return {
        state,
        confidence: Math.min(1, confidence),
        debug: applyOnnxDebug(emptyOnnxDebug(), result),
      };
    },
  };
}

/**
 * Heuristic stays primary for `state`. Dual ONNX fills partition debug and
 * boosts confidence when they agree on opaque vs visible.
 */
export function createCombinedOpaqueBackend(
  heuristic: EyeVisibilityBackend,
  options: OnnxOpaqueOptions = {}
): EyeVisibilityBackend {
  const { eyeglasses, sunglasses, wasm, threshold } = resolveUrls(options);
  const session = new DualGlassesSession(eyeglasses, sunglasses, wasm);

  return {
    async evaluate(input: EyeVisibilityEvaluateInput): Promise<EyeVisibilitySample> {
      const primary = await Promise.resolve(heuristic.evaluate(input));
      const onnx = await session.score(input, threshold);

      if (!onnx) {
        return {
          ...primary,
          debug: {
            ...primary.debug,
            onnxScore: null,
            onnxOpaque: null,
            eyeglassesProb: null,
            sunglassesProb: null,
            eyewearPartition: null,
            agree: null,
            onnxReady: false,
          },
        };
      }

      const heuristicOpaque =
        primary.state === 'NOT_VISIBLE' || primary.debug.usedSecondaryOcclusion === true;
      const agree = heuristicOpaque === onnx.opaque;

      let confidence = primary.confidence;
      if (agree && heuristicOpaque) {
        confidence = Math.min(1, primary.confidence + OPAQUE_AGREE_BOOST);
      } else if (agree && primary.state === 'VISIBLE') {
        confidence = Math.min(1, primary.confidence + VISIBLE_AGREE_BOOST);
      }

      return {
        state: primary.state,
        confidence,
        debug: {
          ...applyOnnxDebug(primary.debug, onnx),
          agree,
        },
      };
    },
  };
}
