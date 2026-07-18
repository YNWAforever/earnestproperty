import "@tanstack/react-start/server-only";

import crypto from "node:crypto";

import { createFileRoute } from "@tanstack/react-router";

import { enqueueJob, runClaimedJobs } from "@/lib/control-plane/jobs.server";
import { queryRows } from "@/lib/neon/db.server";

export const Route = createFileRoute("/api/admin/jobs/send-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        const actual = request.headers.get("authorization");
        if (!expected || actual !== `Bearer ${expected}`) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        const campaigns = await findEligibleCampaigns();
        for (const { campaign_id: campaignId } of campaigns) {
          await enqueueJob({
            jobType: "woztell.campaign.deliver",
            payloadVersion: 1,
            payload: { campaignId },
            idempotencyKey: `woztell.campaign.deliver:${campaignId}`,
          });
        }
        const counts = await runClaimedJobs({
          workerId: `legacy-send-queue:${crypto.randomUUID()}`,
          limit: 20,
          leaseSeconds: 300,
        });
        return Response.json({ ok: true, enqueued: campaigns.length, ...counts });
      },
    },
  },
});

async function findEligibleCampaigns() {
  return queryRows<{
    campaign_id: string;
  }>(
    `SELECT DISTINCT recipient.campaign_id::text AS campaign_id
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
