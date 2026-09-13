/** Best-effort acceleration only: durable ops_jobs plus the recovery sweep own delivery. */
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
