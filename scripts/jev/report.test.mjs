import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "./report.mjs";
const ok = (id, p) => ({
  id,
  status: "ok",
  observations: { unsupported: p },
  latencyMs: 10,
  usage: { input_tokens: 3, output_tokens: 1 },
});
test("metrics use available cases and preserve unavailable coverage", () => {
  const s = summarize(
    [ok("a", 0.5), ok("b", 0.1), { id: "c", status: "unavailable", latencyMs: 5000 }],
    { a: { unsupported: false }, b: { unsupported: true }, c: { unsupported: true } },
    0.5,
  );
  assert.equal(s.checks.unsupported.falsePositiveRate, 1);
  assert.equal(s.checks.unsupported.missedClaimRate, 1);
  assert.equal(s.unavailableRate, 1 / 3);
  assert.equal(s.usage.input_tokens, 6);
  assert.equal(s.latencyMs.mean, 10);
});
test("undefined denominators are null", () => {
  const s = summarize([ok("a", 0.1)], { a: { unsupported: false } }, 0.5);
  assert.equal(s.checks.unsupported.missedClaimRate, null);
  assert.equal(s.checks.unsupported.falsePositiveRate, 0);
  const empty = summarize(
    [{ id: "a", status: "unavailable", latencyMs: 1 }],
    { a: { unsupported: true } },
    0.5,
  );
  assert.equal(empty.unavailableRate, 1);
  assert.equal(empty.checks.unsupported.missedClaimRate, null);
  assert.equal(empty.latencyMs.mean, null);
});
test("invalid labels or thresholds cannot silently become scores", () => {
  assert.throws(() => summarize([ok("a", 0.8)], { a: { unsupported: "yes" } }, 0.5));
  assert.throws(() => summarize([], {}, 2));
});
