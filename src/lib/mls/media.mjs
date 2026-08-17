import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import { exactObservationQuarantineReason } from "./match.mjs";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 12_000;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MEDIA_FETCH_TIMEOUT_MS = 30_000;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
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

function readU32le(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

function readU64be(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.length) return null;
  let result = 0n;
  for (let index = 0; index < 8; index += 1) {
    result = (result << 8n) | BigInt(bytes[offset + index]);
  }
  return result;
}

function pngCrc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validJpegStructure(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  let inScan = false;
  let sawFrame = false;
  let sawScan = false;
  while (offset < bytes.length) {
    if (inScan) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return false;
      const marker = bytes[offset];
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 1;
        continue;
      }
      inScan = false;
      offset -= 1;
      continue;
    }
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) return sawFrame && sawScan && offset === bytes.length;
    if (marker === 0xd8 || marker === 0x00) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = readU16be(bytes, offset);
    if (segmentLength == null || segmentLength < 2 || offset + segmentLength > bytes.length) {
      return false;
    }
    if (frameMarkers.has(marker)) {
      const components = bytes[offset + 7];
      if (
        segmentLength !== 8 + components * 3 ||
        components < 1 ||
        readU16be(bytes, offset + 3) < 1 ||
        readU16be(bytes, offset + 5) < 1
      ) {
        return false;
      }
      sawFrame = true;
    }
    if (marker === 0xda) {
      const components = bytes[offset + 2];
      if (components < 1 || segmentLength !== 6 + components * 2 || !sawFrame) return false;
      sawScan = true;
      inScan = true;
    }
    offset += segmentLength;
  }
  return false;
}

