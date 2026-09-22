import { pathToFileURL } from "node:url";
import { buildRequest, CHECK_VERSION } from "./contracts.mjs";
import { evaluate } from "./client.mjs";
import { fixtures as bundledFixtures } from "./fixtures.mjs";
import { summarize } from "./report.mjs";

export async function runEvaluation({
  fixtures = bundledFixtures,
  evaluateCase,
  mode = "disabled",
  model = "jev-latest",
} = {}) {
  if (!["disabled", "mock", "live"].includes(mode)) throw Error("invalid_mode");
  if (
    !Array.isArray(fixtures) ||
    fixtures.length > bundledFixtures.length ||
    new Set(fixtures.map((f) => f.id)).size !== fixtures.length
  )
    throw Error("invalid_fixtures");
  // Validate all inputs and labels before the first possible paid call.
  const prepared = fixtures.map((f) => {
    const request = buildRequest(f, model);
    const keys = Object.keys(request.questions);
    if (
      !f.expected ||
      Object.keys(f.expected).length !== keys.length ||
      keys.some((k) => typeof f.expected[k] !== "boolean")
    )
      throw Error("invalid_labels");
    return { f, request };
  });
  const results = [];
  for (const { f, request } of prepared) {
    let result = { status: "unavailable", reason: "disabled", latencyMs: 0 };
    if (mode !== "disabled") {
      try {
        result = await evaluateCase(request);
      } catch {
        result = { status: "unavailable", reason: "network_error", latencyMs: 0 };
      }
    }
    const row = { id: f.id, language: f.language, checkVersion: CHECK_VERSION };
    // Explicit report projection: no payload text, exceptions or adapter extras.
    const valid =
      result?.status === "ok" &&
      typeof result.model === "string" &&
      /^[a-zA-Z0-9._/-]{1,100}$/.test(result.model) &&
      Number.isFinite(result.latencyMs) &&
      result.latencyMs >= 0 &&
      [result.usage?.input_tokens, result.usage?.output_tokens].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) &&
      Object.keys(request.questions).every(
        (k) =>
          typeof result.observations?.[k] === "number" &&
          Number.isFinite(result.observations[k]) &&
          result.observations[k] >= 0 &&
          result.observations[k] <= 1,
      );
    if (valid)
      Object.assign(row, {
        status: "ok",
        model: result.model,
        observations: Object.fromEntries(
          Object.keys(request.questions).map((k) => [k, result.observations[k]]),
        ),
        usage: {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
        },
        latencyMs: result.latencyMs,
      });
    else {
      const reasons = [
        "disabled",
        "missing_key",
        "timeout",
        "unauthorized",
        "rate_limited",
        "provider_error",
        "invalid_response",
        "network_error",
      ];
      Object.assign(row, {
        status: "unavailable",
        reason: reasons.includes(result?.reason) ? result.reason : "invalid_response",
        latencyMs:
          Number.isFinite(result?.latencyMs) && result.latencyMs >= 0 ? result.latencyMs : 0,
      });
    }
    results.push(row);
  }
  return {
    mode,
    requestedModel: model,
    checkVersion: CHECK_VERSION,
    interpretation:
      mode === "mock"
        ? "MOCK ONLY: canned observations exercise reporting; not Jev accuracy."
        : "Synthetic developer-labeled fixtures; not an independent held-out benchmark.",
    liveBenchmark: mode === "live" ? "synthetic-only; independent evaluation pending" : "pending",
    costComparison: "pending",
    results,
    summary: summarize(results, Object.fromEntries(fixtures.map((f) => [f.id, f.expected])), 0.5),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((a) => !["--mock", "--live"].includes(a)))
    throw Error("invalid_arguments");
  const mode = args[0] === "--mock" ? "mock" : args[0] === "--live" ? "live" : "disabled";
  if (mode === "live" && process.env.JEV_PILOT_ENABLED !== "1") throw Error("live_not_enabled");
  const report = await runEvaluation({
    mode,
    model: process.env.JEV_MODEL || "jev-latest",
    evaluateCase:
      mode === "mock"
        ? async (request) => ({
            status: "ok",
            model: "mock-canned-v1",
            observations: Object.fromEntries(
              Object.keys(request.questions).map((k) => [
                k,
                k.startsWith("relevance_") ? 0.8 : 0.2,
              ]),
            ),
            usage: { input_tokens: 0, output_tokens: 0 },
            latencyMs: 0,
          })
        : (request) => evaluate(request, { mode, apiKey: process.env.TYPESAFE_API_KEY }),
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (mode === "live" && report.summary.unavailable > 0) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const codes = [
      "invalid_arguments",
      "live_not_enabled",
      "invalid_fixture",
      "invalid_fixtures",
      "invalid_labels",
      "invalid_mode",
    ];
    process.stderr.write(
      (codes.includes(error?.message) ? error.message : "evaluation_failed") + "\n",
    );
    process.exitCode = 1;
  });
}
