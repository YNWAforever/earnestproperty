import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runEvaluation } from "./evaluate.mjs";
import { fixtures } from "./fixtures.mjs";
const cli = (...args) =>
  spawnSync(
    process.execPath,
    [new URL("./evaluate.mjs", import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ""), ...args],
    {
      encoding: "utf8",
      env: { ...process.env, TYPESAFE_API_KEY: "test-secret", JEV_PILOT_ENABLED: "0" },
      timeout: 5000,
    },
  );
test("runner calls sequentially, excludes labels, sanitizes report", async () => {
  let active = 0;
  let calls = 0;
  const report = await runEvaluation({
    fixtures,
    mode: "mock",
    evaluateCase: async (request) => {
      assert.equal(active++, 0);
      assert.ok(!JSON.stringify(request).includes("expected"));
      calls++;
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return {
        status: "ok",
        model: "mock",
        observations: Object.fromEntries(Object.keys(request.questions).map((k) => [k, 0.2])),
        usage: { input_tokens: 0, output_tokens: 0 },
        latencyMs: 0,
        secret: "test-secret",
      };
    },
  });
  assert.equal(calls, 8);
  assert.equal(report.mode, "mock");
  assert.equal(report.liveBenchmark, "pending");
  assert.ok(!JSON.stringify(report).includes("test-secret"));
  assert.ok(!JSON.stringify(report).includes("Example Court"));
});
test("runner default ignores evaluator even if supplied", async () => {
  const report = await runEvaluation({
    fixtures,
    evaluateCase: async () => {
      throw Error("must not call");
    },
  });
  assert.equal(report.mode, "disabled");
  assert.equal(report.summary.unavailableRate, 1);
});
test("CLI disabled even with a key; mock is explicitly labeled", () => {
  const disabled = cli();
  assert.equal(disabled.status, 0);
  assert.equal(JSON.parse(disabled.stdout).mode, "disabled");
  const mock = cli("--mock");
  assert.equal(mock.status, 0);
  assert.equal(JSON.parse(mock.stdout).mode, "mock");
});
for (const args of [["--unknown"], ["--mock", "--live"], ["--mock", "--mock"], ["--live"]])
  test(`CLI refuses ${args.join(" ")}`, () => {
    const r = cli(...args);
    assert.equal(r.status, 1);
    assert.ok(!r.stderr.includes("test-secret"));
  });
test("transport exceptions become unavailable; labels are validated before any call", async () => {
  const r = await runEvaluation({
    fixtures,
    mode: "mock",
    evaluateCase: async () => {
      throw Error("secret");
    },
  });
  assert.equal(r.summary.unavailableRate, 1);
  assert.ok(!JSON.stringify(r).includes("secret"));
  let calls = 0;
  await assert.rejects(() =>
    runEvaluation({
      fixtures: [{ ...fixtures[0], expected: {} }],
      mode: "mock",
      evaluateCase: async () => {
        calls++;
      },
    }),
  );
  assert.equal(calls, 0);
});
