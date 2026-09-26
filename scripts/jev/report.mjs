export function summarize(results, labels, threshold = 0.5) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw Error("invalid_threshold");
  const checks = {};
  for (const expected of Object.values(labels))
    for (const [key, value] of Object.entries(expected)) {
      if (typeof value !== "boolean") throw Error("invalid_labels");
      checks[key] ??= { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
    }
  const available = results.filter((r) => r.status === "ok");
  for (const r of available)
    for (const [key, expected] of Object.entries(labels[r.id] ?? {})) {
      const p = r.observations[key];
      if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1)
        throw Error("invalid_observation");
      const predicted = p >= threshold;
      checks[key][
        expected
          ? predicted
            ? "truePositive"
            : "falseNegative"
          : predicted
            ? "falsePositive"
            : "trueNegative"
      ]++;
    }
  const ratio = (n, d) => (d ? n / d : null);
  for (const counts of Object.values(checks)) {
    counts.falsePositiveRate = ratio(
      counts.falsePositive,
      counts.falsePositive + counts.trueNegative,
    );
    counts.missedClaimRate = ratio(
      counts.falseNegative,
      counts.falseNegative + counts.truePositive,
    );
  }
  const times = available.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    total: results.length,
    available: available.length,
    unavailable: results.length - available.length,
    unavailableRate: ratio(results.length - available.length, results.length),
    threshold,
    checks,
    latencyMs: {
      mean: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      p95: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
    },
    usage: available.reduce(
      (sum, r) => ({
        input_tokens: sum.input_tokens + r.usage.input_tokens,
        output_tokens: sum.output_tokens + r.usage.output_tokens,
      }),
      { input_tokens: 0, output_tokens: 0 },
    ),
  };
}
