import assert from "node:assert/strict";
import test from "node:test";
import { parseBackfillArgs } from "./backfill-remote-variants.mjs";
test("backfill defaults to dry-run and bounds batch/checkpoint inputs", () => {
  assert.deepEqual(parseBackfillArgs([]), {
    apply: false,
    limit: 20,
    checkpoint: ".cache/media-variant-backfill.json",
  });
  assert.deepEqual(parseBackfillArgs(["--apply", "--limit=50", "--checkpoint=.cache/test.json"]), {
    apply: true,
    limit: 50,
    checkpoint: ".cache/test.json",
  });
  for (const input of [
    ["--limit=0"],
    ["--limit=101"],
    ["--limit=NaN"],
    ["--checkpoint=../outside.json"],
  ])
    assert.throws(() => parseBackfillArgs(input));
});
