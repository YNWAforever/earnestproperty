import { DurableObject } from "cloudflare:workers";
import { LANE_ENDPOINTS, createJobAlarm, createLaneDrain, sweepLanes } from "./job-alarm.js";

type Env = {
  SITE_ORIGIN: string;
  CRON_SECRET: string;
  JOB_WAKE: DurableObjectNamespace<JobWakeAlarm>;
};

/** Each lane stores just one alarm; an empty lane has no alarm or Neon call. */
export class JobWakeAlarm extends DurableObject<Env> {
  async signal() {
    await this.controller().signal();
  }

  async sweep() {
    await this.controller().sweep();
  }

  async alarm() {
    await this.controller().fire();
  }

  private controller() {
    const lane = this.ctx.id.name;
    if (lane !== "service" && lane !== "general") throw new Error("JOB_ALARM_LANE_INVALID");
    return createJobAlarm({
      storage: this.ctx.storage,
      drain: createLaneDrain({
        origin: this.env.SITE_ORIGIN,
        path: LANE_ENDPOINTS[lane],
        secret: this.env.CRON_SECRET,
      }),
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

  // Both cron strings ("*/10 0-13 * * *" and "0 14-23 * * *", UTC) run the same sweep.
  // The cron never calls signal(), so an outage keeps its failure count and backoff.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      sweepLanes(
        (lane) => env.JOB_WAKE.getByName(lane),
        (code) => console.error(`[job-alarm] ${code}`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
