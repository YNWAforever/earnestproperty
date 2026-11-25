import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { withOwnedPostgres } from "../../../../scripts/acceptance/owned-postgres-test.mjs";
import { handleLeadStaffAlert } from "../../whatsapp-enquiries/lead-alert.server.ts";

/**
 * Owned PostgreSQL proof that the ordinary lead-alert worker never dispatches to
 * a recipient a reviewed historical resend already reached (accepted/unknown),
 * including a delayed original job, on both the primary member route and the
 * phone route. A plain accepted attempt without a historical decision is the
 * control: the immutable decision row is what marks the recipient as covered.
 *
 * Run: node --test src/lib/neon/historical-resend-dispatch/historical-resend-ordinary-block.owned.db.test.mjs
 */

const TEMPLATE = JSON.stringify({
  name: "staff_enquiry_followup",
  language: "zh_HK",
  params: ["name", "source", "phone", "link"],
});
const CHANNEL = "owned-historical";
const env = {
  EP_WA_ENQUIRY_MODE: undefined,
  EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
  EP_WA_STAFF_ALERT_TEMPLATE: TEMPLATE,
  VITE_SITE_URL: "https://earnest.example.invalid",
  EP_WA_COMPANY_CHANNEL_ID: CHANNEL,
  WOZTELL_CHANNEL_ID: CHANNEL,
  EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: "verification",
  EP_WA_STAFF_CORRELATION_VERIFICATION_REF: "verification",
  EP_WA_STAFF_ASSOCIATION_REVIEW_REF: "verification",
  EP_WA_STAFF_REPLY_CONTEXT_PATH: "context.replyTo",
};
function applyEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function fakeTransport() {
  const calls = [];
  const send = async (input) => {
    calls.push(input);
    return {
      state: "accepted",
      evidenceKind: "provider_accepted",
      providerOperationId: `op-${randomUUID()}`,
    };
  };
  return {
    calls,
    transport: () => ({
      verificationRef: "verification",
      sendStaffWhatsApp: send,
      sendStaffWhatsAppByPhone: send,
    }),
  };
}

