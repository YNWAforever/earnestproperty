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