function validPngStructure(bytes) {
  if (
    bytes.length < 57 ||
    bytes[0] !== 0x89 ||
    ascii(bytes, 1, 3) !== "PNG" ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return false;
  }
  let offset = 8;
  let chunks = 0;
  let sawHeader = false;
  let imageDataBytes = 0;
  let sawEnd = false;
  while (offset < bytes.length) {
    const length = readU32be(bytes, offset);
    if (length == null || length > bytes.length - offset - 12) return false;
    const type = ascii(bytes, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const storedCrc = readU32be(bytes, dataEnd);
    if (storedCrc !== pngCrc32(bytes, offset + 4, dataEnd)) return false;
    if (chunks === 0) {
      if (type !== "IHDR" || length !== 13) return false;
      const width = readU32be(bytes, dataStart);
      const height = readU32be(bytes, dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      const allowedDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      }[colorType];
      if (
        !width ||
        !height ||
        !allowedDepths?.includes(bitDepth) ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        ![0, 1].includes(bytes[dataStart + 12])
      ) {
        return false;
      }
      sawHeader = true;
    } else if (type === "IHDR") {
      return false;
    }
    if (type === "IDAT") imageDataBytes += length;
    if (type === "IEND") {
      if (length !== 0 || dataEnd + 4 !== bytes.length) return false;
      sawEnd = true;
    }
    chunks += 1;
    offset = dataEnd + 4;
  }
  return sawHeader && imageDataBytes > 0 && sawEnd && offset === bytes.length;
}

function validWebpStructure(bytes) {
  if (
    bytes.length < 26 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    readU32le(bytes, 4) !== bytes.length - 8
  ) {
    return false;
  }
  let offset = 12;
  let sawVisualData = false;
  while (offset < bytes.length) {
    const kind = ascii(bytes, offset, 4);
    const length = readU32le(bytes, offset + 4);
    if (!kind || length == null) return false;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const paddedEnd = dataEnd + (length % 2);
    if (dataEnd > bytes.length || paddedEnd > bytes.length) return false;
    if (kind === "VP8X" && length !== 10) return false;
    if (kind === "VP8L") {
      if (length < 5 || bytes[dataStart] !== 0x2f) return false;
      sawVisualData = true;
    } else if (kind === "VP8 ") {
      if (
        length < 10 ||
        bytes[dataStart + 3] !== 0x9d ||
        bytes[dataStart + 4] !== 0x01 ||
        bytes[dataStart + 5] !== 0x2a
      ) {
        return false;
      }
      sawVisualData = true;
    } else if (kind === "ANMF") {
      if (length < 16) return false;
      sawVisualData = true;
    }
    offset = paddedEnd;
  }
  return sawVisualData && offset === bytes.length;
}

function validAvifStructure(bytes) {
  let offset = 0;
  let boxes = 0;
  let sawFtyp = false;
  let sawMeta = false;
  let sawMediaData = false;
  while (offset < bytes.length) {
    const size32 = readU32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    if (size32 == null || !type || size32 === 0) return false;
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      const largeSize = readU64be(bytes, offset + 8);
      if (largeSize == null || largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      headerSize = 16;
      size = Number(largeSize);
    }
    if (size < headerSize || size > bytes.length - offset) return false;
    if (boxes === 0) {
      if (type !== "ftyp" || size < headerSize + 8 || (size - headerSize) % 4 !== 0) return false;
      const brands = [];
      for (
        let brandOffset = offset + headerSize;
        brandOffset + 4 <= offset + size;
        brandOffset += 4
      ) {
        if (brandOffset === offset + headerSize + 4) continue;
        brands.push(ascii(bytes, brandOffset, 4));
      }
      if (!brands.includes("avif") && !brands.includes("avis")) return false;
      sawFtyp = true;
    }
    if (type === "meta") {
      if (size < headerSize + 4) return false;
      sawMeta = true;
    }
    if (type === "mdat" && size > headerSize) sawMediaData = true;
    boxes += 1;
    offset += size;
  }
  return sawFtyp && sawMeta && sawMediaData && offset === bytes.length;
}

function validateImageStructure(bytes, mime) {
  const valid =
    mime === "image/jpeg"
      ? validJpegStructure(bytes)
      : mime === "image/png"
        ? validPngStructure(bytes)
        : mime === "image/webp"
          ? validWebpStructure(bytes)
          : validAvifStructure(bytes);
  if (!valid) fail("invalid_image_payload");
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
  if (address >> 32n === 0xffffn) {
    const mapped = Number(address & 0xffffffffn);
    return publicIpv4(
      `${(mapped >>> 24) & 0xff}.${(mapped >>> 16) & 0xff}.${(mapped >>> 8) & 0xff}.${mapped & 0xff}`,
    );
  }
  if (!hasIpv6Prefix(address, ipv6BigInt("2000::"), 3)) return false;
  const blocked = [
    [ipv6BigInt("2001::"), 23],
    [ipv6BigInt("2001:db8::"), 32],
    [ipv6BigInt("2002::"), 16],
    [ipv6BigInt("3ffe::"), 16],
  ];
  return blocked.every(([prefix, bits]) => !hasIpv6Prefix(address, prefix, bits));
}

function normalizedPublicAddress(value) {
  const text = typeof value === "string" ? value : value?.address;
  if (typeof text !== "string") return null;
  const normalized = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  const family = isIP(normalized);
  if (value?.family != null && Number(value.family) !== family) return null;
  if (family === 4) return publicIpv4(normalized) ? { address: normalized, family: 4 } : null;
  if (family !== 6 || !publicIpv6(normalized)) return null;
  const parsed = ipv6BigInt(normalized);
  if (parsed >> 32n === 0xffffn) {
    const mapped = Number(parsed & 0xffffffffn);
    return {
      address: `${(mapped >>> 24) & 0xff}.${(mapped >>> 16) & 0xff}.${(mapped >>> 8) & 0xff}.${mapped & 0xff}`,
      family: 4,
    };
  }
  return { address: normalized.toLowerCase(), family: 6 };
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

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function abortRace(operation, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () =>
      finish(reject, signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    Promise.resolve()
      .then(() => {
        throwIfAborted(signal);
        return operation();
      })
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
  });
}

function candidateSignal(sharedSignal) {
  throwIfAborted(sharedSignal);
  const controller = new AbortController();
  const timeoutReason = new MediaPreparationError("media_fetch_timeout");
  const timer = setTimeout(() => controller.abort(timeoutReason), MEDIA_FETCH_TIMEOUT_MS);
  const onAbort = () =>
    controller.abort(sharedSignal.reason ?? new DOMException("Aborted", "AbortError"));
  sharedSignal?.addEventListener("abort", onAbort, { once: true });
  if (sharedSignal?.aborted) onAbort();
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      sharedSignal?.removeEventListener("abort", onAbort);
    },
  };
}

function nodeResponseHeaders(values) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, String(entry));
    } else if (value != null) {
      headers.set(name, String(value));
    }
  }
  return headers;
}

export function createPinnedHttpsTransport({ requestImpl = httpsRequest } = {}) {
  if (typeof requestImpl !== "function") throw new TypeError("requestImpl must be a function");
  return async function pinnedHttpsTransport(urlValue, init = {}, connection) {
    const url = new URL(urlValue);
    const reviewed = normalizedPublicAddress(connection);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !reviewed ||
      connection?.hostname !== url.hostname
    ) {
      throw new TypeError("Pinned HTTPS connection metadata is invalid");
    }
    const headers = new Headers(init.headers);
    headers.set("host", url.host);
    const options = {
      method: init.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
      signal: init.signal,
      servername: url.hostname,
      agent: false,
      lookup(hostname, lookupOptions, callback) {
        if (hostname !== url.hostname) {
          callback(new Error("Pinned HTTPS hostname mismatch"));
          return;
        }
        if (lookupOptions?.all) {
          callback(null, [{ address: reviewed.address, family: reviewed.family }]);
          return;
        }
        callback(null, reviewed.address, reviewed.family);
      },
    };
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = requestImpl(url, options, (response) => {
          const status = Number(response.statusCode);
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: nodeResponseHeaders(response.headers),
            body: Readable.toWeb(response),
          });
        });
      } catch (error) {
        reject(error);
        return;
      }
      request.once("error", reject);
      request.end();
    });
  };
}

