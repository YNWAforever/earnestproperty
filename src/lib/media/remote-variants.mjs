import { createHash } from "node:crypto";
import sharp from "sharp";

export const REMOTE_VARIANT_WIDTHS = Object.freeze([160, 320, 640, 960, 1280]);
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "avif"]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function sourceHost(sourceUrl, allowedHosts) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new TypeError("Invalid HTTPS source URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new TypeError("Invalid HTTPS source URL");
  if (!Array.isArray(allowedHosts) || !allowedHosts.includes(url.hostname.toLowerCase()))
    throw new TypeError("Untrusted source host");
  return url;
}
function bytesFrom(value) {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_SOURCE_BYTES)
    throw new TypeError("Invalid image byte size");
  return bytes;
}
function validateInput(input, ports) {
  if (!input || !UUID.test(input.assetId)) throw new TypeError("Invalid media asset ID");
  if (!SHA256.test(input.sourceHash)) throw new TypeError("Invalid source hash");
  sourceHost(input.sourceUrl, ports.allowedHosts);
  for (const key of ["find", "readSource", "put", "save"])
    if (typeof ports[key] !== "function") throw new TypeError("Missing media variant port: " + key);
}
export async function ensureMediaVariants(input, ports) {
  validateInput(input, ports);
  const previous = await ports.find(input.assetId, input.sourceHash);
  if (
    previous?.status === "ready" &&
    previous.sourceHash === input.sourceHash &&
    Array.isArray(previous.variants) &&
    previous.variants.length > 0
  )
    return previous;
  const bytes = bytesFrom(await ports.readSource(input));
  if (hash(bytes) !== input.sourceHash) throw new TypeError("Image source hash mismatch");
  let metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw new TypeError("Invalid or oversized image");
  }
  const orientation = Number(metadata.orientation);
  const sourceWidth = orientation >= 5 && orientation <= 8 ? metadata.height : metadata.width;
  const sourceHeight = orientation >= 5 && orientation <= 8 ? metadata.width : metadata.height;
  if (
    !IMAGE_FORMATS.has(metadata.format) ||
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    sourceWidth * sourceHeight > MAX_PIXELS
  )
    throw new TypeError("Invalid or oversized image");
  const widths = REMOTE_VARIANT_WIDTHS.filter((width) => width <= sourceWidth);
  if (!widths.length)
    return {
      assetId: input.assetId,
      sourceHash: input.sourceHash,
      sourceUrl: input.sourceUrl,
      variants: [],
      status: "unavailable",
    };
  const variants = [];
  try {
    for (const width of widths) {
      const body = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78, effort: 4 })
        .toBuffer();
      const pathname =
        "mls-variants/" +
        input.sourceHash.slice(0, 2) +
        "/" +
        input.sourceHash +
        "-" +
        width +
        ".webp";
      const uploaded = await ports.put({ pathname, body, contentType: "image/webp" });
      const url = new URL(uploaded?.url);
      if (
        uploaded?.pathname !== pathname ||
        uploaded?.contentType !== "image/webp" ||
        uploaded?.size !== body.byteLength ||
        url.protocol !== "https:" ||
        !ports.allowedHosts.includes(url.hostname.toLowerCase())
      )
        throw new Error("Invalid variant upload");
      variants.push({ width, url: url.href, bytes: body.byteLength, format: "webp" });
    }
    const set = {
      assetId: input.assetId,
      sourceHash: input.sourceHash,
      sourceUrl: input.sourceUrl,
      variants,
      status: "ready",
    };
    await ports.save(set);
    return set;
  } catch {
    return {
      assetId: input.assetId,
      sourceHash: input.sourceHash,
      sourceUrl: input.sourceUrl,
      variants: [],
      status: "failed",
    };
  }
}
