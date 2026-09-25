const MIN_DELAY_MS = 1_000;
const FAILURE_RETRY_MS = 60_000;

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
    try {
      nextDueAt = await drain();
      if (
        nextDueAt !== null &&
        (typeof nextDueAt !== "string" || !Number.isFinite(Date.parse(nextDueAt)))
      ) {
        throw new Error("INVALID_NEXT_DUE_AT");
      }
    } catch {
      failed = true;
      report("JOB_DRAIN_FAILED");
    }

    await storage.transaction(async () => {
      const generation = Number((await storage.get("generation")) ?? 0);
      if (generation !== startedGeneration) {
        await storage.setAlarm(now() + MIN_DELAY_MS);
      } else if (failed) {
        const failures = Number((await storage.get("failures")) ?? 0) + 1;
        await storage.put("failures", failures);
        await storage.setAlarm(
          now() + Math.min(3_600_000, FAILURE_RETRY_MS * 2 ** Math.min(failures - 1, 6)),
        );
      } else if (nextDueAt === null) {
        await storage.put("failures", 0);
        await storage.deleteAlarm();
      } else {
        await storage.put("failures", 0);
        await storage.setAlarm(Math.max(now() + MIN_DELAY_MS, Date.parse(nextDueAt)));
      }
    });
  }

  return { signal, fire };
}
