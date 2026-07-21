/**
 * Secondary ONNX opaque-eyewear signal.
 *
 * Heuristic (landmarkBackend) stays primary and authoritative for `state`.
 * This module never overrides state — it only loads glasses-detector's
 * sunglasses classifier and adjusts confidence when signals agree.
 *
 * Model: self-hosted at /models/glasses_opaque.onnx (exported offline).
 * Runtime WASM: self-hosted at /ort/ (copied from onnxruntime-web on postinstall).
 *
 * IMPORTANT: score a full-face crop, not per-eye patches. The classifier was
 * trained on faces; tight eye crops always score "opaque" (bare iris ≈ sunglasses).
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web';
import type {
  EyeVisibilityBackend,
  EyeVisibilityEvaluateInput,
  EyeVisibilitySample,
} from './types';
import { faceCropRegionFromLandmarks } from './cropHelpers';

const INPUT_W = 256;
const INPUT_H = 256;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** Matches package.json onnxruntime-web; files live under public/ort/. */
const DEFAULT_WASM_PATHS = '/ort/';
const DEFAULT_MODEL_URL = '/models/glasses_opaque.onnx';
const DEFAULT_THRESHOLD = 0.5;
/** Confidence boost when heuristic + ONNX both indicate opaque cover. */
const OPAQUE_AGREE_BOOST = 0.18;
/** Mild boost when both indicate clear/visible eyes. */
const VISIBLE_AGREE_BOOST = 0.05;

export interface OnnxOpaqueOptions {
  modelUrl?: string;
  /** P(opaque) threshold after sigmoid. Tune empirically (clear glasses must stay VISIBLE). */
  threshold?: number;
  wasmPaths?: string;
}

export interface OnnxOpaqueScore {
  score: number;
  opaque: boolean;
}

/** WASM-only entry — avoids the default build that fetches *.jsep.mjs (WebGPU). */
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
    // Single-threaded: no cross-origin isolation / SharedArrayBuffer needed.
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

/**
 * Full-face crop → 256×256 RGB → ImageNet normalize NCHW.
 */
function buildFaceOpaqueTensor(
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

  // Letterbox into square so we don't stretch the face (aspect matters for this net).
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

class OnnxOpaqueSession {
  private session: InferenceSession | null = null;
  private loadPromise: Promise<InferenceSession | null> | null = null;
  private failed = false;
  /** Same face score for L+R evaluates in one sample tick. */
  private frameCache: { key: string; result: OnnxOpaqueScore } | null = null;

  constructor(
    private readonly modelUrl: string,
    private readonly wasmPaths: string
  ) {}

  private async load(): Promise<InferenceSession | null> {
    if (this.session) return this.session;
    if (this.failed) return null;
    if (typeof window === 'undefined') return null;

    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const ort = await getOrt(this.wasmPaths);
          if (!ort) return null;
          const session = await ort.InferenceSession.create(this.modelUrl, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
          });
          this.session = session;
          return session;
        } catch (err) {
          console.warn('[onnxOpaque] failed to load model', err);
          this.failed = true;
          return null;
        }
      })();
    }
    return this.loadPromise;
  }

  async score(
    input: EyeVisibilityEvaluateInput,
    threshold: number
  ): Promise<OnnxOpaqueScore | null> {
    if (!input.video || input.video.readyState < 2) return null;

    // Cache by video clock + landmark tip so L/R share one face inference.
    const tip = input.landmarks[1];
    const cacheKey = `${input.video.currentTime.toFixed(3)}:${tip?.x.toFixed(4)}:${tip?.y.toFixed(4)}`;
    if (this.frameCache?.key === cacheKey) {
      return {
        score: this.frameCache.result.score,
        opaque: this.frameCache.result.score >= threshold,
      };
    }

    const session = await this.load();
    if (!session) return null;

    try {
      const ort = await getOrt(this.wasmPaths);
      if (!ort) return null;

      const tensor = buildFaceOpaqueTensor(ort, input.video, input.landmarks);
      if (!tensor) return null;

      const feeds: Record<string, Tensor> = {};
      const inputName = session.inputNames[0] ?? 'input';
      feeds[inputName] = tensor;

      const out = await session.run(feeds);
      const outName = session.outputNames[0] ?? 'logit';
      const logitData = out[outName]?.data;
      if (!logitData || logitData.length === 0) return null;

      const logit = Number(logitData[0]);
      if (!Number.isFinite(logit)) return null;
      const score = sigmoid(logit);
      const result = { score, opaque: score >= threshold };
      this.frameCache = { key: cacheKey, result };
      return result;
    } catch (err) {
      console.warn('[onnxOpaque] inference failed', err);
      return null;
    }
  }
}

/**
 * Standalone ONNX backend (for A/B / debug). Prefer createCombinedOpaqueBackend in product.
 */
export function createOnnxOpaqueBackend(options: OnnxOpaqueOptions = {}): EyeVisibilityBackend {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const session = new OnnxOpaqueSession(
    options.modelUrl ?? DEFAULT_MODEL_URL,
    options.wasmPaths ?? DEFAULT_WASM_PATHS
  );

  return {
    async evaluate(input: EyeVisibilityEvaluateInput): Promise<EyeVisibilitySample> {
      const result = await session.score(input, threshold);
      if (!result) {
        return {
          state: 'UNKNOWN',
          confidence: 0,
          debug: {
            irisInContour: false,
            eyeWidthOk: false,
            poseOk: false,
            earOk: false,
            geometryScore: 0,
            usedSecondaryOcclusion: false,
            onnxScore: null,
            onnxOpaque: null,
            agree: null,
            onnxReady: false,
          },
        };
      }

      return {
        state: result.opaque ? 'NOT_VISIBLE' : 'VISIBLE',
        confidence: result.opaque ? result.score : 1 - result.score,
        debug: {
          irisInContour: false,
          eyeWidthOk: false,
          poseOk: false,
          earOk: false,
          geometryScore: 0,
          usedSecondaryOcclusion: false,
          onnxScore: result.score,
          onnxOpaque: result.opaque,
          agree: null,
          onnxReady: true,
        },
      };
    },
  };
}

/**
 * Wrap the landmark/heuristic backend: state always comes from `heuristic`;
 * ONNX only adjusts confidence and fills debug.{onnxScore,onnxOpaque,agree}.
 */
export function createCombinedOpaqueBackend(
  heuristic: EyeVisibilityBackend,
  options: OnnxOpaqueOptions = {}
): EyeVisibilityBackend {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const session = new OnnxOpaqueSession(
    options.modelUrl ?? DEFAULT_MODEL_URL,
    options.wasmPaths ?? DEFAULT_WASM_PATHS
  );

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
            agree: null,
            onnxReady: false,
          },
        };
      }

      // Opaque intent from heuristic: NOT_VISIBLE, or secondary crop confirmed occlusion.
      const heuristicOpaque =
        primary.state === 'NOT_VISIBLE' || primary.debug.usedSecondaryOcclusion === true;
      const agree = heuristicOpaque === onnx.opaque;

      let confidence = primary.confidence;
      if (agree && heuristicOpaque) {
        confidence = Math.min(1, primary.confidence + OPAQUE_AGREE_BOOST);
      } else if (agree && primary.state === 'VISIBLE') {
        confidence = Math.min(1, primary.confidence + VISIBLE_AGREE_BOOST);
      }
      // Disagree: leave confidence alone — never flip state from ONNX.

      return {
        state: primary.state,
        confidence,
        debug: {
          ...primary.debug,
          onnxScore: onnx.score,
          onnxOpaque: onnx.opaque,
          agree,
          onnxReady: true,
        },
      };
    },
  };
}
