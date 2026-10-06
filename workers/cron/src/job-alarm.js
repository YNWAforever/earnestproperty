const MIN_DELAY_MS = 1_000;
const FAILURE_RETRY_MS = 60_000;
const MAX_FAILURES = 7;
const DRAIN_CODE = /^JOB_DRAIN_[A-Z0-9_]+$/;
// Plain http is accepted only for a local app (`wrangler dev`); `URL.hostname` keeps IPv6 brackets.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const JOB_LANES = Object.freeze(["service", "general"]);

export const LANE_ENDPOINTS = Object.freeze({
  service: "/api/admin/whatsapp/service-worker",
  general: "/api/admin/control-plane/worker",
});

/** One persistent alarm per lane; no timer exists once its queue is empty. */
export function createJobAlarm({ storage, drain, now = Date.now, report = () => {} }) {
  async function signal() {
    await storage.transaction(async () => {
      const generation = Number((await storage.get("generation")) ?? 0) + 1;
      await storage.put("generation", generation);
      await storage.put("failures", 0);
      const existing = await storage.getAlarm();
      const soon = now() + MIN_DELAY_MS;
      if (existing === null || existing > soon) await storage.setAlarm(soon);
    });
  }

  async function fire() {
    const startedGeneration = Number((await storage.get("generation")) ?? 0);
    let nextDueAt = null;
    let failed = false;
    let retriesExhausted = false;
    try {
      nextDueAt = await drain();
      if (
        nextDueAt !== null &&
        (typeof nextDueAt !== "string" || !Number.isFinite(Date.parse(nextDueAt)))
      ) {
        throw new Error("INVALID_NEXT_DUE_AT");
      }
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : "";
      report(DRAIN_CODE.test(message) ? `JOB_DRAIN_FAILED:${message}` : "JOB_DRAIN_FAILED");
    }

    await storage.transaction(async () => {
      const generation = Number((await storage.get("generation")) ?? 0);
      if (generation !== startedGeneration) {
        await storage.setAlarm(now() + MIN_DELAY_MS);
      } else if (failed) {
        const failures = Number((await storage.get("failures")) ?? 0) + 1;
        await storage.put("failures", failures);
        if (failures >= MAX_FAILURES) {
          await storage.deleteAlarm();
          retriesExhausted = true;
        } else {
          await storage.setAlarm(
            now() + Math.min(3_600_000, FAILURE_RETRY_MS * 2 ** Math.min(failures - 1, 6)),
          );
        }
      } else if (nextDueAt === null) {
        await storage.put("failures", 0);
        await storage.deleteAlarm();
      } else {
        await storage.put("failures", 0);
        await storage.setAlarm(Math.max(now() + MIN_DELAY_MS, Date.parse(nextDueAt)));
      }
    });
    if (retriesExhausted) report("JOB_DRAIN_RETRY_EXHAUSTED");
  }

  /**
   * Scheduled safety net. Arms an idle or exhausted lane and pulls a healthy lane's far alarm
   * forward, but keeps an active failure backoff and never touches `failures` or `generation`
   * (unlike `signal()`), so an outage costs at most one drain call per tick.
   */
  async function sweep() {
    await storage.transaction(async () => {
      const existing = await storage.getAlarm();
      const soon = now() + MIN_DELAY_MS;
      if (existing === null || existing === undefined) {
        await storage.setAlarm(soon);
        return;
      }
      const failures = Number((await storage.get("failures")) ?? 0);
      if (failures === 0 && existing > soon) await storage.setAlarm(soon);
    });
  }

  return { signal, fire, sweep };
}

function drainBase(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const allowed =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  if (!allowed || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return null;
  }
  return url;
}

/** One authenticated drain call. Redirects are refused so the bearer is never replayed. */
export function createLaneDrain({ origin, path, secret, fetcher = (...args) => fetch(...args) }) {
  return async () => {
    const base = drainBase(origin);
    if (!base) throw new Error("JOB_DRAIN_ORIGIN_INVALID");
    const response = await fetcher(new URL(path, base), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      redirect: "manual",
    });
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new Error("JOB_DRAIN_REDIRECTED");
    }
    if (!response.ok) throw new Error(`JOB_DRAIN_HTTP_${response.status}`);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("JOB_DRAIN_RESPONSE_INVALID");
    }
    if (!result || typeof result !== "object" || !("nextDueAt" in result)) {
      throw new Error("JOB_DRAIN_NEXT_DUE_MISSING");
    }
    return result.nextDueAt;
  };
}

/** Sweeps every lane independently; a failing lane is reported and never blocks the other. */
export async function sweepLanes(getLane, report = () => {}) {
  const results = await Promise.allSettled(
    JOB_LANES.map(async (lane) => {
      await getLane(lane).sweep();
    }),
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") report(`JOB_SWEEP_FAILED:${JOB_LANES[index]}`);
  });
}
