import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deflateSync } from "node:zlib";

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MEDIA_FETCH_TIMEOUT_MS,
  buildOwnedMediaPathname,
  detectImageMime,
  prepareListingMedia,
  sha256,
} from "./media.mjs";
import { createObservation } from "./source-contract.mjs";

const OBSERVATION_ID = "11111111-1111-4111-8111-111111111111";
const PROPERTY_ID = "22222222-2222-4222-8222-222222222222";
const PUBLIC_ADDRESS = "8.8.8.8";
const MEDIA_HOST = "images.28hse.test";

function u32be(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u32le(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function asciiBytes(value) {
  return [...value].map((character) => character.charCodeAt(0));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pngChunk(type, payload = []) {
  const checked = [...asciiBytes(type), ...payload];
  let crc = 0xffffffff;
  for (const byte of checked) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return [...u32be(payload.length), ...checked, ...u32be((crc ^ 0xffffffff) >>> 0)];
}

function pngBytesWithIdat(idat, width = 3, height = 2) {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", [...u32be(width), ...u32be(height), 0x08, 0x06, 0x00, 0x00, 0x00]),
    ...pngChunk("IDAT", idat),
    ...pngChunk("IEND"),
  ]);
}

function pngBytes(width = 3, height = 2) {
  const safeFixtureSize = width * height <= 100_000;
  const scanlines = safeFixtureSize ? new Uint8Array(height * (1 + width * 4)) : new Uint8Array();
  return pngBytesWithIdat(deflateSync(scanlines), width, height);
}

function jpegBytes(width = 3, height = 2) {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xda,
    0x00,
    0x0c,
    0x03,
    0x01,
    0x00,
    0x02,
    0x11,
    0x03,
    0x11,
    0x00,
    0x3f,
    0x00,
    0x00,
    0xff,
    0xd9,
  ]);
}

function webpBytes(width = 3, height = 2) {
  const dimensions = (width - 1) | ((height - 1) << 14);
  const payload = [0x2f, ...u32le(dimensions), 0x01, 0x01, 0x01, 0x01];
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    ...u32le(12 + 8 + payload.length + (payload.length % 2) - 8),
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x4c,
    ...u32le(payload.length),
    ...payload,
    ...(payload.length % 2 ? [0x00] : []),
  ]);
}

function avifBox(type, payload = []) {
  return [...u32be(payload.length + 8), ...asciiBytes(type), ...payload];
}

function avifBytes(width = null, height = null) {
  const metaChildren = [
    ...avifBox("pitm", [0, 0, 0, 0, 0, 1]),
    ...avifBox("iloc", [0, 0, 0, 0, 0, 0, 0, 0]),
    ...avifBox("iinf", [0, 0, 0, 0, 0, 0]),
    ...avifBox("iprp", [...avifBox("ipco"), ...avifBox("ipma", [0, 0, 0, 0, 0, 0])]),
  ];
  const boxes = [
    ...avifBox("ftyp", [...asciiBytes("avif"), 0, 0, 0, 0, ...asciiBytes("avifmif1")]),
    ...avifBox("meta", [0, 0, 0, 0, ...metaChildren]),
  ];
  if (width != null && height != null) {
    boxes.push(...avifBox("ispe", [0, 0, 0, 0, ...u32be(width), ...u32be(height)]));
  }
  boxes.push(...avifBox("mdat", [0, 1, 2, 3, 4, 5, 6, 7]));
  return new Uint8Array(boxes);
}

function listingPhoto(url = `https://${MEDIA_HOST}/photo.png`, isPrimary = true) {
  return { url, category: "listing_photo", isPrimary };
}

function observation(candidates = [listingPhoto()], overrides = {}) {
  return createObservation({
    source: "28hse_agent_540",
    externalId: "3972991",
    dealType: "sale",
    sourceUrl: "https://www.28hse.com/buy/apartment/property-3972991",
    propertyNoRaw: "EP-001",
    fields: { price: 8_000_000 },
    rawFields: { price: "$8,000,000" },
    sourceUpdatedAt: "2026-08-16",
    discoveredAt: "2026-08-17T00:00:00.000Z",
    fetchedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
    mediaCandidates: candidates,
  });
}

function imageResponse(bytes = pngBytes(), init = {}) {
  return new Response(bytes, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "application/octet-stream", ...init.headers },
  });
}

function fakeRepository(options = {}) {
  const state = {
    hashReads: [],
    urlReads: [],
    registered: [],
    records: [],
  };
  const repository = {
    state,
    async findMediaByHash(hash, operation) {
      state.hashReads.push(hash);
      if (typeof options.findMediaByHash === "function")
        return options.findMediaByHash(hash, operation);
      return options.knownHash === hash ? options.knownAsset : null;
    },
    async findMediaByUrls(urls, operation) {
      state.urlReads.push([...urls]);
      if (typeof options.findMediaByUrls === "function")
        return options.findMediaByUrls(urls, operation);
      return options.ownedCurrent ?? [];
    },
    async registerOwnedMedia(input, operation) {
      state.registered.push(structuredClone(input));
      if (typeof options.registerOwnedMedia === "function")
        return options.registerOwnedMedia(input, operation);
      return {
        id: `asset-${state.registered.length}`,
        url: input.url,
        pathname: input.pathname,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        contentHash: input.contentHash,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        createdBy: input.createdBy,
      };
    },
    async saveMediaRecord(input, operation) {
      state.records.push(structuredClone(input));
      if (typeof options.saveMediaRecord === "function")
        return options.saveMediaRecord(input, operation);
    },
  };
  return repository;
}

function fakeBlobStore(options = {}) {
  const puts = [];
  return {
    puts,
    async put(input) {
      puts.push({ ...input, body: new Uint8Array(input.body) });
      if (options.error) throw options.error;
      if (typeof options.put === "function") return options.put(input);
      return {
        url: `https://owned.example/${input.pathname}`,
        downloadUrl: `https://owned.example/${input.pathname}?download=1`,
        pathname: input.pathname,
        contentType: input.contentType,
        size: input.body.byteLength,
      };
    },
  };
}

