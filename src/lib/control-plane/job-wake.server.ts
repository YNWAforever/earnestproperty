import "@tanstack/react-start/server-only";
import { waitUntil } from "@vercel/functions";
import { createJobWake, signalJobWake, type JobLane } from "./job-wake.js";

/** Call only after the producer commit succeeds. Never wait for provider effects in a webhook. */
export function wakeAfterCommit(lane: JobLane) {
  createJobWake({
    enabled: process.env.OPS_EVENT_WAKE_ENABLED === "true",
    waitUntil,
    run: async (selected) => {
      const schedulerUrl = process.env.OPS_WAKE_URL;
      const secret = process.env.CRON_SECRET;
      if (schedulerUrl && secret) {
        try {
          await signalJobWake({ url: schedulerUrl, secret, lane: selected });
          return;
        } catch {
          console.error("[job-wake] JOB_WAKE_SIGNAL_FAILED; running the local fallback");
        }
      } else {
        console.error("[job-wake] JOB_WAKE_SIGNAL_CONFIG_MISSING; running the local fallback");
      }
      if (selected === "service") {
        const { runServiceJobs } = await import("./service-worker.server.ts");
        const counts = await runServiceJobs();
        console.info("[job-wake] service fallback", counts);
      } else {
        const { runClaimedJobs } = await import("./jobs.server.ts");
        const counts = await runClaimedJobs({
          workerId: `event:${crypto.randomUUID()}`,
          lane: "general",
          limit: 20,
          leaseSeconds: 300,
        });
        console.info("[job-wake] general fallback", counts);
      }
    },
    report: (code) =>
      console.error(`[job-wake] ${code}; inspect the queued jobs and scheduler alarm`),
  })(lane);
}

export function laneForJob(jobType: string) {
  return jobType.startsWith("woztell.enquiry.") || jobType === "woztell.reply.deliver"
    ? "service"
    : "general";
}