async function resolvePublicConnection(url, resolveHost, signal) {
  let addresses;
  try {
    addresses = await abortRace(() => resolveHost(url.hostname, { signal }), signal);
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof MediaPreparationError) throw error;
    fail("unsafe_media_url");
  }
  const values = Array.isArray(addresses) ? addresses : addresses == null ? [] : [addresses];
  const normalized = values.map(normalizedPublicAddress);
  if (normalized.length === 0 || normalized.some((address) => address == null)) {
    fail("unsafe_media_url");
  }
  normalized.sort(
    (left, right) => left.family - right.family || left.address.localeCompare(right.address, "en"),
  );
  return { ...normalized[0], hostname: url.hostname };
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
    const buffer = new Uint8Array(await abortRace(() => response.arrayBuffer(), signal));
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
      const { value, done } = await abortRace(() => reader.read(), signal);
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
    try {
      reader.releaseLock();
    } catch {}
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchImage({ candidateUrl, hosts, resolveHost, transport, sharedSignal }) {
  const deadline = candidateSignal(sharedSignal);
  try {
    let current = parseCandidateUrl(candidateUrl, hosts);
    const originalHostname = current.hostname;
    for (let redirects = 0; ; redirects += 1) {
      throwIfAborted(deadline.signal);
      const connection = await resolvePublicConnection(current, resolveHost, deadline.signal);
      const response = await abortRace(
        () =>
          transport(
            current.toString(),
            {
              method: "GET",
              redirect: "manual",
              credentials: "omit",
              referrerPolicy: "no-referrer",
              headers: { accept: "image/avif,image/webp,image/png,image/jpeg" },
              signal: deadline.signal,
            },
            connection,
          ),
        deadline.signal,
      );
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
        if (typeof response.body?.cancel === "function") {
          try {
            await abortRace(() => response.body.cancel(), deadline.signal);
          } catch {
            throwIfAborted(deadline.signal);
          }
        }
        current = next;
        continue;
      }
      if (!response?.ok) fail("media_fetch_failed");
      const bytes = await readLimitedBody(response, deadline.signal);
      const mime = detectImageMime(bytes);
      if (!mime || !ALLOWED_MIME.has(mime)) fail("unsupported_media_type");
      validateImageStructure(bytes, mime);
      const { width, height } = imageDimensions(bytes, mime);
      return { bytes, mime, width, height };
    }
  } catch (error) {
    if (sharedSignal?.aborted) {
      throw sharedSignal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (deadline.signal.aborted) throw deadline.signal.reason;
    if (error instanceof MediaPreparationError) throw error;
    fail("media_fetch_failed");
  } finally {
    deadline.cleanup();
  }
}

function plainRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const CANDIDATE_KEYS = new Set([
  "url",
  "category",
  "isPrimary",
  "rejected",
  "eligible",
  "contextRejected",
  "rejectionReason",
  "rejectionReasons",
  "contextRejectionMarkers",
]);

function validateMarkerArray(candidate, key) {
  if (!hasOwn(candidate, key)) return;
  const value = candidate[key];
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) => typeof entry !== "string" || entry.length === 0 || entry.trim() !== entry,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError("observation media candidate rejection marker is invalid");
  }
}

function validateCandidateMarkers(candidate) {
  if (Object.keys(candidate).some((key) => !CANDIDATE_KEYS.has(key))) {
    throw new TypeError("observation media candidate rejection marker is invalid");
  }
  for (const key of ["rejected", "eligible", "contextRejected"]) {
    if (hasOwn(candidate, key) && typeof candidate[key] !== "boolean") {
      throw new TypeError("observation media candidate rejection marker is invalid");
    }
  }
  if (
    hasOwn(candidate, "rejectionReason") &&
    (typeof candidate.rejectionReason !== "string" ||
      candidate.rejectionReason.length === 0 ||
      candidate.rejectionReason.trim() !== candidate.rejectionReason)
  ) {
    throw new TypeError("observation media candidate rejection marker is invalid");
  }
  validateMarkerArray(candidate, "rejectionReasons");
  validateMarkerArray(candidate, "contextRejectionMarkers");
}