function mediaFixture(overrides = {}) {
  const { fetchImpl: fixtureTransport, ...fixtureOverrides } = overrides;
  const repository = overrides.repository ?? fakeRepository();
  const blobStore = overrides.blobStore ?? fakeBlobStore();
  const candidates = overrides.candidates ?? [listingPhoto(overrides.candidateUrl)];
  return {
    rightsConfirmed: true,
    observation: overrides.observation ?? observation(candidates),
    observationId: OBSERVATION_ID,
    propertyId: overrides.isNew === false ? PROPERTY_ID : null,
    currentImages: [],
    isNew: true,
    mode: "upload",
    allowedMediaHosts: [MEDIA_HOST],
    resolveHost: async () => [PUBLIC_ADDRESS],
    transport: fixtureTransport ?? (async () => imageResponse(overrides.bytes ?? pngBytes())),
    repository,
    blobStore,
    ...fixtureOverrides,
    repository,
    blobStore,
  };
}

test("media constants preserve the approved size, dimension, pixel, and timeout ceilings", () => {
  assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  assert.equal(MAX_IMAGE_DIMENSION, 12_000);
  assert.equal(MAX_IMAGE_PIXELS, 40_000_000);
  assert.equal(MEDIA_FETCH_TIMEOUT_MS, 30_000);
});

test("magic bytes detect JPEG, PNG, WebP, and AVIF but not filename-like text", () => {
  assert.equal(detectImageMime(jpegBytes()), "image/jpeg");
  assert.equal(detectImageMime(pngBytes()), "image/png");
  assert.equal(detectImageMime(webpBytes()), "image/webp");
  assert.equal(detectImageMime(avifBytes()), "image/avif");
  assert.equal(detectImageMime(new TextEncoder().encode("photo.jpg")), null);
  assert.equal(detectImageMime(new Uint8Array()), null);
});

test("content hash and owned pathname are deterministic and MIME-derived", () => {
  const bytes = pngBytes();
  const hash = sha256(bytes);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, sha256(new Uint8Array(bytes)));
  assert.equal(buildOwnedMediaPathname(hash, "image/png"), `mls/${hash.slice(0, 2)}/${hash}.png`);
  assert.equal(buildOwnedMediaPathname(hash, "image/jpeg"), `mls/${hash.slice(0, 2)}/${hash}.jpg`);
  assert.throws(() => buildOwnedMediaPathname(hash, "image/gif"), /MIME/i);
  assert.throws(() => buildOwnedMediaPathname("not-a-hash", "image/png"), /hash/i);
});

test("rights default false short-circuits all fetch, DNS, repository, and Blob work", async () => {
  let calls = 0;
  const repository = fakeRepository({
    findMediaByHash: () => {
      calls += 1;
      throw new Error("must not read");
    },
  });
  const blobStore = fakeBlobStore({ put: () => (calls += 1) });
  const input = mediaFixture({
    rightsConfirmed: undefined,
    repository,
    blobStore,
    resolveHost: async () => {
      calls += 1;
      throw new Error("must not resolve");
    },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
  });

  const result = await prepareListingMedia(input);

  assert.equal(result.publishable, false);
  assert.deepEqual(result.reasons, ["media_rights_not_confirmed"]);
  assert.equal(result.candidateResults.length, 1);
  assert.equal(result.candidateResults[0].rejectionReason, "media_rights_not_confirmed");
  assert.equal(calls, 0);
  assert.deepEqual(repository.state, { hashReads: [], urlReads: [], registered: [], records: [] });
  assert.equal(blobStore.puts.length, 0);
});

test("rights-disabled preflight does not require unused operational dependencies", async () => {
  let fetches = 0;
  const result = await prepareListingMedia({
    rightsConfirmed: false,
    observation: observation(),
    currentImages: [],
    isNew: true,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch");
    },
  });

  assert.equal(result.publishable, false);
  assert.deepEqual(result.reasons, ["media_rights_not_confirmed"]);
  assert.equal(fetches, 0);
});

test("platform media categories and explicit context rejection markers are never fetched", async () => {
  let fetches = 0;
  const candidates = [
    { url: `https://${MEDIA_HOST}/map.png`, category: "map", isPrimary: false },
    {
      ...listingPhoto(`https://${MEDIA_HOST}/branded.png`),
      rejectionReasons: ["platform_branding"],
    },
  ];
  const result = await prepareListingMedia(
    mediaFixture({
      candidates,
      isNew: true,
      fetchImpl: async () => {
        fetches += 1;
        return imageResponse();
      },
    }),
  );

  assert.equal(fetches, 0);
  assert.equal(result.publishable, false);
  assert.ok(result.reasons.includes("primary_image_required"));
  assert.deepEqual(
    result.candidateResults.map((item) => item.rejectionReason),
    ["ineligible_media_category", "candidate_context_rejected"],
  );
});

test("unsafe schemes, credentials, raw IPs, and hosts outside the exact allowlist are rejected", async () => {
  const unsafeUrls = [
    `http://${MEDIA_HOST}/photo.png`,
    `https://user:pass@${MEDIA_HOST}/photo.png`,
    "https://127.0.0.1/photo.png",
    "https://[::1]/photo.png",
    "https://sub.images.28hse.test/photo.png",
    "https://images.28hse.test.evil.example/photo.png",
  ];

  for (const candidateUrl of unsafeUrls) {
    let fetches = 0;
    const result = await prepareListingMedia(
      mediaFixture({
        candidateUrl,
        fetchImpl: async () => {
          fetches += 1;
          return imageResponse();
        },
      }),
    );
    assert.equal(fetches, 0, candidateUrl);
    assert.equal(result.publishable, false, candidateUrl);
    assert.ok(result.reasons.includes("unsafe_media_url"), candidateUrl);
  }
});

