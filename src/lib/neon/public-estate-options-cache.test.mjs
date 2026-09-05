import assert from "node:assert/strict";
import test from "node:test";
import { createEstateOptionsCache } from "./public-estate-options-cache.ts";
test("estate options coalesce reads and refresh after publish invalidation", async () => {
  let reads = 0;
  const cache = createEstateOptionsCache(60000);
  const load = async () => [{ slug: String(++reads), name_zh: "Synthetic" }];
  const [a, b] = await Promise.all([cache.get(load), cache.get(load)]);
  assert.deepEqual(a, b);
  assert.equal(reads, 1);
  cache.invalidate();
  assert.notDeepEqual(await cache.get(load), a);
  assert.equal(reads, 2);
});
test("invalidating an in-flight read prevents stale cache refill", async () => {
  const cache = createEstateOptionsCache(60000);
  let resolve;
  const old = cache.get(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  cache.invalidate();
  const fresh = await cache.get(async () => [{ slug: "fresh", name_zh: "Fresh" }]);
  resolve([{ slug: "old", name_zh: "Old" }]);
  await old;
  assert.deepEqual(
    await cache.get(async () => {
      throw Error("must use fresh cache");
    }),
    fresh,
  );
});