function validateObservation(observation) {
  const reason = exactObservationQuarantineReason(observation);
  if (reason) throw new TypeError(`observation is invalid: ${reason}`);
  const urls = new Set();
  for (const candidate of observation.mediaCandidates) {
    validateCandidateMarkers(candidate);
    if (urls.has(candidate.url)) {
      throw new TypeError("observation has duplicate media candidate URLs");
    }
    urls.add(candidate.url);
  }
  return observation;
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

function validateAsset(asset, expected) {
  if (
    !plainRecord(asset) ||
    typeof asset.id !== "string" ||
    asset.id.length === 0 ||
    asset.id.trim() !== asset.id ||
    typeof asset.url !== "string" ||
    typeof asset.pathname !== "string" ||
    asset.pathname.length === 0 ||
    asset.pathname.trim() !== asset.pathname ||
    !ALLOWED_MIME.has(asset.contentType) ||
    !Number.isSafeInteger(asset.sizeBytes) ||
    asset.sizeBytes < 0 ||
    typeof asset.contentHash !== "string" ||
    !SHA256_PATTERN.test(asset.contentHash)
  ) {
    fail("owned_media_binding_invalid");
  }
  let url;
  try {
    url = new URL(asset.url);
  } catch {
    fail("owned_media_binding_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail("owned_media_binding_invalid");
  }
  if (
    asset.contentHash !== expected.contentHash ||
    asset.contentType !== expected.contentType ||
    asset.sizeBytes !== expected.sizeBytes ||
    (expected.pathname != null && asset.pathname !== expected.pathname) ||
    (expected.url != null && asset.url !== expected.url)
  ) {
    fail("owned_media_binding_invalid");
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

function validateInput(input, validatedObservation) {
  if (!plainRecord(input)) throw new TypeError("prepareListingMedia input is required");
  if (input.mode !== "validate" && input.mode !== "upload") {
    throw new TypeError("mode must be validate or upload");
  }
  if (typeof input.isNew !== "boolean") throw new TypeError("isNew must be a boolean");
  const observationId = validateUuid(input.observationId, "observationId");
  const propertyId = input.isNew
    ? null
    : validateUuid(input.propertyId, "propertyId", { nullable: false });
  const observation = validatedObservation ?? validateObservation(input.observation);
  if (
    !Array.isArray(input.currentImages) ||
    input.currentImages.some(
      (value) => typeof value !== "string" || value.length === 0 || value.trim() !== value,
    )
  ) {
    throw new TypeError("currentImages must be an array of non-empty strings");
  }
  if (hasOwn(input, "fetchImpl") && typeof input.fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  if (hasOwn(input, "transport") && typeof input.transport !== "function") {
    throw new TypeError("transport must be a function");
  }
  if (hasOwn(input, "resolveHost") && typeof input.resolveHost !== "function") {
    throw new TypeError("resolveHost must be a function");
  }
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
    resolveHost: input.resolveHost ?? defaultResolveMediaHost,
    transport: input.transport ?? input.fetchImpl ?? createPinnedHttpsTransport(),
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
  if (!plainRecord(rawInput)) throw new TypeError("prepareListingMedia input is required");
  if (rawInput.signal != null && !(rawInput.signal instanceof AbortSignal)) {
    throw new TypeError("signal must be an AbortSignal");
  }
  const validatedObservation = validateObservation(rawInput.observation);
  const preflightInput = { ...rawInput, observation: validatedObservation };
  const rightsBlocked = rightsDisabledPreflight(preflightInput);
  if (rightsBlocked) return rightsBlocked;
  const input = validateInput(preflightInput, validatedObservation);
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
        transport: input.transport,
        sharedSignal: signal,
      });
      const contentHash = sha256(downloaded.bytes);
      let asset = localAssets.get(contentHash) ?? null;
      if (!asset) {
        asset = await repository.findMediaByHash(contentHash);
        if (asset != null) {
          validateAsset(asset, {
            contentHash,
            contentType: downloaded.mime,
            sizeBytes: downloaded.bytes.byteLength,
          });
        }
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
          validateBlobResult(blob, {
            pathname,
            contentType: downloaded.mime,
            size: downloaded.bytes.byteLength,
          });
          uploadCount += 1;
        } catch {
          throwIfAborted(signal);
          fail("blob_upload_failed");
        }
        const registration = {
          url: blob.url,
          pathname: blob.pathname,
          contentType: downloaded.mime,
          sizeBytes: downloaded.bytes.byteLength,
          contentHash,
          ownerType: "mls-shared",
          ownerId: null,
          createdBy: null,
        };
        asset = validateAsset(await repository.registerOwnedMedia(registration), registration);
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
      prepared:
        publishable && mode === "upload" ? preparedMedia(identity, observation, images) : null,
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
    prepared:
      publishable && mode === "upload" ? preparedMedia(identity, observation, images) : null,
  });
}

export async function defaultResolveMediaHost(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}