test("DNS validation rejects any non-public IPv4 or IPv6 answer, including mapped addresses", async () => {
  const unsafeAddresses = [
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "100::1",
    "2001:db8::1",
    "2002:0a00:0001::",
    "3fff::1",
    "3fff:0fff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "4000::1",
    "8000::1",
    "f000::1",
  ];

  for (const address of unsafeAddresses) {
    const result = await prepareListingMedia(
      mediaFixture({ resolveHost: async () => [PUBLIC_ADDRESS, { address }] }),
    );
    assert.equal(result.publishable, false, address);
    assert.ok(result.reasons.includes("unsafe_media_url"), address);
  }

  const publicV6 = await prepareListingMedia(
    mediaFixture({ resolveHost: async () => [{ address: "2606:4700:4700::1111", family: 6 }] }),
  );
  assert.equal(publicV6.publishable, true);

  const publicBoundaryV6 = await prepareListingMedia(
    mediaFixture({ resolveHost: async () => [{ address: "3fff:1000::1", family: 6 }] }),
  );
  assert.equal(publicBoundaryV6.publishable, true);
});

test("redirects are manual, same-host, capped at two, and DNS-revalidated each hop", async () => {
  const requests = [];
  const resolutionSignals = [];
  let resolutions = 0;
  const result = await prepareListingMedia(
    mediaFixture({
      resolveHost: async (_hostname, options) => {
        resolutions += 1;
        resolutionSignals.push(options?.signal);
        return [PUBLIC_ADDRESS];
      },
      fetchImpl: async (url, init, connection) => {
        requests.push({
          url: String(url),
          redirect: init.redirect,
          signal: init.signal,
          connection,
        });
        const path = new URL(url).pathname;
        if (path === "/photo.png")
          return new Response(null, { status: 302, headers: { location: "/step-2.png" } });
        if (path === "/step-2.png")
          return new Response(null, { status: 307, headers: { location: "/final.png" } });
        return imageResponse();
      },
    }),
  );

  assert.equal(result.publishable, true);
  assert.deepEqual(
    requests.map((item) => item.redirect),
    ["manual", "manual", "manual"],
  );
  assert.equal(resolutions, 3);
  assert.ok(requests.every((request) => request.signal === requests[0].signal));
  assert.ok(resolutionSignals.every((signal) => signal === requests[0].signal));
  assert.deepEqual(
    requests.map((request) => request.connection),
    Array(3).fill({ address: PUBLIC_ADDRESS, family: 4, hostname: MEDIA_HOST }),
  );

  const tooMany = await prepareListingMedia(
    mediaFixture({
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: "/another.png" } }),
    }),
  );
  assert.equal(tooMany.publishable, false);
  assert.ok(tooMany.reasons.includes("too_many_redirects"));

  const crossHost = await prepareListingMedia(
    mediaFixture({
      allowedMediaHosts: [MEDIA_HOST, "cdn.28hse.test"],
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.28hse.test/final.png" },
        }),
    }),
  );
  assert.equal(crossHost.publishable, false);
  assert.ok(crossHost.reasons.includes("unsafe_media_url"));
});

test("every response body rejected before reading is cancelled exactly once", async () => {
  const cancellationCounts = [];
  const response = (status, headers = {}) => {
    const index = cancellationCounts.push(0) - 1;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      body: {
        async cancel() {
          cancellationCounts[index] += 1;
        },
      },
    };
  };

  await prepareListingMedia(mediaFixture({ fetchImpl: async () => response(302) }));
  await prepareListingMedia(
    mediaFixture({ fetchImpl: async () => response(302, { location: "https://[" }) }),
  );
  await prepareListingMedia(
    mediaFixture({
      allowedMediaHosts: [MEDIA_HOST, "cdn.28hse.test"],
      fetchImpl: async () => response(302, { location: "https://cdn.28hse.test/cross-host.png" }),
    }),
  );
  await prepareListingMedia(
    mediaFixture({ fetchImpl: async () => response(302, { location: "/again.png" }) }),
  );
  await prepareListingMedia(mediaFixture({ fetchImpl: async () => response(503) }));
  await prepareListingMedia(
    mediaFixture({
      fetchImpl: async () => response(200, { "content-length": String(MAX_IMAGE_BYTES + 1) }),
    }),
  );

  assert.deepEqual(cancellationCounts, [1, 1, 1, 1, 1, 1, 1, 1]);
});

test("an unused reader-only response body is cancelled and released", async () => {
  let cancellationReason = null;
  let releases = 0;
  const result = await prepareListingMedia(
    mediaFixture({
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        headers: new Headers(),
        body: {
          getReader() {
            return {
              async cancel(reason) {
                cancellationReason = reason;
              },
              releaseLock() {
                releases += 1;
              },
            };
          },
        },
      }),
    }),
  );

  assert.ok(result.reasons.includes("media_fetch_failed"));
  assert.equal(cancellationReason?.code, "media_fetch_failed");
  assert.equal(releases, 1);
});

test("downloads are sequential and each request observes the shared cancellation signal", async () => {
  const controller = new AbortController();
  let active = 0;
  let maximum = 0;
  const seenSignals = [];
  const candidates = [
    listingPhoto(`https://${MEDIA_HOST}/one.png`, true),
    listingPhoto(`https://${MEDIA_HOST}/two.png`, false),
  ];
  const result = await prepareListingMedia(
    mediaFixture({
      candidates,
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        seenSignals.push(init.signal);
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return imageResponse();
      },
    }),
  );

  assert.equal(result.publishable, true);
  assert.equal(maximum, 1);
  assert.equal(seenSignals.length, 2);
  assert.ok(seenSignals.every((signal) => signal instanceof AbortSignal));

  const reason = new Error("run cancelled exactly");
  controller.abort(reason);
  await assert.rejects(
    prepareListingMedia(mediaFixture({ signal: controller.signal })),
    (error) => {
      assert.equal(error, reason);
      return true;
    },
  );
});

test("mid-stream run cancellation cancels the reader and preserves the exact reason", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel media stream exactly");
  let cancelReason = null;
  let pendingRead = null;
  const response = {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader() {
        return {
          read() {
            return new Promise((resolve) => {
              pendingRead = resolve;
              setTimeout(() => resolve({ done: true, value: undefined }), 25);
            });
          },
          async cancel(value) {
            cancelReason = value;
            pendingRead?.({ done: true, value: undefined });
          },
          releaseLock() {},
        };
      },
    },
  };
  const promise = prepareListingMedia(
    mediaFixture({ signal: controller.signal, fetchImpl: async () => response }),
  );
  setImmediate(() => controller.abort(reason));

  await assert.rejects(promise, (error) => {
    assert.equal(error, reason);
    return true;
  });
  assert.equal(cancelReason, reason);
});

