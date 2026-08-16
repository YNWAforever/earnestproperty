/**
 * Cron-only Worker for the Earnest Property job queue.
 *
 * Vercel Hobby allows a cron to run at most once per day, but `ops_jobs` needs
 * draining every few minutes or queued WhatsApp campaigns and AI knowledge
 * rebuilds return 202 and then sit. Cloudflare Cron Triggers are available on
 * the Workers free plan, so scheduling lives here and the app stays on Vercel.
 *
 * This Worker serves no HTTP traffic. It only implements `scheduled`.
 */

type Env = {
  SITE_ORIGIN: string;
  CRON_SECRET: string;
};

/**
 * Which endpoint each trigger drives. Keys must match the cron expressions in
 * wrangler.jsonc exactly — Cloudflare passes the expression back verbatim, so a
 * mismatch silently does nothing rather than erroring.
 */
const SCHEDULE: Record<string, string> = {
  "*/5 * * * *": "/api/admin/control-plane/worker",
  "*/10 * * * *": "/api/admin/jobs/send-queue",
};

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const path = SCHEDULE[event.cron];
    if (!path) {
      console.error(`No endpoint mapped for cron "${event.cron}" — check wrangler.jsonc`);
      return;
    }
    if (!env.CRON_SECRET) {
      console.error("CRON_SECRET is not set; every call would 401. Run `wrangler secret put`.");
      return;
    }

    // waitUntil keeps the Worker alive for the response. Without it the fetch can
    // be cancelled the moment `scheduled` returns, so a job could be claimed and
    // then abandoned mid-run.
    ctx.waitUntil(drain(new URL(path, env.SITE_ORIGIN).href, env.CRON_SECRET));
  },
};

async function drain(url: string, secret: string) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });

    // Log the body on failure: a 401 means the secret drifted from Vercel's, which
    // is otherwise invisible because the queue just quietly stops draining.
    if (!response.ok) {
      console.error(`${url} -> ${response.status}: ${await response.text()}`);
      return;
    }
    console.log(`${url} -> ${response.status} ${await response.text()}`);
  } catch (error) {
    console.error(`${url} failed:`, error instanceof Error ? error.message : error);
  }
}
