import { DurableObject } from "cloudflare:workers";
import { createJobAlarm } from "./job-alarm.js";

type Env = {
  SITE_ORIGIN: string;
  CRON_SECRET: string;
  JOB_WAKE: DurableObjectNamespace<JobWakeAlarm>;
};

type JobLane = "service" | "general";
const ENDPOINT: Record<JobLane, string> = {
  service: "/api/admin/whatsapp/service-worker",
  general: "/api/admin/control-plane/worker",
};

/** Each lane stores just one alarm; an empty lane has no alarm or Neon call. */
export class JobWakeAlarm extends DurableObject<Env> {
  async signal() {
    await this.controller().signal();
  }

  async alarm() {
    await this.controller().fire();
  }

  private controller() {
    const lane = this.ctx.id.name;
    if (lane !== "service" && lane !== "general") throw new Error("JOB_ALARM_LANE_INVALID");
    return createJobAlarm({
      storage: this.ctx.storage,
      drain: async () => {
        const response = await fetch(new URL(ENDPOINT[lane], this.env.SITE_ORIGIN), {
          method: "POST",
          headers: { authorization: `Bearer ${this.env.CRON_SECRET}` },
        });
        if (!response.ok) throw new Error(`JOB_DRAIN_HTTP_${response.status}`);
        const result = (await response.json()) as { nextDueAt?: unknown };
        if (!("nextDueAt" in result)) throw new Error("JOB_DRAIN_NEXT_DUE_MISSING");
        return result.nextDueAt as string | null;
      },
      report: (code) => console.error(`[job-alarm] ${lane}: ${code}`),
    });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const lane =
      url.pathname === "/wake/service"
        ? "service"
        : url.pathname === "/wake/general"
          ? "general"
          : null;
    if (request.method !== "POST" || !lane) return new Response(null, { status: 404 });
    if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    await env.JOB_WAKE.getByName(lane).signal();
    return Response.json({ scheduled: true }, { status: 202 });
  },
} satisfies ExportedHandler<Env>;