test("reader cleanup cannot lose an abort during listener attachment", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel reader listener race exactly");
  let cancelReason = null;
  const response = {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader() {
        return {
          read() {
            return new Promise(() => {});
          },
          async cancel(value) {
            cancelReason = value;
          },
          releaseLock() {},
        };
      },
    },
  };

  await assert.rejects(
    prepareListingMedia(
      mediaFixture({
        signal: controller.signal,
        fetchImpl: async (_url, init) => {
          const original = init.signal.addEventListener.bind(init.signal);
          Object.defineProperty(init.signal, "addEventListener", {
            configurable: true,
            value(type, listener, options) {
              if (type === "abort" && !controller.signal.aborted) controller.abort(reason);
              return original(type, listener, options);
            },
          });
          return response;
        },
      }),
    ),
    (error) => error === reason,
  );
  assert.equal(cancelReason, reason);
});

test("Content-Length is rejected before body reads and streaming stops above five MiB", async () => {
  let readerRequests = 0;
  let precheckCancelled = false;
  const prechecked = await prepareListingMedia(
    mediaFixture({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(MAX_IMAGE_BYTES + 1) }),
        body: {
          async cancel() {
            precheckCancelled = true;
          },
          getReader() {
            readerRequests += 1;
            throw new Error("body reader must not be requested");
          },
        },
      }),
    }),
  );
  assert.equal(prechecked.publishable, false);
  assert.ok(prechecked.reasons.includes("media_too_large"));
  assert.equal(readerRequests, 0);
  assert.equal(precheckCancelled, true);

  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  chunk.set(pngBytes());
  const streamed = await prepareListingMedia(
    mediaFixture({
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let index = 0; index < 6; index += 1) controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    }),
  );
  assert.equal(streamed.publishable, false);
  assert.ok(streamed.reasons.includes("media_too_large"));
  assert.equal(cancelled, true);
});

test("actual magic controls MIME and safe dimensions are recorded", async () => {
  for (const [bytes, expectedMime, width, height] of [
    [jpegBytes(4, 3), "image/jpeg", 4, 3],
    [pngBytes(5, 4), "image/png", 5, 4],
    [webpBytes(6, 5), "image/webp", 6, 5],
    [avifBytes(7, 6), "image/avif", 7, 6],
    [avifBytes(), "image/avif", null, null],
  ]) {
    const result = await prepareListingMedia(
      mediaFixture({
        bytes,
        fetchImpl: async () => imageResponse(bytes, { contentType: "image/gif" }),
      }),
    );
    assert.equal(result.publishable, true, expectedMime);
    assert.equal(result.candidateResults[0].detectedMime, expectedMime);
    assert.equal(result.candidateResults[0].width, width);
    assert.equal(result.candidateResults[0].height, height);
  }

  const extensionOnly = await prepareListingMedia(
    mediaFixture({
      fetchImpl: async () =>
        imageResponse(new TextEncoder().encode("not an image"), { contentType: "image/png" }),
    }),
  );
  assert.equal(extensionOnly.publishable, false);
  assert.ok(extensionOnly.reasons.includes("unsupported_media_type"));
});

test("oversized dimensions and pixel counts quarantine before hash lookup or upload", async () => {
  for (const bytes of [pngBytes(MAX_IMAGE_DIMENSION + 1, 1), pngBytes(10_000, 5_000)]) {
    const repository = fakeRepository();
    const blobStore = fakeBlobStore();
    const result = await prepareListingMedia(mediaFixture({ bytes, repository, blobStore }));
    assert.equal(result.publishable, false);
    assert.ok(result.reasons.includes("invalid_image_dimensions"));
    assert.equal(repository.state.hashReads.length, 0);
    assert.equal(blobStore.puts.length, 0);
  }
});

test("content-hash reuse returns the existing owned asset without rewriting owner metadata", async () => {
  const bytes = webpBytes();
  const hash = sha256(bytes);
  const knownAsset = {
    id: "asset-admin",
    url: "https://owned.example/admin-existing.webp",
    pathname: "cms/staff/existing.webp",
    contentType: "image/webp",
    sizeBytes: bytes.byteLength,
    contentHash: hash,
    ownerType: "cms",
    ownerId: "33333333-3333-4333-8333-333333333333",
    createdBy: "44444444-4444-4444-8444-444444444444",
  };
  const repository = fakeRepository({ knownHash: hash, knownAsset });
  const blobStore = fakeBlobStore();

  const result = await prepareListingMedia(mediaFixture({ bytes, repository, blobStore }));

  assert.equal(result.publishable, true);
  assert.deepEqual(result.images, [knownAsset.url]);
  assert.equal(result.uploadCount, 0);
  assert.equal(blobStore.puts.length, 0);
  assert.equal(repository.state.registered.length, 0);
  assert.equal(repository.state.records[0].ownedMediaAssetId, knownAsset.id);
  assert.equal(repository.state.records[0].contentHash, hash);
});

test("duplicate content in one listing performs one upload and reuses its registered asset", async () => {
  const bytes = pngBytes();
  const repository = fakeRepository();
  const blobStore = fakeBlobStore();
  const candidates = [
    listingPhoto(`https://${MEDIA_HOST}/one.png`, true),
    listingPhoto(`https://${MEDIA_HOST}/two.png`, false),
  ];

  const result = await prepareListingMedia(
    mediaFixture({ candidates, bytes, repository, blobStore }),
  );

  assert.equal(result.publishable, true);
  assert.equal(result.uploadCount, 1);
  assert.equal(blobStore.puts.length, 1);
  assert.equal(repository.state.registered.length, 1);
  assert.equal(repository.state.records.length, 2);
  assert.deepEqual(result.images, [repository.state.registered[0].url]);
});

