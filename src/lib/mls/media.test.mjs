import assert from "node:assert/strict";
import { test } from "node:test";

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

const OBSERVATION_ID = "11111111-1111-4111-8111-111111111111";
const PROPERTY_ID = "22222222-2222-4222-8222-222222222222";
const PUBLIC_ADDRESS = "8.8.8.8";
const MEDIA_HOST = "images.28hse.test";

function u32be(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngBytes(width = 3, height = 2) {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32be(width),
    ...u32be(height),
    0x08,
    0x06,
    0x00,
    0x00,
    0x00,
  ]);
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
    0xd9,
  ]);
}

function webpBytes(width = 3, height = 2) {
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    0x16,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x58,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    widthMinusOne & 0xff,
    (widthMinusOne >>> 8) & 0xff,
    (widthMinusOne >>> 16) & 0xff,
    heightMinusOne & 0xff,
    (heightMinusOne >>> 8) & 0xff,
    (heightMinusOne >>> 16) & 0xff,
  ]);
}

function avifBytes(width = null, height = null) {
  const base = [
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
    0x61, 0x76, 0x69, 0x66, 0x6d, 0x69, 0x66, 0x31,
  ];
  if (width == null || height == null) return new Uint8Array(base);
  return new Uint8Array([
    ...base,
    0x00,
    0x00,
    0x00,
    0x14,
    0x69,
    0x73,
    0x70,
    0x65,
    0x00,
    0x00,
    0x00,
    0x00,
    ...u32be(width),
    ...u32be(height),
  ]);
}

function listingPhoto(url = `https://${MEDIA_HOST}/photo.png`, isPrimary = true) {
  return { url, category: "listing_photo", isPrimary };
}

function observation(candidates = [listingPhoto()]) {
  return {
    schemaVersion: 1,
    source: "28hse_agent_540",
    externalId: "3972991",
    dealType: "sale",
    matchKey: "sale:EP-001",
    mediaCandidates: candidates,
  };
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
    async findMediaByHash(hash) {
      state.hashReads.push(hash);
      if (typeof options.findMediaByHash === "function") return options.findMediaByHash(hash);
      return options.knownHash === hash ? options.knownAsset : null;
    },
    async findMediaByUrls(urls) {
      state.urlReads.push([...urls]);
      if (typeof options.findMediaByUrls === "function") return options.findMediaByUrls(urls);
      return options.ownedCurrent ?? [];
    },
    async registerOwnedMedia(input) {
      state.registered.push(structuredClone(input));
      if (typeof options.registerOwnedMedia === "function")
        return options.registerOwnedMedia(input);
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
    async saveMediaRecord(input) {
      state.records.push(structuredClone(input));
      if (typeof options.saveMediaRecord === "function") return options.saveMediaRecord(input);
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
    fetchImpl: async () => imageResponse(overrides.bytes ?? pngBytes()),
    repository,
    blobStore,
    ...overrides,
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
    "fc00::1",
    "fe80::1",
    "ff02::1",
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
});

test("redirects are manual, same-host, capped at two, and DNS-revalidated each hop", async () => {
  const requests = [];
  let resolutions = 0;
  const result = await prepareListingMedia(
    mediaFixture({
      resolveHost: async () => {
        resolutions += 1;
        return [PUBLIC_ADDRESS];
      },
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), redirect: init.redirect });
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

test("Content-Length is rejected before body reads and streaming stops above five MiB", async () => {
  let readerRequests = 0;
  const prechecked = await prepareListingMedia(
    mediaFixture({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(MAX_IMAGE_BYTES + 1) }),
        body: {
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
