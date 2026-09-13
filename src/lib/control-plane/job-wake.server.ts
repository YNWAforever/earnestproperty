import "@tanstack/react-start/server-only";
import { waitUntil } from "@vercel/functions";
import { createJobWake, type JobLane } from "./job-wake.js";

/** Call only after the producer commit succeeds. Never wait for provider effects in a webhook. */
export function wakeAfterCommit(lane: JobLane) {
  createJobWake({
    enabled: process.env.OPS_EVENT_WAKE_ENABLED === "true",
    waitUntil,
    run: async (selected) => {
      if (selected === "service") {
        const { runServiceJobs } = await import("./service-worker.server.ts");
        const counts = await runServiceJobs();
        console.info("[job-wake] service", counts);
      } else {
        const { runClaimedJobs } = await import("./jobs.server.ts");
        const counts = await runClaimedJobs({
          workerId: `event:${crypto.randomUUID()}`,
          lane: "general",
          limit: 20,
          leaseSeconds: 300,
        });
        console.info("[job-wake] general", counts);
      }
    },
    report: (code) => console.error(`[job-wake] ${code}; durable work awaits recovery sweep`),
  })(lane);
}

export function laneForJob(jobType: string) {
  return jobType.startsWith("woztell.enquiry.") || jobType === "woztell.reply.deliver"
    ? "service"
    : "general";
}