test("validate mode performs no writes and reports one would-upload per new content hash", async () => {
  const repository = fakeRepository();
  const blobStore = fakeBlobStore();
  const candidates = [
    listingPhoto(`https://${MEDIA_HOST}/one.png`, true),
    listingPhoto(`https://${MEDIA_HOST}/two.png`, false),
  ];

  const result = await prepareListingMedia(
    mediaFixture({ mode: "validate", candidates, repository, blobStore }),
  );

  assert.equal(result.publishable, true);
  assert.equal(result.uploadCount, 0);
  assert.equal(result.wouldUploadCount, 1);
  assert.equal(blobStore.puts.length, 0);
  assert.equal(repository.state.registered.length, 0);
  assert.equal(repository.state.records.length, 0);
});

test("new listings require one successfully prepared selected primary image", async () => {
  const missing = await prepareListingMedia(mediaFixture({ candidates: [] }));
  assert.equal(missing.publishable, false);
  assert.ok(missing.reasons.includes("primary_image_required"));

  const secondaryOnly = await prepareListingMedia(
    mediaFixture({ candidates: [listingPhoto(`https://${MEDIA_HOST}/secondary.png`, false)] }),
  );
  assert.equal(secondaryOnly.publishable, false);
  assert.ok(secondaryOnly.reasons.includes("primary_image_required"));

  const failedPrimary = await prepareListingMedia(
    mediaFixture({ fetchImpl: async () => new Response("no", { status: 503 }) }),
  );
  assert.equal(failedPrimary.publishable, false);
  assert.ok(failedPrimary.reasons.includes("selected_media_failed"));
  assert.ok(failedPrimary.reasons.includes("primary_image_required"));
});

test("existing listings retain only repository-owned or exact first-party current URLs", async () => {
  const repository = fakeRepository({
    ownedCurrent: [{ id: "asset-current", url: "https://owned.example/current.webp" }],
  });
  const currentImages = [
    "https://owned.example/current.webp",
    "https://www.earnestproperty.com/images/first-party.webp",
  ];
  const retained = await prepareListingMedia(
    mediaFixture({ isNew: false, candidates: [], currentImages, repository }),
  );

  assert.equal(retained.publishable, true);
  assert.deepEqual(retained.images, currentImages);
  assert.equal(retained.preparedMedia.propertyId, PROPERTY_ID);

  for (const currentImage of [
    "https://cdn.28hse.com/current.webp",
    "https://www.earnestproperty.com.evil.example/current.webp",
    "https://www.earnestproperty.com:444/current.webp",
  ]) {
    const unowned = await prepareListingMedia(
      mediaFixture({
        isNew: false,
        candidates: [],
        currentImages: [currentImage],
        repository: fakeRepository(),
      }),
    );
    assert.equal(unowned.publishable, false, currentImage);
    assert.deepEqual(unowned.images, [], currentImage);
    assert.ok(unowned.reasons.includes("current_media_not_owned"), currentImage);
  }
});

test("a selected replacement failure never falls back to an existing owned image", async () => {
  const repository = fakeRepository({
    ownedCurrent: [{ id: "asset-current", url: "https://owned.example/current.webp" }],
  });
  const result = await prepareListingMedia(
    mediaFixture({
      isNew: false,
      currentImages: ["https://owned.example/current.webp"],
      repository,
      fetchImpl: async () => new Response("failed", { status: 502 }),
    }),
  );

  assert.equal(result.publishable, false);
  assert.deepEqual(result.images, []);
  assert.ok(result.reasons.includes("selected_media_failed"));
});

test("new uploads use deterministic paths and mls-shared null ownership metadata", async () => {
  const bytes = pngBytes();
  const hash = sha256(bytes);
  const repository = fakeRepository();
  const blobStore = fakeBlobStore();

  const result = await prepareListingMedia(mediaFixture({ bytes, repository, blobStore }));

  assert.equal(result.publishable, true);
  assert.equal(blobStore.puts[0].pathname, `mls/${hash.slice(0, 2)}/${hash}.png`);
  assert.deepEqual(repository.state.registered[0], {
    url: `https://owned.example/mls/${hash.slice(0, 2)}/${hash}.png`,
    pathname: `mls/${hash.slice(0, 2)}/${hash}.png`,
    contentType: "image/png",
    sizeBytes: bytes.byteLength,
    contentHash: hash,
    ownerType: "mls-shared",
    ownerId: null,
    createdBy: null,
  });
  assert.equal(repository.state.records[0].propertyId, null);
  assert.equal(result.preparedMedia.observationId, OBSERVATION_ID);
  assert.equal(result.preparedMedia.source, "28hse_agent_540");
  assert.equal(result.preparedMedia.externalId, "3972991");
  assert.equal(result.preparedMedia.dealType, "sale");
  assert.equal(result.preparedMedia.matchKey, "sale:EP-001");
});

test("existing-property records carry property id and every candidate receives a result", async () => {
  const repository = fakeRepository();
  const candidates = [
    { url: `https://${MEDIA_HOST}/map.png`, category: "map", isPrimary: false },
    listingPhoto("https://unapproved.example/unsafe.png", false),
    listingPhoto(`https://${MEDIA_HOST}/good.png`, true),
  ];

  const result = await prepareListingMedia(mediaFixture({ isNew: false, candidates, repository }));

  assert.equal(result.candidateResults.length, 3);
  assert.equal(repository.state.records.length, 3);
  assert.ok(repository.state.records.every((record) => record.propertyId === PROPERTY_ID));
  assert.deepEqual(
    repository.state.records.map((record) => record.sourceUrl),
    candidates.map((candidate) => candidate.url),
  );
  assert.equal(result.publishable, false);
});

test("upload failure records upload_failed and never returns the current or attempted URL", async () => {
  const repository = fakeRepository();
  const blobStore = fakeBlobStore({ error: new Error("provider secret detail") });
  const result = await prepareListingMedia(
    mediaFixture({
      isNew: false,
      currentImages: ["https://www.earnestproperty.com/current.webp"],
      repository,
      blobStore,
    }),
  );

  assert.equal(result.publishable, false);
  assert.deepEqual(result.images, []);
  assert.equal(result.candidateResults[0].eligibility, "upload_failed");
  assert.equal(result.candidateResults[0].rejectionReason, "blob_upload_failed");
  assert.doesNotMatch(JSON.stringify(result), /provider secret detail/);
});

