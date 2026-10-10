import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// F-14: responsive variants are always on. Nothing reads the retired switches.
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("remote-variants.server.ts and mls/media.mjs do not read MLS_MEDIA_VARIANTS_ENABLED", async () => {
  for (const path of ["./remote-variants.server.ts", "../mls/media.mjs"])
    assert.doesNotMatch(await read(path), /MLS_MEDIA_VARIANTS_ENABLED/, path);
});

test(".env.example lists neither MLS_MEDIA_VARIANTS_ENABLED nor MEDIA_BACKFILL_TARGET", async () => {
  const env = await read("../../../.env.example");
  assert.doesNotMatch(env, /MLS_MEDIA_VARIANTS_ENABLED/);
  assert.doesNotMatch(env, /MEDIA_BACKFILL_TARGET/);
  assert.match(env, /^MLS_OWNED_BLOB_HOSTS=/m);
});

test("the variant backfill no longer reads MEDIA_BACKFILL_TARGET", async () => {
  const script = await read("../../../scripts/media/backfill-remote-variants.mjs");
  assert.doesNotMatch(script, /MEDIA_BACKFILL_TARGET/);
});
