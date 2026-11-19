import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

const EDGE = 320;
const PIXELS = EDGE * EDGE;
const MODEL = "/media-editor/u2netp.onnx";
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

env.wasm.numThreads = 1;
env.wasm.wasmPaths = { wasm };

self.onmessage = async ({ data }: MessageEvent<Uint8ClampedArray>) => {
  try {
    const session = await InferenceSession.create(MODEL, { executionProviders: ["wasm"] });
    // Match U²-Net's RGB normalization and channel-first input.
    const input = new Float32Array(PIXELS * 3);
    let max = 1;
    for (let i = 0; i < data.length; i += 4) {
      max = Math.max(max, data[i], data[i + 1], data[i + 2]);
    }
    for (let channel = 0; channel < 3; channel++) {
      for (let i = 0; i < PIXELS; i++) {
        input[channel * PIXELS + i] = (data[i * 4 + channel] / max - MEAN[channel]) / STD[channel];
      }
    }
    const result = await session.run({
      [session.inputNames[0]]: new Tensor("float32", input, [1, 3, EDGE, EDGE]),
    });
    const mask = result[session.outputNames[0]].data;
    if (!(mask instanceof Float32Array) || mask.length !== PIXELS) throw new Error("Invalid mask");
    let low = 1;
    let high = 0;
    for (const value of mask) {
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    if (!Number.isFinite(high - low) || high - low < 0.01) throw new Error("Empty mask");
    const alpha = Uint8ClampedArray.from(mask, (value) => (255 * (value - low)) / (high - low));
    self.postMessage(alpha, { transfer: [alpha.buffer] });
  } catch {
    self.postMessage(null);
  }
};