test(
  "ordinary worker never reaches a historically covered recipient",
  { timeout: 900000 },
  async () => {
    const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    applyEnv(env);
    try {
      await withOwnedPostgres(async ({ query, transaction }) => {
        async function seedManager() {
          const staffId = randomUUID();
          await query(
            "INSERT INTO staff_users(id,auth_user_id,name_zh,active) VALUES($1,$2,'測試主管',true)",
            [staffId, `historical-${staffId}`],
          );
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [
            staffId,
          ]);
          await query(
            "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verification_ref,verified_at) VALUES($1,$2,$3,'folder','node',true,'verification',now())",
            [staffId, CHANNEL, `inbox-${staffId}`],
          );
          return staffId;
        }
        async function seedEndpoint(staffId, transport, destination) {
          const quiet = '{"approved":true,"allowAllHours":true}';
          const [row] = await query(
            `INSERT INTO staff_notification_endpoints(staff_id,transport,channel_id,destination_reference,verification_ref,verified_at,enabled,permission_granted,permission_ref,quiet_hours_policy)
           VALUES($1,$2,$3,$4,'verification','2026-11-20T00:00:00+08:00',true,true,'verification',$5::jsonb) RETURNING id,version`,
            [staffId, transport, CHANNEL, destination, quiet],
          );
          return { ...row, destination };
        }
        async function seedLead({ assigned, route = null }) {
          const [contact] = await query(
            "INSERT INTO crm_contacts(name,phone,normalized_phone) VALUES('測試客戶','85261112222',$1) RETURNING id",
            [`cust-${randomUUID()}`],
          );
          const [lead] = await query(
            `INSERT INTO crm_leads(contact_id,assigned_agent_id,source,created_at,enquiry_routing_context)
           VALUES($1,$2,'website','2026-11-22T10:00:00+08:00',$3::jsonb) RETURNING id`,
            [contact.id, assigned, JSON.stringify(route ?? {})],
          );
          return lead.id;
        }
        async function seedJob(leadId, status, leaseOwner = null) {
          const [job] = await query(
            `INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,attempt_count,run_after,idempotency_key,lease_owner,lease_expires_at)
           VALUES('lead.staff.alert',1,jsonb_build_object('leadId',$1::text),$2,3,1,now(),'lead-alert:'||$1||':'||$4,$3,$5::timestamptz) RETURNING id`,
            [
              leadId,
              status,
              leaseOwner,
              randomUUID(),
              leaseOwner ? new Date(Date.now() + 300_000).toISOString() : null,
            ],
          );
          return job.id;
        }
        async function seedHistorical(leadId, endpoint, staffId, { decision = true } = {}) {
          const [attempt] = await query(
            `INSERT INTO staff_notification_attempts(lead_id,transport,endpoint_id,endpoint_version,destination_reference_snapshot,channel_id_snapshot,attempt_key,dispatch_state,provider_accepted_at,finished_at)
           VALUES($1::uuid,'staff_whatsapp',$2,$3,$4,$5,'historical-resend:'||$1::text||':'||$6::text,'accepted',now(),now()) RETURNING id`,
            [leadId, endpoint.id, endpoint.version, endpoint.destination, CHANNEL, staffId],
          );
          if (decision)
            await query(
              `INSERT INTO historical_resend_decisions(lead_id,actor_staff_id,channel_id,staff_id,transport,endpoint_id,endpoint_version,attempt_id,fingerprint,decision)
             VALUES($1::uuid,$2::uuid,$3,$2::uuid,'website_lead_phone',$4::uuid,$5,$6::uuid,repeat('a',64),'approved_dispatch')`,
              [leadId, staffId, CHANNEL, endpoint.id, endpoint.version, attempt.id],
            );
          return attempt.id;
        }
        const nonHistoricalAttempts = (leadId) =>
          query(
            "SELECT dispatch_state FROM staff_notification_attempts WHERE lead_id=$1::uuid AND attempt_key NOT LIKE 'historical-resend:%'",
            [leadId],
          );
        const run = (leadId, jobId, transport, workerId = "worker-1") =>
          handleLeadStaffAlert(
            { leadId },
            { jobId, workerId, checkpoint: async () => {} },
            { query, transaction, transport: transport.transport },
          );

        // 1) Primary member route: an accepted historical decision blocks the claim.
        {
          const staffId = await seedManager();
          const endpoint = await seedEndpoint(staffId, "staff_whatsapp", `member-${staffId}`);
          const leadId = await seedLead({ assigned: staffId });
          await seedHistorical(leadId, endpoint, staffId);
          const transport = fakeTransport();
          const jobId = await seedJob(leadId, "running", "worker-1");
          const result = await run(leadId, jobId, transport);
          assert.equal(transport.calls.length, 0, "no provider call for a historical recipient");
          assert.equal(result.summary.accepted, 0);
          const rows = await nonHistoricalAttempts(leadId);
          assert.ok(rows.length >= 1, "the covered recipient leaves a visible record");
          assert.ok(
            rows.every((row) => row.dispatch_state === "suppressed"),
            "no queued regular attempt is created for a historical recipient",
          );
        }

        // 2) Delayed original job: leasing the queued original alert later still blocks.
        {
          const staffId = await seedManager();
          const endpoint = await seedEndpoint(staffId, "staff_whatsapp", `member-${staffId}`);
          const leadId = await seedLead({ assigned: staffId });
          await seedHistorical(leadId, endpoint, staffId);
          const queuedJobId = await seedJob(leadId, "queued");
          const transport = fakeTransport();
          await run(leadId, queuedJobId, transport, "late-worker");
          assert.equal(transport.calls.length, 0, "a delayed original job may not send either");
          const rows = await nonHistoricalAttempts(leadId);
          assert.ok(rows.length >= 1);
          assert.ok(rows.every((row) => row.dispatch_state === "suppressed"));
        }

        // 3) Phone route: the historical decision removes the phone recipient.
        {
          const staffId = await seedManager();
          const endpoint = await seedEndpoint(staffId, "website_lead_phone", "85291234567");
          const leadId = await seedLead({
            assigned: staffId,
            route: { notificationRoute: "staff_phone", scope: "unit" },
          });
          await seedHistorical(leadId, endpoint, staffId);
          const transport = fakeTransport();
          const jobId = await seedJob(leadId, "running", "worker-1");
          await run(leadId, jobId, transport);
          assert.equal(
            transport.calls.length,
            0,
            "phone route must not send to a historical recipient",
          );
          const rows = await nonHistoricalAttempts(leadId);
          assert.ok(rows.length >= 1, "the phone recipient is recorded, not silently skipped");
          assert.ok(
            rows.every((row) => row.dispatch_state === "suppressed"),
            "the phone recipient is suppressed, never queued",
          );
        }

        // 4) Control: an accepted attempt with no historical decision is not a resend,
        // so the ordinary lane still sends (the immutable decision is the marker).
        {
          const staffId = await seedManager();
          const endpoint = await seedEndpoint(staffId, "staff_whatsapp", `member-${staffId}`);
          const leadId = await seedLead({ assigned: staffId });
          await seedHistorical(leadId, endpoint, staffId, { decision: false });
          const transport = fakeTransport();
          const jobId = await seedJob(leadId, "running", "worker-1");
          await run(leadId, jobId, transport);
          assert.equal(
            transport.calls.length,
            1,
            "without a historical decision the ordinary alert sends",
          );
        }
      });
    } finally {
      applyEnv(saved);
    }
  },
);
