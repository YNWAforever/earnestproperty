import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 12_000;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MEDIA_FETCH_TIMEOUT_MS = 30_000;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const SOURCE_VALUES = new Set(["old_site", "28hse_agent_540"]);
const DEAL_TYPES = new Set(["sale", "rent"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FIRST_PARTY_ORIGIN = "https://www.earnestproperty.com";

class MediaPreparationError extends Error {
  constructor(code) {
    super(code);
    this.name = "MediaPreparationError";
    this.code = code;
  }
}

function fail(code) {
  throw new MediaPreparationError(code);
}

function bytesView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function ascii(bytes, start, length) {
  if (start < 0 || length < 0 || start + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function detectImageMime(value) {
  const bytes = bytesView(value);
  if (!bytes) return null;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === "ftyp") {
    const boxLength = readU32be(bytes, 0);
    const end = Math.min(bytes.length, boxLength >= 16 ? boxLength : bytes.length);
    for (let offset = 8; offset + 4 <= end; offset += 4) {
      const brand = ascii(bytes, offset, 4);
      if (brand === "avif" || brand === "avis") return "image/avif";
    }
  }
  return null;
}

export function sha256(value) {
  const bytes = bytesView(value);
  if (!bytes) throw new TypeError("sha256 input must be binary data");
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildOwnedMediaPathname(hash, mime) {
  if (typeof hash !== "string" || !SHA256_PATTERN.test(hash)) {
    throw new TypeError("content hash must be a lowercase SHA-256 digest");
  }
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
  }[mime];
  if (!extension) throw new TypeError("Unsupported image MIME type");
  return `mls/${hash.slice(0, 2)}/${hash}.${extension}`;
}

function readU16be(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function readU16le(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function readU24le(bytes, offset) {
  if (offset < 0 || offset + 3 > bytes.length) return null;
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
}

function readU32be(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function jpegDimensions(bytes) {
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = readU16be(bytes, offset);
    if (segmentLength == null || segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }
    if (startOfFrame.has(marker) && segmentLength >= 7) {
      const height = readU16be(bytes, offset + 3);
      const width = readU16be(bytes, offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = readU32be(bytes, 16);
  const height = readU32be(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function webpDimensions(bytes) {
  if (bytes.length < 20) return null;
  const kind = ascii(bytes, 12, 4);
  if (kind === "VP8X" && bytes.length >= 30) {
    const widthMinusOne = readU24le(bytes, 24);
    const heightMinusOne = readU24le(bytes, 27);
    return { width: widthMinusOne + 1, height: heightMinusOne + 1 };
  }
  if (
    kind === "VP8 " &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: readU16le(bytes, 26) & 0x3fff,
      height: readU16le(bytes, 28) & 0x3fff,
    };
  }
  if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
    const height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
    return { width, height };
  }
  return null;
}

function avifDimensions(bytes) {
  for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
    if (ascii(bytes, offset, 4) !== "ispe") continue;
    const width = readU32be(bytes, offset + 8);
    const height = readU32be(bytes, offset + 12);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

function imageDimensions(bytes, mime) {
  const dimensions =
    mime === "image/jpeg"
      ? jpegDimensions(bytes)
      : mime === "image/png"
        ? pngDimensions(bytes)
        : mime === "image/webp"
          ? webpDimensions(bytes)
          : avifDimensions(bytes);
  if (!dimensions) return { width: null, height: null };
  const { width, height } = dimensions;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    fail("invalid_image_dimensions");
  }
  return { width, height };
}

function parseIpv4(value) {
  const parts = String(value).split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^(0|[1-9]\d{0,2})$/.test(part) ? Number(part) : NaN));
  return numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? numbers
    : null;
}

function publicIpv4(value) {
  const parts = parseIpv4(value);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6BigInt(value) {
  let input = String(value).toLowerCase();
  if (input.includes("%")) return null;
  if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);
  const lastColon = input.lastIndexOf(":");
  if (input.includes(".") && lastColon >= 0) {
    const ipv4 = parseIpv4(input.slice(lastColon + 1));
    if (!ipv4) return null;
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    input = `${input.slice(0, lastColon)}:${high}:${low}`;
  }
  if ((input.match(/::/g) ?? []).length > 1) return null;
  const [leftText, rightText] = input.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const hasCompression = input.includes("::");
  const omitted = 8 - left.length - right.length;
  if ((!hasCompression && omitted !== 0) || (hasCompression && omitted < 1)) return null;
  const groups = [...left, ...Array(hasCompression ? omitted : 0).fill("0"), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function hasIpv6Prefix(address, prefix, bits) {
  const shift = BigInt(128 - bits);
  return address >> shift === prefix >> shift;
}

function publicIpv6(value) {
  const address = ipv6BigInt(value);
  if (address == null) return false;
  const blocked = [
    [0n, 8],
    [ipv6BigInt("100::"), 64],
    [ipv6BigInt("2001::"), 23],
    [ipv6BigInt("2001:db8::"), 32],
    [ipv6BigInt("2002::"), 16],
    [ipv6BigInt("3ffe::"), 16],
    [ipv6BigInt("fc00::"), 7],
    [ipv6BigInt("fe80::"), 10],
    [ipv6BigInt("ff00::"), 8],
  ];
  return blocked.every(([prefix, bits]) => !hasIpv6Prefix(address, prefix, bits));
}

function publicAddress(value) {
  const text = typeof value === "string" ? value : value?.address;
  if (typeof text !== "string") return false;
  const normalized = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  const family = isIP(normalized);
  return family === 4 ? publicIpv4(normalized) : family === 6 ? publicIpv6(normalized) : false;
}

function allowedHosts(value) {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const result = new Set();
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0 || entry.trim() !== entry) {
      throw new TypeError("allowedMediaHosts contains an invalid hostname");
    }
    const hostname = entry.toLowerCase();
    if (hostname.includes("*") || isIP(hostname)) {
      throw new TypeError("allowedMediaHosts contains an invalid hostname");
    }
    let parsed;
    try {
      parsed = new URL(`https://${hostname}`);
    } catch {
      throw new TypeError("allowedMediaHosts contains an invalid hostname");
    }
    if (
      parsed.hostname !== hostname ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError("allowedMediaHosts contains an invalid hostname");
    }
    result.add(hostname);
  }
  return result;
}

function parseCandidateUrl(value, hosts) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    fail("unsafe_media_url");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("unsafe_media_url");
  }
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    isIP(hostname) ||
    !hosts.has(hostname.toLowerCase())
  ) {
    fail("unsafe_media_url");
  }
  return url;
}

async function assertPublicResolution(url, resolveHost) {
  let addresses;
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    fail("unsafe_media_url");
  }
  const values = Array.isArray(addresses) ? addresses : addresses == null ? [] : [addresses];
  if (values.length === 0 || values.some((address) => !publicAddress(address))) {
    fail("unsafe_media_url");
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function requestSignal(sharedSignal) {
  throwIfAborted(sharedSignal);
  const controller = new AbortController();
  const timeoutReason = new MediaPreparationError("media_fetch_timeout");
  const timer = setTimeout(() => controller.abort(timeoutReason), MEDIA_FETCH_TIMEOUT_MS);
  timer.unref?.();
  const onAbort = () => controller.abort(sharedSignal.reason);
  sharedSignal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      sharedSignal?.removeEventListener("abort", onAbort);
    },
    rethrow(error) {
      if (sharedSignal?.aborted) throw sharedSignal.reason ?? error;
      if (controller.signal.aborted && controller.signal.reason === timeoutReason)
        throw timeoutReason;
      throw error;
    },
  };
}

async function readLimitedBody(response, signal) {
  const advertised = response.headers?.get?.("content-length");
  if (typeof advertised === "string" && /^\d+$/.test(advertised)) {
    try {
      if (BigInt(advertised) > BigInt(MAX_IMAGE_BYTES)) fail("media_too_large");
    } catch (error) {
      if (error instanceof MediaPreparationError) throw error;
    }
  }
  if (!response.body?.getReader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) fail("media_too_large");
    return buffer;
  }
  const reader = response.body.getReader();
  const cancelForAbort = () => {
    void Promise.resolve(reader.cancel(signal?.reason)).catch(() => {});
  };
  signal?.addEventListener("abort", cancelForAbort, { once: true });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      const chunk = bytesView(value);
      if (!chunk) fail("invalid_image_payload");
      total += chunk.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        fail("media_too_large");
      }
      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchImage({ candidateUrl, hosts, resolveHost, fetchImpl, sharedSignal }) {
  let current = parseCandidateUrl(candidateUrl, hosts);
  const originalHostname = current.hostname;
  for (let redirects = 0; ; redirects += 1) {
    throwIfAborted(sharedSignal);
    await assertPublicResolution(current, resolveHost);
    const request = requestSignal(sharedSignal);
    let response;
    try {
      response = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: "image/avif,image/webp,image/png,image/jpeg" },
        signal: request.signal,
      });
      if (REDIRECT_STATUSES.has(response?.status)) {
        if (redirects >= 2) fail("too_many_redirects");
        const location = response.headers?.get?.("location");
        if (!location) fail("unsafe_media_url");
        let next;
        try {
          next = new URL(location, current);
        } catch {
          fail("unsafe_media_url");
        }
        next = parseCandidateUrl(next.toString(), hosts);
        if (next.hostname !== originalHostname) fail("unsafe_media_url");
        current = next;
        continue;
      }
      if (!response?.ok) fail("media_fetch_failed");
      const bytes = await readLimitedBody(response, request.signal);
      const mime = detectImageMime(bytes);
      if (!mime || !ALLOWED_MIME.has(mime)) fail("unsupported_media_type");
      const { width, height } = imageDimensions(bytes, mime);
      return { bytes, mime, width, height };
    } catch (error) {
      if (error instanceof MediaPreparationError) throw error;
      try {
        request.rethrow(error);
      } catch (abortOrError) {
        if (sharedSignal?.aborted) throw abortOrError;
        if (abortOrError instanceof MediaPreparationError) throw abortOrError;
      }
      fail("media_fetch_failed");
    } finally {
      request.cleanup();
    }
  }
}

function plainRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function candidateHasRejectionMarker(candidate) {
  return (
    candidate.rejected === true ||
    candidate.eligible === false ||
    candidate.contextRejected === true ||
    (typeof candidate.rejectionReason === "string" && candidate.rejectionReason.length > 0) ||
    (Array.isArray(candidate.rejectionReasons) && candidate.rejectionReasons.length > 0) ||
    (Array.isArray(candidate.contextRejectionMarkers) &&
      candidate.contextRejectionMarkers.length > 0)
  );
}

function validateUuid(value, name, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a canonical UUID`);
  }
  return value.toLowerCase();
}

function validateAsset(asset, { requirePath = false } = {}) {
  if (
    !plainRecord(asset) ||
    typeof asset.id !== "string" ||
    asset.id.length === 0 ||
    typeof asset.url !== "string"
  ) {
    throw new TypeError("Media repository returned an invalid owned asset");
  }
  let url;
  try {
    url = new URL(asset.url);
  } catch {
    throw new TypeError("Media repository returned an invalid owned asset");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError("Media repository returned an invalid owned asset");
  }
  if (requirePath && (typeof asset.pathname !== "string" || asset.pathname.length === 0)) {
    throw new TypeError("Media repository returned an invalid owned asset");
  }
  return asset;
}

function validateBlobResult(blob, expected) {
  if (!plainRecord(blob)) throw new TypeError("Blob store returned invalid owned metadata");
  let url;
  try {
    url = new URL(blob.url);
  } catch {
    throw new TypeError("Blob store returned invalid owned metadata");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    blob.pathname !== expected.pathname ||
    blob.contentType !== expected.contentType ||
    blob.size !== expected.size
  ) {
    throw new TypeError("Blob store returned invalid owned metadata");
  }
  return blob;
}

function currentUrlIsFirstParty(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.origin === FIRST_PARTY_ORIGIN;
  } catch {
    return false;
  }
}

function resultFor(candidate, identity, values = {}) {
  return {
    observationId: identity.observationId,
    propertyId: identity.propertyId,
    sourceUrl: typeof candidate?.url === "string" ? candidate.url : "",
    category: typeof candidate?.category === "string" ? candidate.category : "unknown",
    isPrimary: candidate?.isPrimary === true,
    contentHash: null,
    ownedMediaAssetId: null,
    ownedUrl: null,
    detectedMime: null,
    sizeBytes: null,
    width: null,
    height: null,
    eligibility: "rejected",
    rejectionReason: null,
    ...values,
  };
}

function mediaRecord(result) {
  return {
    observationId: result.observationId,
    propertyId: result.propertyId,
    sourceUrl: result.sourceUrl,
    contentHash: result.contentHash,
    ownedMediaAssetId: result.ownedMediaAssetId,
    detectedMime: result.detectedMime,
    sizeBytes: result.sizeBytes,
    width: result.width,
    height: result.height,
    eligibility: result.eligibility,
    rejectionReason: result.rejectionReason,
  };
}

function validateInput(input) {
  if (!plainRecord(input)) throw new TypeError("prepareListingMedia input is required");
  if (input.mode !== "validate" && input.mode !== "upload") {
    throw new TypeError("mode must be validate or upload");
  }
  if (typeof input.isNew !== "boolean") throw new TypeError("isNew must be a boolean");
  const observationId = validateUuid(input.observationId, "observationId");
  const propertyId = input.isNew
    ? null
    : validateUuid(input.propertyId, "propertyId", { nullable: false });
  const observation = input.observation;
  if (
    !plainRecord(observation) ||
    observation.schemaVersion !== 1 ||
    !SOURCE_VALUES.has(observation.source) ||
    typeof observation.externalId !== "string" ||
    observation.externalId.length === 0 ||
    !DEAL_TYPES.has(observation.dealType) ||
    typeof observation.matchKey !== "string" ||
    !observation.matchKey.startsWith(`${observation.dealType}:`) ||
    observation.matchKey.length <= observation.dealType.length + 1 ||
    !Array.isArray(observation.mediaCandidates)
  ) {
    throw new TypeError("observation identity is invalid");
  }
  for (const candidate of observation.mediaCandidates) {
    if (
      !plainRecord(candidate) ||
      typeof candidate.url !== "string" ||
      candidate.url.length === 0 ||
      typeof candidate.category !== "string" ||
      typeof candidate.isPrimary !== "boolean"
    ) {
      throw new TypeError("observation media candidate is invalid");
    }
  }
  if (
    !Array.isArray(input.currentImages) ||
    input.currentImages.some(
      (value) => typeof value !== "string" || value.length === 0 || value.trim() !== value,
    )
  ) {
    throw new TypeError("currentImages must be an array of non-empty strings");
  }
  if (typeof input.fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (typeof input.resolveHost !== "function") throw new TypeError("resolveHost is required");
  const repository = input.repository;
  for (const method of [
    "findMediaByHash",
    "findMediaByUrls",
    "registerOwnedMedia",
    "saveMediaRecord",
  ]) {
    if (typeof repository?.[method] !== "function") {
      throw new TypeError(`repository.${method} is required`);
    }
  }
  if (input.mode === "upload" && typeof input.blobStore?.put !== "function") {
    throw new TypeError("blobStore.put is required");
  }
  if (input.signal != null && !(input.signal instanceof AbortSignal)) {
    throw new TypeError("signal must be an AbortSignal");
  }
  return {
    ...input,
    observation,
    observationId,
    propertyId,
    hosts: allowedHosts(input.allowedMediaHosts ?? process.env.MLS_MEDIA_ALLOWED_HOSTS ?? ""),
  };
}

async function ownedCurrentImages(currentImages, repository) {
  if (currentImages.length === 0) return { owned: [], allOwned: true };
  const rows = await repository.findMediaByUrls([...currentImages]);
  if (!Array.isArray(rows)) throw new TypeError("repository.findMediaByUrls returned invalid data");
  const exact = new Set();
  for (const row of rows) {
    if (!plainRecord(row) || typeof row.url !== "string") {
      throw new TypeError("repository.findMediaByUrls returned invalid data");
    }
    if (currentImages.includes(row.url)) exact.add(row.url);
  }
  const owned = currentImages.filter((url) => exact.has(url) || currentUrlIsFirstParty(url));
  return { owned: [...new Set(owned)], allOwned: owned.length === currentImages.length };
}

function preparedMedia(identity, observation, images) {
  if (images.length === 0) return null;
  return Object.freeze({
    observationId: identity.observationId,
    propertyId: identity.propertyId,
    source: observation.source,
    externalId: observation.externalId,
    dealType: observation.dealType,
    matchKey: observation.matchKey,
    images: Object.freeze([...images]),
  });
}

function finalResult({
  publishable,
  reasons,
  images,
  uploadCount,
  wouldUploadCount,
  results,
  prepared,
}) {
  return Object.freeze({
    publishable,
    reasons: Object.freeze([...new Set(reasons)]),
    images: Object.freeze([...images]),
    uploadCount,
    wouldUploadCount,
    candidateResults: Object.freeze(results.map((result) => Object.freeze({ ...result }))),
    preparedMedia: prepared,
  });
}

function rightsDisabledPreflight(input) {
  if (!plainRecord(input) || input.rightsConfirmed === true) return null;
  const observation = input.observation;
  if (!plainRecord(observation) || !Array.isArray(observation.mediaCandidates)) return null;
  if (!observation.mediaCandidates.some((candidate) => candidate?.category === "listing_photo")) {
    return null;
  }
  throwIfAborted(input.signal instanceof AbortSignal ? input.signal : null);
  const observationId =
    typeof input.observationId === "string" && UUID_PATTERN.test(input.observationId)
      ? input.observationId.toLowerCase()
      : null;
  const propertyId =
    input.isNew === false &&
    typeof input.propertyId === "string" &&
    UUID_PATTERN.test(input.propertyId)
      ? input.propertyId.toLowerCase()
      : null;
  const identity = { observationId, propertyId };
  const results = observation.mediaCandidates.map((candidate) =>
    resultFor(candidate, identity, { rejectionReason: "media_rights_not_confirmed" }),
  );
  return finalResult({
    publishable: false,
    reasons: ["media_rights_not_confirmed"],
    images: [],
    uploadCount: 0,
    wouldUploadCount: 0,
    results,
    prepared: null,
  });
}

export async function prepareListingMedia(rawInput) {
  const rightsBlocked = rightsDisabledPreflight(rawInput);
  if (rightsBlocked) return rightsBlocked;
  const input = validateInput(rawInput);
  const { observation, observationId, propertyId, mode, repository, blobStore, signal } = input;
  throwIfAborted(signal);
  const identity = { observationId, propertyId };
  const candidates = observation.mediaCandidates;
  const selected = candidates.filter((candidate) => candidate.category === "listing_photo");
  const results = [];
  const reasons = [];
  let uploadCount = 0;
  let wouldUploadCount = 0;

  if (input.rightsConfirmed !== true && selected.length > 0) {
    for (const candidate of candidates) {
      results.push(
        resultFor(candidate, identity, {
          rejectionReason: "media_rights_not_confirmed",
        }),
      );
    }
    return finalResult({
      publishable: false,
      reasons: ["media_rights_not_confirmed"],
      images: [],
      uploadCount,
      wouldUploadCount,
      results,
      prepared: null,
    });
  }

  const saveResult = async (result) => {
    results.push(result);
    if (mode === "upload") await repository.saveMediaRecord(mediaRecord(result));
  };

  const localAssets = new Map();
  const plannedHashes = new Set();
  const successes = [];
  let selectedFailed = false;
  for (let index = 0; index < candidates.length; index += 1) {
    throwIfAborted(signal);
    const candidate = candidates[index];
    if (candidate.category !== "listing_photo") {
      await saveResult(
        resultFor(candidate, identity, { rejectionReason: "ineligible_media_category" }),
      );
      continue;
    }
    if (candidateHasRejectionMarker(candidate)) {
      selectedFailed = true;
      await saveResult(
        resultFor(candidate, identity, { rejectionReason: "candidate_context_rejected" }),
      );
      continue;
    }

    try {
      const downloaded = await fetchImage({
        candidateUrl: candidate.url,
        hosts: input.hosts,
        resolveHost: input.resolveHost,
        fetchImpl: input.fetchImpl,
        sharedSignal: signal,
      });
      const contentHash = sha256(downloaded.bytes);
      let asset = localAssets.get(contentHash) ?? null;
      if (!asset) {
        asset = await repository.findMediaByHash(contentHash);
        if (asset != null) validateAsset(asset);
      }
      if (!asset && mode === "validate") {
        if (!plannedHashes.has(contentHash)) {
          plannedHashes.add(contentHash);
          wouldUploadCount += 1;
        }
      }
      if (!asset && mode === "upload") {
        const pathname = buildOwnedMediaPathname(contentHash, downloaded.mime);
        let blob;
        try {
          blob = await blobStore.put({
            pathname,
            body: downloaded.bytes,
            contentType: downloaded.mime,
          });
          uploadCount += 1;
          validateBlobResult(blob, {
            pathname,
            contentType: downloaded.mime,
            size: downloaded.bytes.byteLength,
          });
        } catch (error) {
          if (error instanceof TypeError && /invalid owned metadata/.test(error.message)) {
            throw error;
          }
          fail("blob_upload_failed");
        }
        asset = validateAsset(
          await repository.registerOwnedMedia({
            url: blob.url,
            pathname: blob.pathname,
            contentType: downloaded.mime,
            sizeBytes: downloaded.bytes.byteLength,
            contentHash,
            ownerType: "mls-shared",
            ownerId: null,
            createdBy: null,
          }),
          { requirePath: true },
        );
        localAssets.set(contentHash, asset);
      }
      const result = resultFor(candidate, identity, {
        contentHash,
        ownedMediaAssetId: asset?.id ?? null,
        ownedUrl: asset?.url ?? null,
        detectedMime: downloaded.mime,
        sizeBytes: downloaded.bytes.byteLength,
        width: downloaded.width,
        height: downloaded.height,
        eligibility: "eligible",
        rejectionReason: null,
      });
      await saveResult(result);
      successes.push({ index, isPrimary: candidate.isPrimary, ownedUrl: result.ownedUrl });
    } catch (error) {
      throwIfAborted(signal);
      const code = error instanceof MediaPreparationError ? error.code : null;
      if (!code) throw error;
      selectedFailed = true;
      reasons.push(code);
      await saveResult(
        resultFor(candidate, identity, {
          eligibility: code === "blob_upload_failed" ? "upload_failed" : "rejected",
          rejectionReason: code,
        }),
      );
    }
  }

  if (selected.length === 0) {
    if (input.isNew) {
      reasons.push("primary_image_required");
      return finalResult({
        publishable: false,
        reasons,
        images: [],
        uploadCount,
        wouldUploadCount,
        results,
        prepared: null,
      });
    }
    const current = await ownedCurrentImages(input.currentImages, repository);
    if (!current.allOwned) reasons.push("current_media_not_owned");
    const publishable = current.allOwned;
    const images = publishable ? current.owned : [];
    return finalResult({
      publishable,
      reasons,
      images,
      uploadCount,
      wouldUploadCount,
      results,
      prepared: publishable ? preparedMedia(identity, observation, images) : null,
    });
  }

  const primarySucceeded = successes.some((success) => success.isPrimary);
  if (selectedFailed) reasons.push("selected_media_failed");
  if (input.isNew && !primarySucceeded) reasons.push("primary_image_required");
  const publishable = !selectedFailed && (!input.isNew || primarySucceeded);
  const images = publishable
    ? [
        ...new Set(
          successes
            .sort(
              (left, right) =>
                Number(right.isPrimary) - Number(left.isPrimary) || left.index - right.index,
            )
            .map((success) => success.ownedUrl)
            .filter((url) => typeof url === "string"),
        ),
      ]
    : [];
  return finalResult({
    publishable,
    reasons,
    images,
    uploadCount,
    wouldUploadCount,
    results,
    prepared: publishable ? preparedMedia(identity, observation, images) : null,
  });
}

export async function defaultResolveMediaHost(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}
