import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createVercelBlobStore } from "./vercel-blob.mjs";

const TOKEN = "vercel_blob_rw_store123_secret456";

function successfulFetch(calls, overrides = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), ...init });
    return new Response(
      JSON.stringify({
        url: "https://owned.example/mls/ab/abcdef.webp",
        downloadUrl: "https://owned.example/mls/ab/abcdef.webp?download=1",
        pathname: "mls/ab/abcdef.webp",
        contentType: "image/webp",
        size: 4,
        ...overrides,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

test("blob adapter preserves the Vercel endpoint, token-derived store id, and public headers", async () => {
  const calls = [];
  const body = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
  const store = createVercelBlobStore({ token: TOKEN, fetchImpl: successfulFetch(calls) });

  const saved = await store.put({
    pathname: "mls/ab/abcdef.webp",
    body,
    contentType: "image/webp",
  });

  assert.deepEqual(saved, {
    url: "https://owned.example/mls/ab/abcdef.webp",
    downloadUrl: "https://owned.example/mls/ab/abcdef.webp?download=1",
    pathname: "mls/ab/abcdef.webp",
    contentType: "image/webp",
    size: 4,
  });
  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.origin + requestUrl.pathname, "https://vercel.com/api/blob/");
  assert.equal(requestUrl.searchParams.get("pathname"), "mls/ab/abcdef.webp");
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].redirect, "error");
  assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].headers["x-api-version"], "12");
  assert.equal(calls[0].headers["x-vercel-blob-store-id"], "store123");
  assert.equal(calls[0].headers["x-vercel-blob-access"], "public");
  assert.equal(calls[0].headers["x-content-type"], "image/webp");
  assert.equal(calls[0].body, body);
});

test("blob adapter encodes a pathname as one query value without flattening its segments", async () => {
  const calls = [];
  const pathname = "property/staff id/photo name.webp";
  const store = createVercelBlobStore({
    token: TOKEN,
    fetchImpl: successfulFetch(calls, { pathname, size: 1, contentType: "image/webp" }),
  });

  const saved = await store.put({
    pathname,
    body: new Uint8Array([1]),
    contentType: "image/webp",
  });

  assert.equal(new URL(calls[0].url).searchParams.get("pathname"), pathname);
  assert.equal(saved.pathname, pathname);
});

test("blob adapter derives missing optional metadata from the validated request", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      url: "https://owned.example/property/image.avif",
      pathname: "property/image.avif",
    });
  };
  const store = createVercelBlobStore({ token: TOKEN, fetchImpl });
  const saved = await store.put({
    pathname: "property/image.avif",
    body: new Uint8Array([1, 2, 3]),
    contentType: "image/avif",
  });

  assert.equal(saved.downloadUrl, saved.url);
  assert.equal(saved.contentType, "image/avif");
  assert.equal(saved.size, 3);
});

test("blob adapter validates configuration and put input before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("must not fetch");
  };

  assert.throws(() => createVercelBlobStore({ token: "", fetchImpl }), /token/i);
  assert.throws(() => createVercelBlobStore({ token: "test-token", fetchImpl }), /token/i);
  assert.throws(() => createVercelBlobStore({ token: TOKEN, fetchImpl: null }), /fetch/i);

  const store = createVercelBlobStore({ token: TOKEN, fetchImpl });
  await assert.rejects(
    store.put({ pathname: "", body: new Uint8Array([1]), contentType: "image/png" }),
    /pathname/i,
  );
  await assert.rejects(
    store.put({ pathname: "x.png", body: null, contentType: "image/png" }),
    /body/i,
  );
  await assert.rejects(
    store.put({ pathname: "x.png", body: new Uint8Array([1]), contentType: "" }),
    /content.?type/i,
  );
  for (const body of ["not binary", { byteLength: 1 }, { size: 1 }]) {
    await assert.rejects(store.put({ pathname: "x.png", body, contentType: "image/png" }), /body/i);
  }
  assert.equal(calls, 0);
});

test("blob adapter declaration exposes exactly the runtime-supported binary body types", () => {
  const declaration = readFileSync(new URL("./vercel-blob.d.mts", import.meta.url), "utf8");
  assert.doesNotMatch(declaration, /\bBodyInit\b/);
  assert.match(declaration, /body:\s*Blob\s*\|\s*ArrayBuffer\s*\|\s*ArrayBufferView/);
});

test("blob adapter rejects failed or malformed responses without exposing the token", async () => {
  const failed = createVercelBlobStore({
    token: TOKEN,
    fetchImpl: async () => new Response("upstream detail", { status: 503 }),
  });
  await assert.rejects(
    failed.put({ pathname: "x.png", body: new Uint8Array([1]), contentType: "image/png" }),
    (error) => {
      assert.match(error.message, /503/);
      assert.doesNotMatch(error.message, new RegExp(TOKEN));
      assert.doesNotMatch(error.message, /upstream detail/);
      return true;
    },
  );

  for (const payload of [
    null,
    { url: "http://owned.example/x.png", pathname: "x.png" },
    { url: "https://owned.example/x.png", pathname: "other.png" },
    { url: "https://owned.example/x.png", pathname: "x.png", size: -1 },
    { url: "https://owned.example/x.png", pathname: "x.png", contentType: 42 },
  ]) {
    const store = createVercelBlobStore({
      token: TOKEN,
      fetchImpl: async () => Response.json(payload),
    });
    await assert.rejects(
      store.put({ pathname: "x.png", body: new Uint8Array([1]), contentType: "image/png" }),
      /invalid/i,
    );
  }
});
