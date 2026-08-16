import "@tanstack/react-start/server-only";

import crypto from "node:crypto";

import { createFileRoute } from "@tanstack/react-router";

import { campaignDeliveryIdempotencyKey } from "@/lib/control-plane/jobs";
import { enqueueJob, runClaimedJobs } from "@/lib/control-plane/jobs.server";
import { queryRows } from "@/lib/neon/db.server";

async function drainSendQueue({ request }: { request: Request }) {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get("authorization");
  if (!expected || actual !== `Bearer ${expected}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const campaigns = await findEligibleCampaigns();
  for (const { campaign_id: campaignId, queue_run_at: queueRunAt } of campaigns) {
    await enqueueJob({
      jobType: "woztell.campaign.deliver",
      payloadVersion: 1,
      payload: { campaignId },
      idempotencyKey: campaignDeliveryIdempotencyKey(campaignId, queueRunAt),
    });
  }
  const counts = await runClaimedJobs({
    workerId: `legacy-send-queue:${crypto.randomUUID()}`,
    limit: 20,
    leaseSeconds: 300,
  });
  return Response.json({ ok: true, enqueued: campaigns.length, ...counts });
}

export const Route = createFileRoute("/api/admin/jobs/send-queue")({
  server: {
    handlers: {
      // GET as well as POST: Vercel Cron issues GET and this path is scheduled
      // in vercel.ts, so with POST only the daily backstop never ran. The
      // Bearer CRON_SECRET check covers both verbs.
      GET: drainSendQueue,
      POST: drainSendQueue,
    },
  },
});

async function findEligibleCampaigns() {
  return queryRows<{
    campaign_id: string;
    queue_run_at: string;
  }>(
    // reviewed_at identifies the campaign's current queue run and is what the
    // delivery job's idempotency key is scoped to. It must come from the same
    // row the admin route reads, or the two paths would derive different keys
    // for one run and enqueue the same delivery twice.
    //
    // The fallback is created_at, NOT updated_at: saveAdminCampaign writes
    // status unconditionally, so a campaign can reach 'queued' without ever
    // going through queueAdminCampaign and therefore with reviewed_at still
    // NULL. updated_at changes on every subsequent write, which would hand this
    // cron a new idempotency key -- and so a new delivery job -- after any edit.
    // created_at is immutable, so that campaign still enqueues exactly once.
    `SELECT DISTINCT recipient.campaign_id::text AS campaign_id,
            COALESCE(campaign.reviewed_at, campaign.created_at)::text AS queue_run_at
     FROM whatsapp_campaign_recipients recipient
     INNER JOIN whatsapp_campaigns campaign ON campaign.id = recipient.campaign_id
     WHERE campaign.status IN ('queued', 'sending')
       AND (
         recipient.status = 'queued'
         OR (
           recipient.status = 'sending'
           AND COALESCE(recipient.queued_at, 'epoch'::timestamptz)
             < now() - interval '15 minutes'
         )
       )
     ORDER BY campaign_id
     LIMIT 100`,
  );
}
