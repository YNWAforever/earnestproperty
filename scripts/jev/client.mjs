import { performance } from "node:perf_hooks";
// Node-only evaluation adapter. No application/browser imports.
export async function evaluate(
  request,
  { mode = "disabled", apiKey, fetchImpl = fetch, timeoutMs = 5000 } = {},
) {
  const started = performance.now();
  const unavailable = (reason) => ({
    status: "unavailable",
    reason,
    latencyMs: performance.now() - started,
  });
  if (mode !== "live") return unavailable("disabled");
  if (typeof apiKey !== "string" || !apiKey.trim()) return unavailable("missing_key");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    throw Error("invalid_timeout");
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(unavailable("timeout"));
    }, timeoutMs);
  });
  const operation = async () => {
    let response;
    try {
      response = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch {
      return unavailable(controller.signal.aborted ? "timeout" : "network_error");
    }
    if (!response.ok)
      return unavailable(
        [401, 403].includes(response.status)
          ? "unauthorized"
          : response.status === 429
            ? "rate_limited"
            : "provider_error",
      );
    try {
      const body = await response.json();
      if (!body || typeof body.model !== "string" || !/^[a-zA-Z0-9._/-]{1,100}$/.test(body.model))
        throw Error();
      const usage = body.usage;
      if (
        !usage ||
        ![usage.input_tokens, usage.output_tokens].every((n) => Number.isSafeInteger(n) && n >= 0)
      )
        throw Error();
      const observations = {};
      for (const key of Object.keys(request.questions)) {
        const answer = body.answers?.[key];
        if (
          answer?.type !== "noul" ||
          typeof answer.noul !== "number" ||
          !Number.isFinite(answer.noul) ||
          answer.noul < 0 ||
          answer.noul > 1
        )
          throw Error();
        observations[key] = answer.noul;
      }
      return {
        status: "ok",
        model: body.model,
        observations,
        usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens },
        latencyMs: performance.now() - started,
      };
    } catch {
      return unavailable(controller.signal.aborted ? "timeout" : "invalid_response");
    }
  };
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