test("unbound Blob metadata is quarantined and still records the candidate safely", async () => {
  const repository = fakeRepository();
  const blobStore = fakeBlobStore({
    put: (input) => ({
      url: "https://owned.example/unbound.png",
      pathname: `wrong/${input.pathname}`,
      contentType: input.contentType,
      size: input.body.byteLength,
    }),
  });

  const result = await prepareListingMedia(mediaFixture({ repository, blobStore }));

  assert.equal(result.publishable, false);
  assert.deepEqual(result.images, []);
  assert.ok(result.reasons.includes("blob_upload_failed"));
  assert.equal(result.candidateResults[0].eligibility, "upload_failed");
  assert.equal(repository.state.records.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /unbound\.png/);
});

test("a shared cancellation aborts a hanging resolver immediately with the exact reason", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel unresolved DNS exactly");
  let releaseResolver;
  let resolverSignal;
  let fetches = 0;
  const promise = prepareListingMedia(
    mediaFixture({
      signal: controller.signal,
      resolveHost: (_hostname, options) => {
        resolverSignal = options?.signal;
        return new Promise((resolve) => {
          releaseResolver = resolve;
        });
      },
      fetchImpl: async () => {
        fetches += 1;
        return imageResponse();
      },
    }),
  );
  const observed = promise.then(
    () => ({ value: "resolved" }),
    (error) => ({ error }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(reason);
  const prompt = await Promise.race([
    observed,
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 25)),
  ]);
  releaseResolver?.([PUBLIC_ADDRESS]);
  const final = prompt === "still-pending" ? await observed : prompt;

  assert.notEqual(prompt, "still-pending");
  assert.equal(final.error, reason);
  assert.ok(resolverSignal instanceof AbortSignal);
  assert.equal(fetches, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 0);
});

test("shared cancellation races every repository and Blob await with the exact reason", async (t) => {
  const scenarios = [
    {
      name: "hash lookup",
      arrange(started, gate, observeSignal) {
        const blobStore = fakeBlobStore();
        const repository = fakeRepository({
          findMediaByHash(_hash, operation) {
            observeSignal(operation?.signal);
            started.resolve();
            return gate.promise;
          },
        });
        return {
          input: mediaFixture({ repository, blobStore }),
          verify() {
            assert.equal(blobStore.puts.length, 0);
            assert.equal(repository.state.registered.length, 0);
            assert.equal(repository.state.records.length, 0);
          },
        };
      },
    },
    {
      name: "Blob upload",
      arrange(started, gate, observeSignal) {
        const repository = fakeRepository();
        const blobStore = fakeBlobStore({
          put(input) {
            observeSignal(input.signal);
            started.resolve();
            return gate.promise;
          },
        });
        return {
          input: mediaFixture({ repository, blobStore }),
          verify() {
            assert.equal(repository.state.registered.length, 0);
            assert.equal(repository.state.records.length, 0);
          },
        };
      },
    },
    {
      name: "asset registration",
      arrange(started, gate, observeSignal) {
        const repository = fakeRepository({
          registerOwnedMedia(_input, operation) {
            observeSignal(operation?.signal);
            started.resolve();
            return gate.promise;
          },
        });
        return {
          input: mediaFixture({ repository }),
          verify() {
            assert.equal(repository.state.records.length, 0);
          },
        };
      },
    },
    {
      name: "media record write",
      arrange(started, gate, observeSignal) {
        const repository = fakeRepository({
          saveMediaRecord(_input, operation) {
            observeSignal(operation?.signal);
            started.resolve();
            return gate.promise;
          },
        });
        return { input: mediaFixture({ repository }), verify() {} };
      },
    },
    {
      name: "owned-current lookup",
      arrange(started, gate, observeSignal) {
        const repository = fakeRepository({
          findMediaByUrls(_urls, operation) {
            observeSignal(operation?.signal);
            started.resolve();
            return gate.promise;
          },
        });
        return {
          input: mediaFixture({
            candidates: [],
            currentImages: ["https://www.earnestproperty.com/current.png"],
            isNew: false,
            repository,
          }),
          verify() {},
        };
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const controller = new AbortController();
      const reason = new Error(`cancel ${scenario.name} exactly`);
      const started = deferred();
      const gate = deferred();
      let observedSignal;
      const arranged = scenario.arrange(started, gate, (signal) => {
        observedSignal = signal;
      });
      const promise = prepareListingMedia({ ...arranged.input, signal: controller.signal });
      const observed = promise.then(
        () => ({ value: "resolved" }),
        (error) => ({ error }),
      );
      await started.promise;
      controller.abort(reason);
      const prompt = await Promise.race([
        observed,
        new Promise((resolve) => setTimeout(() => resolve("still-pending"), 25)),
      ]);
      gate.resolve(null);
      const final = prompt === "still-pending" ? await observed : prompt;

      assert.notEqual(prompt, "still-pending", scenario.name);
      assert.equal(final.error, reason, scenario.name);
      assert.equal(observedSignal, controller.signal, scenario.name);
      arranged.verify();
    });
  }
});

test("an abort observed between storage steps prevents later mutations", async () => {
  for (const boundary of ["blob", "registration"]) {
    const controller = new AbortController();
    const reason = new Error(`cancel after ${boundary} exactly`);
    const repository = fakeRepository({
      registerOwnedMedia(input) {
        if (boundary === "registration") controller.abort(reason);
        return {
          id: "asset-boundary",
          ...input,
        };
      },
    });
    const blobStore = fakeBlobStore({
      put(input) {
        if (boundary === "blob") controller.abort(reason);
        return {
          url: `https://owned.example/${input.pathname}`,
          downloadUrl: `https://owned.example/${input.pathname}?download=1`,
          pathname: input.pathname,
          contentType: input.contentType,
          size: input.body.byteLength,
        };
      },
    });

    await assert.rejects(
      prepareListingMedia(mediaFixture({ signal: controller.signal, repository, blobStore })),
      (error) => error === reason,
    );
    assert.equal(repository.state.records.length, 0, boundary);
    if (boundary === "blob") assert.equal(repository.state.registered.length, 0);
  }
});

