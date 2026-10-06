/**
 * True only when OPS_WAKE_URL is a non-blank string; the former wake flag is ignored.
 * Test runs (node --test sets NODE_TEST_CONTEXT, bun test sets NODE_ENV=test) never wake,
 * so no test can signal a real worker. Vercel production sets neither.
 */
export function wakeEnabledFromEnv(env) {
  if (env.NODE_TEST_CONTEXT || env.NODE_ENV === "test") return false;
  return typeof env.OPS_WAKE_URL === "string" && env.OPS_WAKE_URL.trim() !== "";
}

/** Schedule post-commit work without blocking the request. */
export function createJobWake({ enabled, waitUntil, run, report = () => {} }) {
  return (lane) => {
    if (!enabled) return;
    const work = Promise.resolve()
      .then(() => run(lane))
      .catch(() => report("JOB_WAKE_FAILED"));
    try {
      waitUntil(work);
    } catch {
      report("JOB_WAKE_REGISTRATION_FAILED");
    }
  };
}

/** Only call from the server after a job-producing commit. */
export async function signalJobWake({ url, secret, lane, fetcher = fetch, timeoutMs = 10_000 }) {
  if (!url || !secret || (lane !== "service" && lane !== "general")) {
    throw new Error("JOB_WAKE_SIGNAL_CONFIG_MISSING");
  }
  const endpoint = new URL(`/wake/${lane}`, url);
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") {
    throw new Error("JOB_WAKE_SIGNAL_URL_INVALID");
  }
  const response = await fetcher(endpoint.href, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("JOB_WAKE_SIGNAL_FAILED");
}
