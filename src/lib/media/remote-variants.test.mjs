import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { ensureMediaVariants } from "./remote-variants.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assetId = "00000000-0000-4000-8000-000000000001";
const sourceUrl = "https://owned.public.blob.vercel-storage.com/mls/example.jpg";
function ports(bytes) {
  let saved = null;
  const uploads = [];
  return {
    allowedHosts: ["owned.public.blob.vercel-storage.com"],
    readSource: async () => bytes,
    find: async () => saved,
    save: async (set) => {
      saved = set;
      return set;
    },
    put: async (input) => {
      uploads.push(input);
      return {
        url: "https://owned.public.blob.vercel-storage.com/" + input.pathname,
        pathname: input.pathname,
        contentType: input.contentType,
        size: input.body.length,
      };
    },
    uploads,
  };
}
test("same source hash generates real 160/320/640 WebP variants once", async () => {
  const bytes = await sharp({
    create: { width: 800, height: 500, channels: 3, background: "#abc123" },
  })
    .jpeg()
    .toBuffer();
  const input = { assetId, sourceHash: sha(bytes), sourceUrl };
  const runtime = ports(bytes);
  const first = await ensureMediaVariants(input, runtime);
  assert.equal(first.status, "ready");
  assert.deepEqual(
    first.variants.map((v) => v.width),
    [160, 320, 640],
  );
  for (const [i, item] of runtime.uploads.entries()) {
    const metadata = await sharp(item.body).metadata();
    assert.equal(metadata.width, first.variants[i].width);
    assert.equal(metadata.format, "webp");
    assert.equal(item.body.length, first.variants[i].bytes);
  }
  const second = await ensureMediaVariants(input, runtime);
  assert.deepEqual(second, first);
  assert.equal(runtime.uploads.length, 3);
});
test("source changes, untrusted hosts and invalid images fail closed", async () => {
  const bytes = await sharp({
    create: { width: 200, height: 100, channels: 3, background: "#abc123" },
  })
    .jpeg()
    .toBuffer();
  const runtime = ports(bytes);
  const input = { assetId, sourceHash: sha(bytes), sourceUrl };
  assert.deepEqual(
    (await ensureMediaVariants(input, runtime)).variants.map((v) => v.width),
    [160],
  );
  await assert.rejects(
    () => ensureMediaVariants({ ...input, sourceHash: "a".repeat(64) }, runtime),
    /hash/i,
  );
  await assert.rejects(
    () => ensureMediaVariants({ ...input, sourceUrl: "https://evil.example/image.jpg" }, runtime),
    /host/i,
  );
  await assert.rejects(
    () =>
      ensureMediaVariants(
        { ...input, sourceUrl: "http://owned.public.blob.vercel-storage.com/image.jpg" },
        runtime,
      ),
    /HTTPS/i,
  );
  const invalid = ports(Buffer.from("not an image"));
  await assert.rejects(
    () => ensureMediaVariants({ ...input, sourceHash: sha(Buffer.from("not an image")) }, invalid),
    /image/i,
  );
});
test("upload failure preserves original-image fallback and no false srcset", async () => {
  const bytes = await sharp({
    create: { width: 320, height: 200, channels: 3, background: "#abc123" },
  })
    .png()
    .toBuffer();
  const runtime = ports(bytes);
  runtime.put = async () => {
    throw new Error("blob unavailable");
  };
  const set = await ensureMediaVariants({ assetId, sourceHash: sha(bytes), sourceUrl }, runtime);
  assert.equal(set.status, "failed");
  assert.deepEqual(set.variants, []);
});