test("cancellation cannot be lost while the candidate deadline listener is attached", async () => {
  const controller = new AbortController();
  const reason = new Error("abort during listener attachment exactly");
  const originalAddEventListener = controller.signal.addEventListener.bind(controller.signal);
  Object.defineProperty(controller.signal, "addEventListener", {
    configurable: true,
    value(type, listener, options) {
      if (type === "abort" && !controller.signal.aborted) controller.abort(reason);
      return originalAddEventListener(type, listener, options);
    },
  });
  let fetches = 0;

  await assert.rejects(
    prepareListingMedia(
      mediaFixture({
        signal: controller.signal,
        fetchImpl: async () => {
          fetches += 1;
          return imageResponse();
        },
      }),
    ),
    (error) => error === reason,
  );
  assert.equal(fetches, 0);
});

test("redirect-body cleanup cannot outlive the candidate deadline or shared cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel redirect cleanup exactly");
  let releaseCancel;
  const promise = prepareListingMedia(
    mediaFixture({
      signal: controller.signal,
      fetchImpl: async () => ({
        ok: false,
        status: 302,
        headers: new Headers({ location: "/next.png" }),
        body: {
          cancel() {
            return new Promise((resolve) => {
              releaseCancel = resolve;
            });
          },
        },
      }),
    }),
  );
  const observed = promise.then(
    () => ({ value: "resolved" }),
    (error) => ({ error }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(reason);
  const prompt = await Promise.race([
    observed,
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 25)),
  ]);
  releaseCancel?.();
  const final = prompt === "still-pending" ? await observed : prompt;

  assert.notEqual(prompt, "still-pending");
  assert.equal(final.error, reason);
});

test("the production HTTPS transport pins the reviewed address while preserving TLS hostname", async () => {
  const { createPinnedHttpsTransport } = await import("./media.mjs");
  assert.equal(typeof createPinnedHttpsTransport, "function");
  const sentinel = new Error("stop after inspecting request options");
  let captured;
  const transport = createPinnedHttpsTransport({
    requestImpl(url, options) {
      captured = { url: String(url), options };
      throw sentinel;
    },
  });
  const signal = new AbortController().signal;
  await assert.rejects(
    transport(
      `https://${MEDIA_HOST}/photo.png`,
      { method: "GET", headers: { accept: "image/png" }, signal },
      { address: PUBLIC_ADDRESS, family: 4, hostname: MEDIA_HOST },
    ),
    sentinel,
  );

  assert.equal(captured.url, `https://${MEDIA_HOST}/photo.png`);
  assert.equal(captured.options.servername, MEDIA_HOST);
  assert.equal(captured.options.headers.host, MEDIA_HOST);
  assert.equal(captured.options.signal, signal);
  let lookupResult;
  captured.options.lookup(MEDIA_HOST, {}, (error, address, family) => {
    lookupResult = { error, address, family };
  });
  assert.deepEqual(lookupResult, { error: null, address: PUBLIC_ADDRESS, family: 4 });
});

test("truncated JPEG, PNG, WebP, and AVIF structures are rejected before hashing or storage", async () => {
  const corruptPayloads = [
    new Uint8Array([0xff, 0xd8, 0xff]),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    new Uint8Array([...asciiBytes("RIFF"), ...u32le(4), ...asciiBytes("WEBP")]),
    new Uint8Array([...u32be(40), ...asciiBytes("ftypavif"), 0, 0, 0, 0]),
    new Uint8Array([
      ...avifBox("ftyp", [...asciiBytes("avif"), 0, 0, 0, 0, ...asciiBytes("avifmif1")]),
      ...u32be(100),
      ...asciiBytes("meta"),
      0,
      0,
      0,
      0,
    ]),
  ];

  for (const bytes of corruptPayloads) {
    const repository = fakeRepository();
    const blobStore = fakeBlobStore();
    const result = await prepareListingMedia(mediaFixture({ bytes, repository, blobStore }));
    assert.equal(result.publishable, false);
    assert.ok(result.reasons.includes("invalid_image_payload"));
    assert.equal(repository.state.hashReads.length, 0);
    assert.equal(blobStore.puts.length, 0);
  }
});

test("non-decodable PNG, header-only VP8L, and empty AVIF media structures are rejected", async (t) => {
  const corruptPayloads = [
    ["PNG invalid IDAT zlib", pngBytesWithIdat([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff])],
    [
      "WebP header-only VP8L",
      new Uint8Array([
        ...asciiBytes("RIFF"),
        ...u32le(18),
        ...asciiBytes("WEBPVP8L"),
        ...u32le(5),
        0x2f,
        0,
        0,
        0,
        0,
        0,
      ]),
    ],
    [
      "AVIF empty meta and one-byte mdat",
      new Uint8Array([
        ...avifBox("ftyp", [...asciiBytes("avif"), 0, 0, 0, 0, ...asciiBytes("avifmif1")]),
        ...avifBox("meta", [0, 0, 0, 0]),
        ...avifBox("mdat", [0]),
      ]),
    ],
  ];

  for (const [name, bytes] of corruptPayloads) {
    await t.test(name, async () => {
      const repository = fakeRepository();
      const blobStore = fakeBlobStore();
      const result = await prepareListingMedia(mediaFixture({ bytes, repository, blobStore }));
      assert.equal(result.publishable, false);
      assert.ok(result.reasons.includes("invalid_image_payload"));
      assert.equal(repository.state.hashReads.length, 0);
      assert.equal(blobStore.puts.length, 0);
    });
  }
});

