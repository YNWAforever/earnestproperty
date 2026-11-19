export const ADMIN_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
export const MAX_SELECTED_IMAGE_BYTES = 5 * 1024 * 1024;
// Reserve space for multipart headers and upload metadata under Vercel's request cap.
const MAX_REQUEST_IMAGE_BYTES = 4_400_000;
const MAX_EDIT_EDGE = 2560;

export type ImageCrop = { x: number; y: number; width: number; height: number };

export function validateSelectedImage(file: File) {
  if (!ADMIN_IMAGE_TYPES.includes(file.type))
    throw new Error("請選擇 JPG、PNG、WebP 或 AVIF 圖片。");
  if (!file.size) throw new Error("檔案是空白的，請選擇另一張圖片。");
  if (file.size > MAX_SELECTED_IMAGE_BYTES) throw new Error("檔案超過 5 MB，請縮小後再選擇。");
}

export async function decodeImage(file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new Error("無法讀取這張圖片，請重新匯出或選擇另一張圖片。");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cropPixels(width: number, height: number, crop?: ImageCrop) {
  if (!crop) return { x: 0, y: 0, width, height };
  const x = Math.min(width - 1, Math.max(0, Math.round((crop.x / 100) * width)));
  const y = Math.min(height - 1, Math.max(0, Math.round((crop.y / 100) * height)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(((crop.x + crop.width) / 100) * width) - x)),
    height: Math.max(
      1,
      Math.min(height - y, Math.round(((crop.y + crop.height) / 100) * height) - y),
    ),
  };
}

export function renderImage(image: HTMLImageElement, crop?: ImageCrop) {
  const rect = cropPixels(image.naturalWidth, image.naturalHeight, crop);
  const scale = Math.min(1, MAX_EDIT_EDGE / Math.max(rect.width, rect.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("此瀏覽器無法編輯圖片。");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("無法輸出圖片，請重試。"));
      },
      type,
      quality,
    );
  });
}

export async function exportImage(canvas: HTMLCanvasElement, original: File, cutout = false) {
  const type = original.type === "image/jpeg" && !cutout ? "image/jpeg" : "image/webp";
  let output = canvas;
  for (const scale of [1, 0.8, 0.64, 0.5]) {
    if (scale < 1) {
      output = document.createElement("canvas");
      output.width = Math.max(1, Math.round(canvas.width * scale));
      output.height = Math.max(1, Math.round(canvas.height * scale));
      const context = output.getContext("2d");
      if (!context) throw new Error("此瀏覽器無法編輯圖片。");
      context.imageSmoothingQuality = "high";
      context.drawImage(canvas, 0, 0, output.width, output.height);
    }
    const blob = await encode(output, type, 0.9);
    if (blob.size <= MAX_REQUEST_IMAGE_BYTES && ADMIN_IMAGE_TYPES.includes(blob.type)) {
      const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1];
      const name = original.name.replace(/\.[^.]+$/, "") || "image";
      return new File([blob], `${name}${cutout ? "-cutout" : ""}.${ext}`, { type: blob.type });
    }
  }
  throw new Error("圖片仍然太大，請縮小圖片後重試。");
}

export async function prepareImage(file: File) {
  validateSelectedImage(file);
  const image = await decodeImage(file);
  if (file.size <= MAX_REQUEST_IMAGE_BYTES) return file;
  return exportImage(renderImage(image), file);
}

export function removeImageBackground(canvas: HTMLCanvasElement, signal: AbortSignal) {
  signal.throwIfAborted();
  const edge = 320;
  const sample = document.createElement("canvas");
  sample.width = sample.height = edge;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("此瀏覽器無法移除背景。");
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, edge, edge);
  const pixels = context.getImageData(0, 0, edge, edge);

  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const worker = new Worker(new URL("./image-cutout.worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      cleanup();
      reject(new Error("無法載入背景移除工具，請重試。"));
    };
    worker.onmessage = ({ data }: MessageEvent<Uint8ClampedArray | null>) => {
      cleanup();
      const output = canvas.getContext("2d");
      if (!data || !output) {
        reject(new Error("未能移除背景，請重試或保留原圖。"));
        return;
      }
      try {
        for (let index = 0; index < data.length; index++) {
          const offset = index * 4;
          pixels.data[offset] = 0;
          pixels.data[offset + 1] = 0;
          pixels.data[offset + 2] = 0;
          pixels.data[offset + 3] = data[index];
        }
        context.putImageData(pixels, 0, 0);
        output.globalCompositeOperation = "destination-in";
        output.drawImage(sample, 0, 0, canvas.width, canvas.height);
        output.globalCompositeOperation = "source-over";
        resolve(canvas);
      } catch (error) {
        reject(error);
      }
    };
    worker.postMessage(pixels.data);
  });
}