test("reused and newly registered assets must be exactly bound to the requested content", async () => {
  const bytes = webpBytes();
  const hash = sha256(bytes);
  const mismatchedReuse = fakeRepository({
    knownHash: hash,
    knownAsset: {
      id: "asset-forged-hash",
      url: "https://owned.example/wrong.webp",
      pathname: "cms/wrong.webp",
      contentType: "image/webp",
      sizeBytes: bytes.byteLength,
      contentHash: "0".repeat(64),
    },
  });
  const reuseResult = await prepareListingMedia(
    mediaFixture({ bytes, repository: mismatchedReuse, blobStore: fakeBlobStore() }),
  );
  assert.equal(reuseResult.publishable, false);
  assert.deepEqual(reuseResult.images, []);
  assert.ok(reuseResult.reasons.includes("owned_media_binding_invalid"));

  const mismatchedRegistration = fakeRepository({
    registerOwnedMedia: (input) => ({
      id: "asset-forged-url",
      ...input,
      url: `https://${MEDIA_HOST}/unowned.webp`,
    }),
  });
  const registrationResult = await prepareListingMedia(
    mediaFixture({ bytes, repository: mismatchedRegistration, blobStore: fakeBlobStore() }),
  );
  assert.equal(registrationResult.publishable, false);
  assert.deepEqual(registrationResult.images, []);
  assert.ok(registrationResult.reasons.includes("owned_media_binding_invalid"));
  assert.doesNotMatch(JSON.stringify(registrationResult), /unowned\.webp/);
});

test("forged or quarantined observations are blocked before any media side effect", async () => {
  const valid = observation();
  const invalidObservations = [
    observation(undefined, { quarantineReasons: ["parser_quarantine"] }),
    { ...valid, contentHash: "0".repeat(64) },
    { ...valid, propertyNoRaw: "EP-999" },
    { ...valid, sourceUrl: " " },
    { ...valid, discoveredAt: "not-a-timestamp" },
  ];

  for (const [index, invalidObservation] of invalidObservations.entries()) {
    let sideEffects = 0;
    const repository = fakeRepository({
      findMediaByHash: () => {
        sideEffects += 1;
        return null;
      },
    });
    await assert.rejects(
      prepareListingMedia(
        mediaFixture({
          rightsConfirmed: index === 0 ? false : true,
          observation: invalidObservation,
          repository,
          resolveHost: async () => {
            sideEffects += 1;
            return [PUBLIC_ADDRESS];
          },
          fetchImpl: async () => {
            sideEffects += 1;
            return imageResponse();
          },
        }),
      ),
      /observation/i,
    );
    assert.equal(sideEffects, 0);
    assert.deepEqual(repository.state.records, []);
  }
});

test("malformed rejection markers and duplicate candidate URLs fail closed before side effects", async () => {
  const duplicateUrl = `https://${MEDIA_HOST}/duplicate.png`;
  const observations = [
    observation([{ ...listingPhoto(), rejectionReasons: "platform_branding" }]),
    observation([listingPhoto(duplicateUrl, true), listingPhoto(duplicateUrl, false)]),
  ];

  for (const invalidObservation of observations) {
    let sideEffects = 0;
    await assert.rejects(
      prepareListingMedia(
        mediaFixture({
          observation: invalidObservation,
          resolveHost: async () => {
            sideEffects += 1;
            return [PUBLIC_ADDRESS];
          },
          fetchImpl: async () => {
            sideEffects += 1;
            return imageResponse();
          },
        }),
      ),
      /observation|duplicate|marker/i,
    );
    assert.equal(sideEffects, 0);
  }
});

test("MediaCandidate declarations expose the exact optional rejection marker contract", () => {
  const declaration = readFileSync(new URL("./source-contract.d.mts", import.meta.url), "utf8");
  for (const expected of [
    /rejected\?:\s*boolean/,
    /eligible\?:\s*boolean/,
    /contextRejected\?:\s*boolean/,
    /rejectionReason\?:\s*string/,
    /rejectionReasons\?:\s*readonly string\[\]/,
    /contextRejectionMarkers\?:\s*readonly string\[\]/,
  ]) {
    assert.match(declaration, expected);
  }
});

test("only the explicitly pin-aware transport seam is accepted", async () => {
  let sideEffects = 0;
  const input = mediaFixture({
    transport: async () => {
      sideEffects += 1;
      return imageResponse();
    },
  });
  input.fetchImpl = async () => {
    sideEffects += 1;
    return imageResponse();
  };

  await assert.rejects(prepareListingMedia(input), /fetchImpl|pin-aware transport/i);
  assert.equal(sideEffects, 0);
});

test("the default resolver documents OS lookup cancellation while orchestration suppresses late work", () => {
  const source = readFileSync(new URL("./media.mjs", import.meta.url), "utf8");
  assert.match(source, /dns\.lookup does not support AbortSignal/);
  assert.match(source, /defaultResolveMediaHost\(hostname, _options/);
});

test("validate-only results are never exposed as owned prepared media", async () => {
  const bytes = webpBytes();
  const hash = sha256(bytes);
  const knownAsset = {
    id: "asset-existing",
    url: "https://owned.example/existing.webp",
    pathname: "cms/existing.webp",
    contentType: "image/webp",
    sizeBytes: bytes.byteLength,
    contentHash: hash,
  };
  const result = await prepareListingMedia(
    mediaFixture({
      mode: "validate",
      bytes,
      repository: fakeRepository({ knownHash: hash, knownAsset }),
    }),
  );

  assert.equal(result.publishable, true);
  assert.deepEqual(result.images, [knownAsset.url]);
  assert.equal(result.preparedMedia, null);
});

test("malformed identity and dependency inputs fail before side effects", async () => {
  let sideEffects = 0;
  const base = mediaFixture({
    resolveHost: async () => {
      sideEffects += 1;
      return [PUBLIC_ADDRESS];
    },
  });

  for (const override of [
    { mode: "publish" },
    { isNew: "yes" },
    { observationId: "not-a-uuid" },
    { observation: { ...base.observation, source: "unknown" } },
    { observation: { ...base.observation, matchKey: "rent:EP-001" } },
    { allowedMediaHosts: ["*.28hse.test"] },
    { allowedMediaHosts: ["127.0.0.1"] },
    { currentImages: [42] },
    { repository: {} },
    { blobStore: {} },
  ]) {
    await assert.rejects(prepareListingMedia({ ...base, ...override }), /invalid|required|must/i);
  }
  assert.equal(sideEffects, 0);
});
