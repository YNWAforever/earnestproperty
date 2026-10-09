import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test(
  "campaign recovery preserves one original queue job and existing dispatch boundaries",
  { timeout: 240000 },
  async (t) => {
    const network = t.mock.method(globalThis, "fetch", () => {
      throw Error("Provider/network request forbidden in owned cancellation acceptance");
    });
    await withOwnedPostgres(async ({ query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      // FX-10b Task 2: the only provider boundary. Registered before the first
      // import of admin-data.server.ts, which imports woztell.server.ts, which
      // imports provider-fetch.ts. No WhatsApp message can leave this process.
      const providerCalls = []; // { memberId, outcome }
      // FX-10b Task 3: every provider call in this file, never reset. Checked at
      // the end: no member may have more than one accepted send.
      const allProviderCalls = []; // { memberId, accepted }
      let provider = () => ({
        status: 200,
        body: { ok: 1, messageId: `wamid.synthetic-fx10b-${providerCalls.length}` },
      });
      mock.module(new URL("../woztell/provider-fetch.ts", import.meta.url).href, {
        exports: {
          boundedProviderFetch: async (_url, init) => {
            const { memberId } = JSON.parse(init.body);
            const out = await provider(memberId);
            allProviderCalls.push({
              memberId,
              accepted:
                !(out instanceof Error) &&
                out.status >= 200 &&
                out.status < 300 &&
                out.body?.ok === 1,
            });
            providerCalls.push({ memberId, outcome: out instanceof Error ? "thrown" : out.status });
            if (out instanceof Error) throw out;
            return {
              response: new Response(null, { status: out.status }),
              text: "raw" in out ? out.raw : JSON.stringify(out.body),
            };
          },
        },
      });
      const previousEnv = {
        WOZTELL_ENABLED: process.env.WOZTELL_ENABLED,
        WOZTELL_BOT_ACCESS_TOKEN: process.env.WOZTELL_BOT_ACCESS_TOKEN,
        WOZTELL_CHANNEL_ID: process.env.WOZTELL_CHANNEL_ID,
      };
      const syntheticEnv = () => {
        process.env.WOZTELL_ENABLED = "true";
        process.env.WOZTELL_BOT_ACCESS_TOKEN = "owned-synthetic-token";
        process.env.WOZTELL_CHANNEL_ID = "owned-synthetic-channel";
      };
      syntheticEnv();
      t.after(() => {
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      });
      const wakes = [];
      mock.module(new URL("../control-plane/job-wake.server.ts", import.meta.url).href, {
        exports: { wakeAfterCommit: (lane) => wakes.push(lane), laneForJob: () => "general" },
      });
      const { queueAdminCampaign, cancelAdminCampaign } = await import("./admin-data.server.ts");
      const [staff] = await query(
        "INSERT INTO staff_users(auth_user_id,email) VALUES('owned-campaign-manager','owned-manager@example.invalid') RETURNING id",
      );
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [staff.id]);
      const actor = { staffId: staff.id, authUserId: "owned-campaign-manager", roles: ["manager"] };
      const [template] = await query(
        "INSERT INTO whatsapp_templates(element_name,status) VALUES('owned_campaign','active') RETURNING id",
      );
      const [audience] = await query(
        "INSERT INTO whatsapp_audiences(name,created_by) VALUES('Owned test audience',$1) RETURNING id",
        [staff.id],
      );
      let sequence = 0;
      async function seed() {
        const phone = "8526111222" + sequence++;
        const [contact] = await query(
          "INSERT INTO crm_contacts(name,phone,normalized_phone,opt_in_whatsapp,opted_out_whatsapp) VALUES('Owned synthetic recipient',$1,$1,true,false) RETURNING id",
          [phone],
        );
        const [campaign] = await query(
          "INSERT INTO whatsapp_campaigns(name,template_id,audience_id,status,created_by) VALUES('Owned synthetic campaign',$1,$2,'review',$3) RETURNING id",
          [template.id, audience.id, staff.id],
        );
        const [recipient] = await query(
          "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2) RETURNING id",
          [campaign.id, contact.id],
        );
        return { campaign: campaign.id, contact: contact.id, recipient: recipient.id };
      }
      await t.test(
        "concurrent and repeated queue creates one job, one audit and one status flip",
        async () => {
          const current = await seed();
          const attempts = await Promise.all([
            queueAdminCampaign(current.campaign, actor),
            queueAdminCampaign(current.campaign, actor),
          ]);
          assert.equal(attempts.filter((a) => a.ok).length, 1);
          const saved = attempts.find((a) => a.ok);
          assert.equal((await queueAdminCampaign(current.campaign, actor)).ok, false);
          const jobs = await query("SELECT * FROM ops_jobs WHERE payload->>'campaignId'=$1", [
            current.campaign,
          ]);
          assert.equal(jobs.length, 1);
          assert.equal(jobs[0].id, saved.jobId);
          assert.equal(jobs[0].status, "queued");
          assert.deepEqual(jobs[0].payload, { campaignId: current.campaign });
          assert.equal(
            (
              await query(
                "SELECT id FROM audit_logs WHERE action='campaign.queue' AND subject_id=$1",
                [current.campaign],
              )
            ).length,
            1,
          );
          assert.equal(
            (
              await query("SELECT status FROM whatsapp_campaigns WHERE id=$1", [current.campaign])
            )[0].status,
            "queued",
          );
          assert.ok(
            (
              await query("SELECT queued_at FROM whatsapp_campaign_recipients WHERE id=$1", [
                current.recipient,
              ])
            )[0].queued_at,
          );
          assert.equal(wakes.length, 1);
        },
      );
      await t.test(
        "consent changed after review blocks queue and creates no job or queue audit",
        async () => {
          const current = await seed();
          await query("UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1", [
            current.contact,
          ]);
          assert.equal((await queueAdminCampaign(current.campaign, actor)).ok, false);
          assert.equal(
            (
              await query("SELECT id FROM ops_jobs WHERE payload->>'campaignId'=$1", [
                current.campaign,
              ])
            ).length,
            0,
          );
          assert.equal(
            (
              await query(
                "SELECT id FROM audit_logs WHERE action='campaign.queue' AND subject_id=$1",
                [current.campaign],
              )
            ).length,
            0,
          );
          assert.equal(
            (
              await query("SELECT status FROM whatsapp_campaigns WHERE id=$1", [current.campaign])
            )[0].status,
            "review",
          );
        },
      );
      await t.test(
        "cancel preserves dispatched history and only cancels undispatched recipients",
        async () => {
          const current = await seed();
          assert.equal((await queueAdminCampaign(current.campaign, actor)).ok, true);
          await query(
            "UPDATE whatsapp_campaign_recipients SET status='sent',dispatch_started_at=now(),sent_at=now(),external_message_id='owned-accepted-history' WHERE id=$1",
            [current.recipient],
          );
          const [otherContact] = await query(
            "INSERT INTO crm_contacts(name) VALUES('Owned pending recipient') RETURNING id",
          );
          const [otherRecipient] = await query(
            "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2) RETURNING id",
            [current.campaign, otherContact.id],
          );
          const [originalJob] = await query(
            "SELECT id,idempotency_key,payload FROM ops_jobs WHERE payload->>'campaignId'=$1",
            [current.campaign],
          );
          assert.equal((await cancelAdminCampaign(current.campaign, actor)).ok, true);
          const [accepted] = await query(
            "SELECT status,external_message_id,dispatch_started_at FROM whatsapp_campaign_recipients WHERE id=$1",
            [current.recipient],
          );
          assert.equal(accepted.status, "sent");
          assert.equal(accepted.external_message_id, "owned-accepted-history");
          assert.ok(accepted.dispatch_started_at);
          assert.equal(
            (
              await query("SELECT status FROM whatsapp_campaign_recipients WHERE id=$1", [
                otherRecipient.id,
              ])
            )[0].status,
            "cancelled",
          );
          assert.deepEqual(
            (
              await query(
                "SELECT id,idempotency_key,payload FROM ops_jobs WHERE payload->>'campaignId'=$1",
                [current.campaign],
              )
            )[0],
            originalJob,
          );
        },
      );
      await t.test(
        "repeated cancellation preserves an in-flight unknown recipient and the original job and audit",
        async () => {
          const current = await seed();
          assert.equal((await queueAdminCampaign(current.campaign, actor)).ok, true);
          await query(
            "UPDATE whatsapp_campaign_recipients SET status='sending',dispatch_started_at=now(),error='owned response pending' WHERE id=$1",
            [current.recipient],
          );
          const [pendingContact] = await query(
            "INSERT INTO crm_contacts(name) VALUES('Owned undispatched recipient') RETURNING id",
          );
          const [pendingRecipient] = await query(
            "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2) RETURNING id",
            [current.campaign, pendingContact.id],
          );
          const [before] = await query(
            "SELECT status,dispatch_started_at,sent_at,external_message_id,error FROM whatsapp_campaign_recipients WHERE id=$1",
            [current.recipient],
          );
          const jobs = await query(
            "SELECT id,idempotency_key,payload FROM ops_jobs WHERE payload->>'campaignId'=$1",
            [current.campaign],
          );
          assert.equal((await cancelAdminCampaign(current.campaign, actor)).ok, true);
          assert.equal((await cancelAdminCampaign(current.campaign, actor)).ok, false);
          assert.deepEqual(
            (
              await query(
                "SELECT status,dispatch_started_at,sent_at,external_message_id,error FROM whatsapp_campaign_recipients WHERE id=$1",
                [current.recipient],
              )
            )[0],
            before,
          );
          assert.equal(
            (
              await query("SELECT status FROM whatsapp_campaign_recipients WHERE id=$1", [
                pendingRecipient.id,
              ])
            )[0].status,
            "cancelled",
          );
          assert.deepEqual(
            await query(
              "SELECT id,idempotency_key,payload FROM ops_jobs WHERE payload->>'campaignId'=$1",
              [current.campaign],
            ),
            jobs,
          );
          assert.equal(
            (
              await query(
                "SELECT id FROM audit_logs WHERE action='campaign.cancel' AND subject_id=$1",
                [current.campaign],
              )
            ).length,
            1,
          );
          assert.equal(
            (
              await query(
                "SELECT id FROM audit_logs WHERE action='campaign.queue' AND subject_id=$1",
                [current.campaign],
              )
            ).length,
            1,
          );
          assert.equal(
            (await query("SELECT count(*)::int n FROM whatsapp_outbound_intents"))[0].n,
            0,
          );
        },
      );

      // ---------------------------------------------------------------------
      // FX-10b Task 2: a systemic stop pauses the campaign to review (待審核)
      // and keeps every unsent recipient queued. Real SQL, mocked provider.
      // ---------------------------------------------------------------------
      // Verbatim copy of the cron eligibility query (api.admin.jobs.send-queue.ts:66-80).
      const CRON_ELIGIBILITY_SQL = `SELECT DISTINCT recipient.campaign_id::text AS campaign_id,
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
     LIMIT 100`;
      const { woztellCampaignDeliveryHandler, isRetryableJobError } =
        await import("../control-plane/job-handlers.server.ts");
      const { completeJob, failJob } = await import("../control-plane/jobs.server.ts");
      const { pauseCampaignDelivery, beginCampaignDispatch } =
        await import("../woztell/campaign-delivery.server.ts");
      const { retryableFailedRecipientSql } = await import("./campaign-retry.ts");
      let memberSequence = 0;
      async function seedCampaign(n) {
        const [campaign] = await query(
          "INSERT INTO whatsapp_campaigns(name,template_id,audience_id,status,created_by) VALUES('Owned FX-10b campaign',$1,$2,'review',$3) RETURNING id",
          [template.id, audience.id, staff.id],
        );
        const phones = [];
        const members = [];
        for (let i = 0; i < n; i += 1) {
          const seq = String(memberSequence++).padStart(4, "0");
          const phone = "8526333" + seq;
          const member = "owned-fx10b-member-" + seq;
          phones.push(phone);
          members.push(member);
          const [contact] = await query(
            "INSERT INTO crm_contacts(name,phone,normalized_phone,whatsapp_member_id,opt_in_whatsapp,opted_out_whatsapp) VALUES('Owned synthetic recipient',$1,$1,$2,true,false) RETURNING id",
            [phone, member],
          );
          await query(
            "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2)",
            [campaign.id, contact.id],
          );
        }
        assert.equal((await queueAdminCampaign(campaign.id, actor)).ok, true);
        return { campaign: campaign.id, phones, members };
      }
      // The claimJobs SET list, scoped to one campaign: earlier subtests leave
      // other campaigns' jobs queued.
      async function leaseCampaignJob(campaignId, workerId = "owned-fx10b-worker") {
        const [job] = await query(
          `UPDATE ops_jobs SET status='running', attempt_count=attempt_count+1, lease_owner=$2,
             lease_expires_at=now()+interval '5 minutes', updated_at=now()
           WHERE id=(SELECT id FROM ops_jobs WHERE status='queued' AND job_type='woztell.campaign.deliver'
                     AND payload->>'campaignId'=$1 ORDER BY created_at LIMIT 1) RETURNING *`,
          [campaignId, workerId],
        );
        assert.ok(job, "a queued delivery job exists for the campaign");
        return job;
      }
      // Mirrors runClaimedJobs (jobs.server.ts:700-741) for one already-claimed
      // job, with the real handler, so the job row ends in its true state.
      async function deliver(campaignId, job) {
        try {
          await woztellCampaignDeliveryHandler.run(
            { campaignId },
            {
              jobId: job.id,
              attempt: job.attempt_count,
              workerId: job.lease_owner,
              checkpoint: async () => {},
            },
          );
          return { completed: await completeJob({ jobId: job.id, workerId: job.lease_owner }) };
        } catch (error) {
          const code = /^[A-Z][A-Z0-9_]{0,99}$/.test(String(error?.code ?? ""))
            ? String(error.code)
            : "JOB_HANDLER_FAILED";
          const failed = await failJob({
            jobId: job.id,
            workerId: job.lease_owner,
            retryable: isRetryableJobError(error),
            errorCode: code,
            errorSummary: "The job handler could not be completed.",
          });
          return { error, failed };
        }
      }
      const recipientsOf = (campaignId) =>
        query(
          `SELECT r.id, r.status, r.error, r.dispatch_started_at, r.claim_job_id
           FROM whatsapp_campaign_recipients r WHERE r.campaign_id=$1 ORDER BY r.id`,
          [campaignId],
        );
      const pausedAudits = (campaignId) =>
        query("SELECT metadata FROM audit_logs WHERE action='campaign.paused' AND subject_id=$1", [
          campaignId,
        ]);
      const campaignStatus = async (campaignId) =>
        (await query("SELECT status FROM whatsapp_campaigns WHERE id=$1", [campaignId]))[0].status;
      const count = (rows, predicate) => rows.filter(predicate).length;
      const accepted = () => ({
        status: 200,
        body: { ok: 1, messageId: `wamid.synthetic-fx10b-${providerCalls.length}` },
      });

      async function assertSystemicPause(answer, providerStatus) {
        providerCalls.length = 0;
        const seeded = await seedCampaign(5);
        const job = await leaseCampaignJob(seeded.campaign);
        provider = () => (providerCalls.length < 2 ? accepted() : answer);
        const outcome = await deliver(seeded.campaign, job);
        assert.equal(outcome.error?.code, "WOZTELL_CAMPAIGN_PAUSED");
        // 1. Exactly three provider calls.
        assert.equal(providerCalls.length, 3);
        // 2. Two sent, three queued + paused with no reservation, none stuck sending.
        const rows = await recipientsOf(seeded.campaign);
        assert.equal(
          count(rows, (r) => r.status === "sent"),
          2,
        );
        const queued = rows.filter((r) => r.status === "queued");
        assert.equal(queued.length, 3);
        for (const row of queued) {
          assert.equal(row.error, "WOZTELL_CAMPAIGN_PAUSED");
          assert.equal(row.dispatch_started_at, null);
        }
        assert.equal(
          count(rows, (r) => r.status === "sending"),
          0,
        );
        // 3. The campaign is back in review (待審核).
        assert.equal(await campaignStatus(seeded.campaign), "review");
        // 4. Exactly one pause audit, with no phone or member id in it.
        const audits = await pausedAudits(seeded.campaign);
        assert.equal(audits.length, 1);
        assert.equal(audits[0].metadata.reason, "WOZTELL_AUTH_REJECTED");
        assert.equal(audits[0].metadata.providerStatus, providerStatus);
        assert.equal(Number(audits[0].metadata.remaining), 3);
        const auditText = JSON.stringify(audits[0].metadata);
        for (const value of [...seeded.phones, ...seeded.members]) {
          assert.equal(auditText.includes(value), false, "audit must not carry " + value);
        }
        // 5. The job fails visibly and is not retried.
        const [jobRow] = await query("SELECT status,last_error_code FROM ops_jobs WHERE id=$1", [
          job.id,
        ]);
        assert.equal(jobRow.status, "failed");
        assert.equal(jobRow.last_error_code, "WOZTELL_CAMPAIGN_PAUSED");
        // 6. The cron no longer considers the campaign.
        assert.equal(
          (await query(CRON_ELIGIBILITY_SQL)).filter((r) => r.campaign_id === seeded.campaign)
            .length,
          0,
        );
        // 7. Running the (now failed) job again sends nothing.
        providerCalls.length = 0;
        await deliver(seeded.campaign, job);
        assert.equal(providerCalls.length, 0);
        assert.equal(await campaignStatus(seeded.campaign), "review");
      }

      await t.test("401 mid-run pauses and leaves remainder queued", async () => {
        await assertSystemicPause({ status: 401, body: { ok: 0, err: "Unauthorized" } }, 401);
      });

      await t.test(
        "an HTTP 500 ok:0 not-authorized refusal pauses exactly like a 401",
        async () => {
          await assertSystemicPause(
            { status: 500, body: { ok: 0, err: "User is not authorized." } },
            500,
          );
        },
      );

      await t.test("missing configuration pauses before any provider call", async () => {
        for (const variant of ["token", "enabled"]) {
          providerCalls.length = 0;
          provider = accepted;
          syntheticEnv();
          if (variant === "token") delete process.env.WOZTELL_BOT_ACCESS_TOKEN;
          else delete process.env.WOZTELL_ENABLED;
          try {
            const seeded = await seedCampaign(3);
            const job = await leaseCampaignJob(seeded.campaign);
            const outcome = await deliver(seeded.campaign, job);
            assert.equal(outcome.error?.code, "WOZTELL_CAMPAIGN_PAUSED", variant);
            assert.equal(providerCalls.length, 0, variant);
            assert.equal(await campaignStatus(seeded.campaign), "review", variant);
            const rows = await recipientsOf(seeded.campaign);
            assert.equal(rows.length, 3);
            for (const row of rows) {
              assert.equal(row.status, "queued", variant);
              assert.equal(row.error, "WOZTELL_CAMPAIGN_PAUSED", variant);
              assert.equal(row.dispatch_started_at, null, variant);
            }
            const audits = await pausedAudits(seeded.campaign);
            assert.equal(audits.length, 1, variant);
            assert.equal(audits[0].metadata.reason, "WOZTELL_CONFIGURATION_UNAVAILABLE");
            assert.equal(audits[0].metadata.providerStatus, null);
            const [jobRow] = await query(
              "SELECT status,last_error_code FROM ops_jobs WHERE id=$1",
              [job.id],
            );
            assert.equal(jobRow.status, "failed", variant);
            assert.equal(jobRow.last_error_code, "WOZTELL_CAMPAIGN_PAUSED", variant);
          } finally {
            syntheticEnv();
          }
        }
      });

      await t.test(
        "provider down pauses after three unconfirmed results and keeps the rest queued",
        async () => {
          providerCalls.length = 0;
          const seeded = await seedCampaign(6);
          const job = await leaseCampaignJob(seeded.campaign);
          provider = () => new Error("WOZTELL_PROVIDER_TIMEOUT");
          const outcome = await deliver(seeded.campaign, job);
          assert.equal(outcome.error?.code, "WOZTELL_CAMPAIGN_PAUSED");
          assert.equal(providerCalls.length, 3);
          const rows = await recipientsOf(seeded.campaign);
          const unknown = rows.filter((r) => r.status === "failed");
          assert.equal(unknown.length, 3);
          for (const row of unknown) {
            assert.equal(row.error, "WOZTELL_DELIVERY_UNKNOWN");
            assert.ok(row.dispatch_started_at);
          }
          const queued = rows.filter((r) => r.status === "queued");
          assert.equal(queued.length, 3);
          for (const row of queued) assert.equal(row.error, "WOZTELL_CAMPAIGN_PAUSED");
          assert.equal(await campaignStatus(seeded.campaign), "review");
          const audits = await pausedAudits(seeded.campaign);
          assert.equal(audits.length, 1);
          assert.equal(audits[0].metadata.reason, "WOZTELL_PROVIDER_UNSTABLE");
          assert.equal(audits[0].metadata.providerStatus, null);

          // Variant: the breaker counts only CONSECUTIVE unconfirmed results.
          providerCalls.length = 0;
          const interleaved = await seedCampaign(8);
          const secondJob = await leaseCampaignJob(interleaved.campaign);
          const unavailable = { status: 503, body: { message: "Service Unavailable" } };
          const script = [
            unavailable,
            new Error("WOZTELL_PROVIDER_TIMEOUT"),
            { status: 200, body: { ok: 1, messageId: "wamid.synthetic-fx10b-accepted" } },
            unavailable,
            unavailable,
            unavailable,
          ];
          provider = () => script[providerCalls.length];
          const second = await deliver(interleaved.campaign, secondJob);
          assert.equal(second.error?.code, "WOZTELL_CAMPAIGN_PAUSED");
          assert.equal(providerCalls.length, 6);
          const after = await recipientsOf(interleaved.campaign);
          assert.equal(
            count(after, (r) => r.status === "sent"),
            1,
          );
          assert.equal(
            count(after, (r) => r.status === "failed" && r.error === "WOZTELL_DELIVERY_UNKNOWN"),
            5,
          );
          assert.equal(
            count(after, (r) => r.status === "queued" && r.error === "WOZTELL_CAMPAIGN_PAUSED"),
            2,
          );
          assert.equal(
            count(after, (r) => r.status === "sending"),
            0,
          );
          assert.equal(
            (await pausedAudits(interleaved.campaign))[0].metadata.reason,
            "WOZTELL_PROVIDER_UNSTABLE",
          );
        },
      );

      await t.test(
        "unreadable provider bodies at 400, 429 and 500 end unknown, are never re-queued, and trip the breaker",
        async () => {
          providerCalls.length = 0;
          const seeded = await seedCampaign(4);
          const job = await leaseCampaignJob(seeded.campaign);
          const script = [
            { status: 400, raw: "<html><body>400 Bad Request</body></html>" },
            { status: 429, raw: '{"ok":0,"err":"Too many' },
            { status: 500, raw: "" },
          ];
          provider = () => script[providerCalls.length];
          const outcome = await deliver(seeded.campaign, job);
          assert.equal(outcome.error?.code, "WOZTELL_CAMPAIGN_PAUSED");
          assert.equal(providerCalls.length, 3);
          const rows = await recipientsOf(seeded.campaign);
          const unknown = rows.filter((r) => r.status === "failed");
          assert.equal(unknown.length, 3);
          for (const row of unknown) {
            assert.equal(row.error, "WOZTELL_DELIVERY_UNKNOWN");
            assert.ok(row.dispatch_started_at);
          }
          assert.equal(
            count(rows, (r) => r.status === "queued"),
            1,
          );
          // The retry predicate never picks them up.
          const retryable = await query(
            `SELECT r.id FROM whatsapp_campaign_recipients r
             WHERE r.campaign_id=$1 AND ${retryableFailedRecipientSql("r")}`,
            [seeded.campaign],
          );
          assert.equal(retryable.length, 0);
          assert.equal(
            (await pausedAudits(seeded.campaign))[0].metadata.reason,
            "WOZTELL_PROVIDER_UNSTABLE",
          );
        },
      );

      await t.test(
        "a breaker trip on the last recipient finishes the campaign instead of pausing it",
        async () => {
          providerCalls.length = 0;
          const seeded = await seedCampaign(3);
          const job = await leaseCampaignJob(seeded.campaign);
          provider = () => new Error("WOZTELL_PROVIDER_TIMEOUT");
          const outcome = await deliver(seeded.campaign, job);
          assert.equal(outcome.error?.code, "WOZTELL_PROVIDER_UNSTABLE");
          assert.equal(providerCalls.length, 3);
          const rows = await recipientsOf(seeded.campaign);
          assert.equal(
            count(rows, (r) => r.status === "failed" && r.error === "WOZTELL_DELIVERY_UNKNOWN"),
            3,
          );
          assert.equal(
            count(rows, (r) => r.status === "sending" || r.status === "queued"),
            0,
          );
          // No stuck 待審核: the campaign finishes through the normal refresh.
          assert.equal(await campaignStatus(seeded.campaign), "failed");
          assert.equal((await pausedAudits(seeded.campaign)).length, 0);
          const [jobRow] = await query("SELECT status,last_error_code FROM ops_jobs WHERE id=$1", [
            job.id,
          ]);
          assert.equal(jobRow.status, "failed");
          assert.equal(jobRow.last_error_code, "WOZTELL_PROVIDER_UNSTABLE");
          assert.equal(
            (await query(CRON_ELIGIBILITY_SQL)).filter((r) => r.campaign_id === seeded.campaign)
              .length,
            0,
          );
        },
      );

      for (const status of [401, 403]) {
        await t.test(
          `an HTML ${status} records exactly one unknown and pauses with the remainder queued`,
          async () => {
            providerCalls.length = 0;
            const seeded = await seedCampaign(4);
            const job = await leaseCampaignJob(seeded.campaign);
            provider = () =>
              providerCalls.length === 0
                ? accepted()
                : { status, raw: `<html><body>${status} Forbidden</body></html>` };
            const outcome = await deliver(seeded.campaign, job);
            assert.equal(outcome.error?.code, "WOZTELL_CAMPAIGN_PAUSED");
            assert.equal(providerCalls.length, 2);
            const rows = await recipientsOf(seeded.campaign);
            assert.equal(
              count(rows, (r) => r.status === "sent"),
              1,
            );
            const unknown = rows.filter((r) => r.status === "failed");
            assert.equal(unknown.length, 1);
            assert.equal(unknown[0].error, "WOZTELL_DELIVERY_UNKNOWN");
            assert.ok(unknown[0].dispatch_started_at);
            const queued = rows.filter((r) => r.status === "queued");
            assert.equal(queued.length, 2);
            for (const row of queued) {
              assert.equal(row.error, "WOZTELL_CAMPAIGN_PAUSED");
              assert.equal(row.dispatch_started_at, null);
            }
            assert.equal(
              count(rows, (r) => r.status === "sending"),
              0,
            );
            assert.equal(await campaignStatus(seeded.campaign), "review");
            const audits = await pausedAudits(seeded.campaign);
            assert.equal(audits.length, 1);
            assert.equal(audits[0].metadata.reason, "WOZTELL_AUTH_REJECTED");
            assert.equal(audits[0].metadata.providerStatus, status);
            assert.equal(Number(audits[0].metadata.remaining), 2);
            const retryable = await query(
              `SELECT r.id FROM whatsapp_campaign_recipients r
               WHERE r.campaign_id=$1 AND ${retryableFailedRecipientSql("r")}`,
              [seeded.campaign],
            );
            assert.equal(retryable.length, 0);
            const [jobRow] = await query(
              "SELECT status,last_error_code FROM ops_jobs WHERE id=$1",
              [job.id],
            );
            assert.equal(jobRow.status, "failed");
            assert.equal(jobRow.last_error_code, "WOZTELL_CAMPAIGN_PAUSED");
          },
        );
      }

      await t.test("a stale worker cannot pause a campaign it no longer owns", async () => {
        const seeded = await seedCampaign(2);
        const job = await leaseCampaignJob(seeded.campaign);
        await query("UPDATE ops_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [
          job.id,
        ]);
        const result = await pauseCampaignDelivery(seeded.campaign, "WOZTELL_AUTH_REJECTED", 401, {
          jobId: job.id,
          workerId: job.lease_owner,
          attempt: job.attempt_count,
        });
        assert.equal(result.paused, false);
        assert.equal(await campaignStatus(seeded.campaign), "queued");
        assert.equal((await pausedAudits(seeded.campaign)).length, 0);
        for (const row of await recipientsOf(seeded.campaign)) assert.equal(row.error, null);
      });

      await t.test(
        "a recipient another worker claimed before the pause goes back to the queue, not blocked",
        async () => {
          const seeded = await seedCampaign(2);
          const job = await leaseCampaignJob(seeded.campaign);
          const [other] = await query(
            `INSERT INTO ops_jobs(job_type,payload_version,payload,status,attempt_count,lease_owner,lease_expires_at,idempotency_key)
             VALUES('woztell.campaign.deliver',1,jsonb_build_object('campaignId',$1::text),'running',1,
                    'owned-fx10b-other-worker',now()+interval '5 minutes','owned-fx10b-other-' || $1::text)
             RETURNING id`,
            [seeded.campaign],
          );
          const [claimed] = await query(
            `UPDATE whatsapp_campaign_recipients SET status='sending', claim_job_id=$2,
               claim_worker_id='owned-fx10b-other-worker', claim_attempt=1
             WHERE id=(SELECT id FROM whatsapp_campaign_recipients WHERE campaign_id=$1 ORDER BY id LIMIT 1)
             RETURNING id`,
            [seeded.campaign, other.id],
          );
          const paused = await pauseCampaignDelivery(
            seeded.campaign,
            "WOZTELL_AUTH_REJECTED",
            401,
            {
              jobId: job.id,
              workerId: job.lease_owner,
              attempt: job.attempt_count,
            },
          );
          assert.deepEqual(paused, { paused: true, remaining: 1 });
          // The other worker's dispatch attempt is refused and hands the row back.
          const current = await beginCampaignDispatch(seeded.campaign, claimed.id, {
            jobId: other.id,
            workerId: "owned-fx10b-other-worker",
            attempt: 1,
          });
          assert.equal(current, null);
          const [row] = await query(
            "SELECT status,error,dispatch_started_at FROM whatsapp_campaign_recipients WHERE id=$1",
            [claimed.id],
          );
          assert.deepEqual(
            { ...row },
            { status: "queued", error: "WOZTELL_CAMPAIGN_PAUSED", dispatch_started_at: null },
          );
        },
      );

      // ---------------------------------------------------------------------
      // FX-10b Task 3: re-send only definitely refused recipients of the same
      // campaign, behind the existing approval; materialise never resurrects a
      // possibly-sent row; template and audience freeze after delivery.
      // ---------------------------------------------------------------------
      const adminData = await import("./admin-data.server.ts");
      const { retryJob } = await import("../control-plane/jobs.server.ts");
      const [agentStaff] = await query(
        "INSERT INTO staff_users(auth_user_id,email) VALUES('owned-campaign-agent','owned-agent@example.invalid') RETURNING id",
      );
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent')", [
        agentStaff.id,
      ]);
      const agentActor = {
        staffId: agentStaff.id,
        authUserId: "owned-campaign-agent",
        roles: ["agent"],
      };
      const refused = { status: 400, body: { ok: 0, err: "Recipient refused" } };
      const unauthorized = { status: 401, body: { ok: 0, err: "Unauthorized" } };
      const preview = (campaignId) => adminData.fetchCampaignRetryPreview(campaignId, actor);
      // Task 4 fix round 1 (I2): a requeue states the count the user confirmed.
      // By default that is what the preview shows right now, as in the UI.
      const requeue = async (campaignId, who = actor, expectedCount) =>
        adminData.requeueFailedCampaignRecipients(
          { campaignId, expectedCount: expectedCount ?? (await preview(campaignId)).retryable },
          who,
        );
      // A campaign with delivery history is queued only with the count the
      // confirmation showed (SEND_COUNT_CHANGED otherwise). These calls skip
      // materialise, so the count is every dispatchable queued row.
      const { campaignDispatchableQueuedSql } = await import("./campaign-retry.ts");
      const dispatchableCount = async (campaignId) =>
        (
          await query(
            `SELECT count(*)::int AS n FROM whatsapp_campaign_recipients r
             JOIN crm_contacts contact ON contact.id = r.contact_id
             WHERE r.campaign_id = $1 AND ${campaignDispatchableQueuedSql("r", "contact")}`,
            [campaignId],
          )
        )[0].n;
      const queueApproved = async (campaignId) =>
        queueAdminCampaign(campaignId, actor, {
          expectedCount: await dispatchableCount(campaignId),
        });
      let retrySequence = 0;
      const retryPhones = [];
      const retryMembers = [];
      async function addContact(label, options = {}) {
        const seq = String(retrySequence++).padStart(4, "0");
        const phone = options.phone ?? "8526444" + seq;
        const member = "owned-fx10b-retry-" + seq;
        retryPhones.push(phone);
        retryMembers.push(member);
        const [contact] = await query(
          `INSERT INTO crm_contacts(name,phone,normalized_phone,whatsapp_member_id,source,opt_in_whatsapp,opted_out_whatsapp)
           VALUES($1,$2,$2,$3,$4,true,false) RETURNING id`,
          [options.name ?? `FX10b 合成客戶${label}`, phone, member, options.source ?? "website"],
        );
        return { contact: contact.id, phone, member };
      }
      async function addRecipient(campaignId, label, options = {}) {
        const person = await addContact(label, options);
        const [recipient] = await query(
          "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2) RETURNING id",
          [campaignId, person.contact],
        );
        return { ...person, recipient: recipient.id };
      }
      // Contacts named FX10b 合成客戶<label>, one recipient each, on a new campaign.
      async function seedRetryCampaign(labels, options = {}) {
        const [campaign] = await query(
          "INSERT INTO whatsapp_campaigns(name,template_id,audience_id,status,created_by) VALUES('Owned FX-10b retry campaign',$1,$2,$3,$4) RETURNING id",
          [
            options.templateId ?? template.id,
            options.audienceId ?? audience.id,
            options.status ?? "review",
            staff.id,
          ],
        );
        const people = {};
        for (const label of labels) people[label] = await addRecipient(campaign.id, label, options);
        if (options.queue !== false) {
          assert.equal((await queueAdminCampaign(campaign.id, actor)).ok, true);
        }
        return { campaign: campaign.id, people };
      }
      // Answers are keyed by member, never by call index: one claim batch is
      // delivered in the claim UPDATE's RETURNING order, which is unspecified.
      // Writes one recipient's end state directly; no provider is involved.
      async function setRecipient(person, status, error, dispatched) {
        await query(
          `UPDATE whatsapp_campaign_recipients SET status=$2, error=$3,
             dispatch_started_at=CASE WHEN $4::boolean THEN now() - interval '1 hour' END,
             sent_at=CASE WHEN $2='sent' THEN now() END,
             queued_at=COALESCE(queued_at, now())
           WHERE id=$1`,
          [person.recipient, status, error, dispatched],
        );
      }
      const recipientRow = async (id) =>
        (await query("SELECT * FROM whatsapp_campaign_recipients WHERE id=$1", [id]))[0];
      const requeueAudits = (campaignId) =>
        query(
          "SELECT actor_id, metadata FROM audit_logs WHERE action='campaign.requeue_failed' AND subject_id=$1",
          [campaignId],
        );
      const jobsOf = (campaignId) =>
        query(
          "SELECT id,status,idempotency_key FROM ops_jobs WHERE payload->>'campaignId'=$1 ORDER BY created_at, id",
          [campaignId],
        );
      const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
      function assertNoContactData(value, extra = []) {
        const text = JSON.stringify(value);
        for (const secret of [...retryPhones, ...retryMembers, ...extra]) {
          assert.equal(text.includes(secret), false, "must not carry " + secret);
        }
        // Ids are uuids; strip them so an all-digit uuid group cannot pass for a phone.
        assert.doesNotMatch(text.replace(UUID, "<id>"), /\d{8,}/);
        assert.doesNotMatch(text, /synthetic-fx10b-/);
      }

      await t.test("requeue sends only failed", async () => {
        providerCalls.length = 0;
        const { campaign, people } = await seedRetryCampaign(["A", "B", "C", "D", "E"]);
        const answers = {
          [people.A.member]: accepted,
          [people.B.member]: () => ({
            status: 500,
            body: {
              ok: 0,
              err: "WOZTELL_131026: Receiver is incapable of receiving this message",
            },
          }),
          [people.C.member]: () => ({ status: 503, body: { message: "Service Unavailable" } }),
          [people.D.member]: () => ({ status: 400, body: { ok: 0 } }),
          [people.E.member]: accepted,
        };
        provider = (memberId) => answers[memberId]();
        const firstJob = await leaseCampaignJob(campaign);
        // A run with any refusal ends its job failed (existing behaviour).
        assert.equal((await deliver(campaign, firstJob)).error?.code, "WOZTELL_CAMPAIGN_REJECTED");
        assert.equal(providerCalls.length, 5);
        await query("UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1", [
          people.D.contact,
        ]);
        // F: never dispatched, attempts exhausted. G: failed after its dispatch was reserved.
        people.F = await addRecipient(campaign, "F");
        people.G = await addRecipient(campaign, "G");
        await setRecipient(people.F, "failed", "WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED", false);
        await setRecipient(people.G, "failed", "WOZTELL_RECIPIENT_MISSING", true);
        assert.equal(await campaignStatus(campaign), "completed");
        for (const [label, error] of [
          ["B", "WOZTELL_PROVIDER_REJECTED"],
          ["C", "WOZTELL_DELIVERY_UNKNOWN"],
          ["D", "WOZTELL_PROVIDER_REJECTED"],
        ]) {
          const row = await recipientRow(people[label].recipient);
          assert.deepEqual([row.status, row.error], ["failed", error], label);
        }

        // 1. The preview counts exactly what requeue would move.
        const before = await preview(campaign);
        assert.equal(before.campaignId, campaign);
        assert.equal(before.status, "completed");
        assert.equal(before.retryable, 2);
        assert.equal(before.excludedOptedOut, 1);
        assert.equal(before.excludedDuplicatePhone, 0);
        assert.equal(before.unknownTotal, 1);
        assert.equal(before.unknown.length, 1);
        assert.equal(before.unknown[0].recipientId, people.C.recipient);
        assert.equal(before.unknown[0].name, "FX10b 合成客戶C");
        assert.ok(before.unknown[0].dispatchedAt);
        assertNoContactData(before);

        // 2. Requeue moves B and F only.
        const jobsBefore = await jobsOf(campaign);
        const rowC = await recipientRow(people.C.recipient);
        assert.deepEqual(await requeue(campaign), {
          ok: true,
          requeued: 2,
          excludedUnknown: 1,
          excludedOther: 2,
          excludedContactChanged: 0,
        });
        // 3.
        for (const label of ["B", "F"]) {
          const row = await recipientRow(people[label].recipient);
          assert.equal(row.status, "queued", label);
          assert.equal(row.error, null, label);
          assert.equal(row.dispatch_started_at, null, label);
          assert.equal(row.claim_job_id, null, label);
          assert.equal(row.queued_at, null, label);
        }
        for (const label of ["A", "E"]) {
          assert.equal((await recipientRow(people[label].recipient)).status, "sent", label);
        }
        assert.deepEqual(await recipientRow(people.C.recipient), rowC);
        for (const label of ["D", "G"]) {
          assert.equal((await recipientRow(people[label].recipient)).status, "failed", label);
        }
        // 4. Back to 待審核, audited once, no job.
        assert.equal(await campaignStatus(campaign), "review");
        const audits = await requeueAudits(campaign);
        assert.equal(audits.length, 1);
        assert.equal(audits[0].actor_id, staff.id);
        assert.deepEqual(audits[0].metadata, {
          requeued: 2,
          previousStatus: "completed",
          excludedUnknown: 1,
          excludedOther: 2,
          excludedContactChanged: 0,
        });
        assertNoContactData(audits[0].metadata);
        assert.deepEqual(await jobsOf(campaign), jobsBefore);

        // 5. A manager queues it again; the second run reaches B and F only.
        assert.equal((await queueApproved(campaign)).ok, true);
        providerCalls.length = 0;
        provider = accepted;
        const secondJob = await leaseCampaignJob(campaign);
        assert.notEqual(secondJob.id, firstJob.id);
        assert.equal((await deliver(campaign, secondJob)).error, undefined);
        assert.deepEqual(
          providerCalls.map((call) => call.memberId).sort(),
          [people.B.member, people.F.member].sort(),
        );
        for (const label of ["B", "F"]) {
          assert.equal((await recipientRow(people[label].recipient)).status, "sent", label);
        }
        assert.deepEqual(await recipientRow(people.C.recipient), rowC);
      });

      await t.test("no recipient gets two accepted sends", async () => {
        // A fresh failed campaign: P is refused, Q and R time out (two, so the
        // breaker cannot trip whatever the order). Every row failed.
        providerCalls.length = 0;
        const { campaign, people } = await seedRetryCampaign(["P", "Q", "R"]);
        provider = (memberId) =>
          memberId === people.P.member ? refused : new Error("WOZTELL_PROVIDER_TIMEOUT");
        const oldJob = await leaseCampaignJob(campaign);
        assert.equal((await deliver(campaign, oldJob)).error?.code, "WOZTELL_CAMPAIGN_REJECTED");
        assert.equal(await campaignStatus(campaign), "failed");
        assert.equal((await recipientRow(people.P.recipient)).error, "WOZTELL_PROVIDER_REJECTED");

        // Two requeues at once: one moves P, the other finds nothing.
        const racing = await Promise.all([requeue(campaign), requeue(campaign)]);
        assert.deepEqual(
          racing.find((result) => result.ok),
          {
            ok: true,
            requeued: 1,
            excludedUnknown: 2,
            excludedOther: 0,
            excludedContactChanged: 0,
          },
        );
        assert.deepEqual(
          racing.find((result) => !result.ok),
          { ok: false, error: "NOTHING_TO_RETRY" },
        );
        assert.equal((await requeueAudits(campaign)).length, 1);

        // Two queues at once: exactly one new job.
        const queues = await Promise.all([queueApproved(campaign), queueApproved(campaign)]);
        assert.equal(queues.filter((result) => result.ok).length, 1);
        const jobs = await jobsOf(campaign);
        assert.equal(jobs.length, 2);
        assert.equal(jobs.filter((job) => job.status === "queued").length, 1);

        providerCalls.length = 0;
        provider = accepted;
        const newJob = await leaseCampaignJob(campaign);
        await deliver(campaign, newJob);
        assert.deepEqual(
          providerCalls.map((call) => call.memberId),
          [people.P.member],
        );
        assert.equal(await campaignStatus(campaign), "completed");

        // The old first-run job, retried from 系統運作, sends nothing.
        providerCalls.length = 0;
        assert.ok(await retryJob(oldJob.id));
        const replay = await leaseCampaignJob(campaign);
        assert.equal(replay.id, oldJob.id);
        await deliver(campaign, replay);
        assert.equal(providerCalls.length, 0);
        assert.deepEqual(await requeue(campaign), { ok: false, error: "NOTHING_TO_RETRY" });

        // Dedupe: X and X′ are one phone in two formats. X was sent, so X′ is
        // never re-sent even though its own failure is retry-safe.
        const dup = await seedRetryCampaign([], { queue: false, status: "completed" });
        const x = await addRecipient(dup.campaign, "X", { phone: "85261119990" });
        const xPrime = await addRecipient(dup.campaign, "X′", { phone: "61119990" });
        await setRecipient(x, "sent", null, true);
        await setRecipient(xPrime, "failed", "WOZTELL_PROVIDER_REJECTED", false);
        const dupPreview = await preview(dup.campaign);
        assert.equal(dupPreview.retryable, 0);
        assert.equal(dupPreview.excludedDuplicatePhone, 1);
        assert.equal(dupPreview.excludedOptedOut, 0);
        assertNoContactData(dupPreview);
        assert.deepEqual(await requeue(dup.campaign), { ok: false, error: "NOTHING_TO_RETRY" });
        assert.equal((await recipientRow(xPrime.recipient)).status, "failed");
        assert.equal(allProviderCalls.filter((call) => call.memberId === xPrime.member).length, 0);
      });

      await t.test("unknown recipients are excluded and listed", async () => {
        const { campaign, people } = await seedRetryCampaign(["U1", "K"], {
          queue: false,
          status: "completed",
        });
        people.N = await addRecipient(campaign, "N", { name: "85261112229" });
        await setRecipient(people.U1, "failed", "WOZTELL_DELIVERY_UNKNOWN", true);
        await setRecipient(people.N, "failed", "WOZTELL_DELIVERY_UNKNOWN", true);
        await setRecipient(people.K, "failed", "WOZTELL_PROVIDER_REJECTED", false);
        // U1 was dispatched first, so it is listed first.
        await query(
          "UPDATE whatsapp_campaign_recipients SET dispatch_started_at=now() - interval '2 hours' WHERE id=$1",
          [people.U1.recipient],
        );
        const listed = await preview(campaign);
        assert.equal(listed.unknownTotal, 2);
        assert.deepEqual(
          listed.unknown.map((row) => row.recipientId),
          [people.U1.recipient, people.N.recipient],
        );
        assert.deepEqual(Object.keys(listed.unknown[0]).sort(), [
          "dispatchedAt",
          "name",
          "recipientId",
        ]);
        assert.equal(listed.unknown[0].name, "FX10b 合成客戶U1");
        assert.ok(listed.unknown[0].dispatchedAt);
        // A name that is really a phone number is withheld.
        assert.equal(listed.unknown[1].name, null);
        assert.equal(listed.retryable, 1);
        assertNoContactData(listed, ["85261112229"]);

        const unknownBefore = [
          await recipientRow(people.U1.recipient),
          await recipientRow(people.N.recipient),
        ];
        assert.deepEqual(await requeue(campaign), {
          ok: true,
          requeued: 1,
          excludedUnknown: 2,
          excludedOther: 0,
          excludedContactChanged: 0,
        });
        assert.deepEqual(
          [await recipientRow(people.U1.recipient), await recipientRow(people.N.recipient)],
          unknownBefore,
        );
      });

      await t.test(
        "a requeued campaign sends nothing until a manager queues it again",
        async () => {
          const [gateTemplate] = await query(
            "INSERT INTO whatsapp_templates(element_name,status) VALUES('owned_campaign_retry_gate','active') RETURNING id",
          );
          providerCalls.length = 0;
          const { campaign, people } = await seedRetryCampaign(["V1", "V2", "V3"], {
            templateId: gateTemplate.id,
          });
          // V1 was sent and V2 refused in an earlier batch; V3's 401 pauses this run.
          await setRecipient(people.V1, "sent", null, true);
          await setRecipient(people.V2, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          provider = () => unauthorized;
          const pausedJob = await leaseCampaignJob(campaign);
          assert.equal((await deliver(campaign, pausedJob)).error?.code, "WOZTELL_CAMPAIGN_PAUSED");
          assert.equal(providerCalls.length, 1);
          assert.equal((await recipientRow(people.V3.recipient)).error, "WOZTELL_CAMPAIGN_PAUSED");
          const reviewedAt = async () =>
            (await query("SELECT reviewed_at FROM whatsapp_campaigns WHERE id=$1", [campaign]))[0]
              .reviewed_at;
          const reviewedBefore = await reviewedAt();
          const jobsBefore = await jobsOf(campaign);
          const wakesBefore = wakes.length;
          assert.deepEqual(await requeue(campaign), {
            ok: true,
            requeued: 1,
            excludedUnknown: 0,
            excludedOther: 0,
            excludedContactChanged: 0,
          });
          assert.deepEqual(await jobsOf(campaign), jobsBefore);
          assert.deepEqual(await reviewedAt(), reviewedBefore);
          assert.equal(wakes.length, wakesBefore);
          assert.equal(await campaignStatus(campaign), "review");

          // The ops-page retry of the paused job sends nothing.
          providerCalls.length = 0;
          provider = accepted;
          assert.ok(await retryJob(pausedJob.id));
          const replay = await leaseCampaignJob(campaign);
          assert.equal(replay.id, pausedJob.id);
          await deliver(campaign, replay);
          assert.equal(providerCalls.length, 0);
          for (const label of ["V2", "V3"]) {
            assert.equal((await recipientRow(people[label].recipient)).status, "queued", label);
          }
          assert.equal(await campaignStatus(campaign), "review");

          // Agents cannot re-send.
          await assert.rejects(
            () => requeue(campaign, agentActor),
            (error) => error instanceof Response && error.status === 403,
          );

          // An inactive template still blocks the re-approval.
          await query("UPDATE whatsapp_templates SET status='inactive' WHERE id=$1", [
            gateTemplate.id,
          ]);
          assert.deepEqual(await queueAdminCampaign(campaign, actor), {
            ok: false,
            error: "TEMPLATE_NOT_ACTIVE",
          });
          assert.equal((await jobsOf(campaign)).length, jobsBefore.length);
          await query("UPDATE whatsapp_templates SET status='active' WHERE id=$1", [
            gateTemplate.id,
          ]);

          assert.equal((await queueApproved(campaign)).ok, true);
          const jobs = await jobsOf(campaign);
          assert.equal(jobs.length, 2);
          assert.notEqual(jobs[1].idempotency_key, jobs[0].idempotency_key);
          assert.equal(
            (
              await query(
                "SELECT id FROM audit_logs WHERE action='campaign.queue' AND subject_id=$1",
                [campaign],
              )
            ).length,
            2,
          );

          // End to end (Task 2 review M4): the resumed run reaches exactly the
          // refused and paused rows; the sent row is untouched.
          const sentBefore = await recipientRow(people.V1.recipient);
          providerCalls.length = 0;
          provider = accepted;
          await deliver(campaign, await leaseCampaignJob(campaign));
          assert.deepEqual(
            providerCalls.map((call) => call.memberId).sort(),
            [people.V2.member, people.V3.member].sort(),
          );
          assert.deepEqual(await recipientRow(people.V1.recipient), sentBefore);
          assert.equal(await campaignStatus(campaign), "completed");
        },
      );

      await t.test(
        "materialize never resurrects a failed or dispatched recipient and adds no new contacts to a campaign with history",
        async () => {
          const source = "owned-fx10b-materialise";
          const [scoped] = await query(
            "INSERT INTO whatsapp_audiences(name,filters,created_by) VALUES('Owned FX-10b materialise audience',$1::jsonb,$2) RETURNING id",
            [JSON.stringify({ source }), staff.id],
          );
          providerCalls.length = 0;
          const { campaign, people } = await seedRetryCampaign(["M1", "M2", "M3", "M4", "M5"], {
            audienceId: scoped.id,
            source,
          });
          provider = () => (providerCalls.length < 2 ? accepted() : unauthorized);
          const job = await leaseCampaignJob(campaign);
          assert.equal((await deliver(campaign, job)).error?.code, "WOZTELL_CAMPAIGN_PAUSED");
          assert.equal(await campaignStatus(campaign), "review");
          // G: failed after dispatch. R: queued but already reserved, and no longer eligible.
          const g = await addRecipient(campaign, "MG", { source });
          await setRecipient(g, "failed", "WOZTELL_RECIPIENT_MISSING", true);
          // F: refused and never dispatched. Only the audited requeue may move it.
          const f = await addRecipient(campaign, "MF", { source });
          await setRecipient(f, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          const r = await addRecipient(campaign, "MR", { source });
          await setRecipient(r, "queued", null, true);
          await query("UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1", [r.contact]);
          // H matches the audience but was never part of this campaign.
          const h = await addContact("MH", { source });
          const sentBefore = (await recipientsOf(campaign)).filter((row) => row.status === "sent");
          assert.equal(sentBefore.length, 2);
          const gBefore = await recipientRow(g.recipient);

          const result = await adminData.sendAdminCampaignQueue(campaign, actor, {
            expectedCount: (await adminData.fetchCampaignSendPreview(campaign, actor)).sendable,
          });
          assert.equal(result.ok, true);
          assert.equal(
            (
              await query(
                "SELECT id FROM whatsapp_campaign_recipients WHERE campaign_id=$1 AND contact_id=$2",
                [campaign, h.contact],
              )
            ).length,
            0,
          );
          const after = await recipientsOf(campaign);
          assert.deepEqual(
            after.filter((row) => row.status === "sent"),
            sentBefore,
          );
          const gAfter = await recipientRow(g.recipient);
          assert.deepEqual(
            [gAfter.status, gAfter.error, gAfter.dispatch_started_at],
            [gBefore.status, gBefore.error, gBefore.dispatch_started_at],
          );
          const fAfter = await recipientRow(f.recipient);
          assert.deepEqual([fAfter.status, fAfter.error], ["failed", "WOZTELL_PROVIDER_REJECTED"]);
          const rAfter = await recipientRow(r.recipient);
          assert.equal(rAfter.status, "queued");
          assert.ok(rAfter.dispatch_started_at);
          const paused = Object.values(people).filter(
            (person) => !sentBefore.some((row) => row.id === person.recipient),
          );
          assert.equal(paused.length, 3);
          for (const person of paused) {
            const row = await recipientRow(person.recipient);
            assert.deepEqual([row.status, row.error], ["queued", null]);
          }
          assert.equal(
            count(after, (row) => row.status === "blocked" && row.dispatch_started_at !== null),
            0,
          );

          // Contrast: a campaign with no history still picks up new audience matches.
          const fresh = await seedRetryCampaign([], { queue: false, audienceId: scoped.id });
          assert.equal(
            (await adminData.materializeCampaignRecipients(fresh.campaign, actor)).ok,
            true,
          );
          const [hRow] = await query(
            "SELECT status FROM whatsapp_campaign_recipients WHERE campaign_id=$1 AND contact_id=$2",
            [fresh.campaign, h.contact],
          );
          assert.equal(hRow?.status, "queued");
        },
      );

      await t.test("a campaign with delivery history keeps its template and audience", async () => {
        const [otherTemplate] = await query(
          "INSERT INTO whatsapp_templates(element_name,status) VALUES('owned_campaign_other','active') RETURNING id",
        );
        const [otherAudience] = await query(
          "INSERT INTO whatsapp_audiences(name,created_by) VALUES('Owned other audience',$1) RETURNING id",
          [staff.id],
        );
        const { campaign, people } = await seedRetryCampaign(["T1", "T2"], { queue: false });
        await setRecipient(people.T1, "sent", null, true);
        await setRecipient(people.T2, "queued", "WOZTELL_CAMPAIGN_PAUSED", false);
        const base = {
          id: campaign,
          name: "Owned FX-10b retry campaign",
          template_id: template.id,
          audience_id: audience.id,
          status: "review",
          scheduled_at: null,
        };
        const snapshot = async (id) =>
          (
            await query(
              "SELECT name,template_id,audience_id,status,updated_at FROM whatsapp_campaigns WHERE id=$1",
              [id],
            )
          )[0];
        const before = await snapshot(campaign);
        for (const change of [
          { template_id: otherTemplate.id },
          { audience_id: otherAudience.id },
        ]) {
          assert.deepEqual(await adminData.saveAdminCampaign({ ...base, ...change }, actor), {
            id: "",
            error: "CAMPAIGN_HAS_DELIVERY_HISTORY",
          });
        }
        assert.deepEqual(await snapshot(campaign), before);

        assert.deepEqual(
          await adminData.saveAdminCampaign({ ...base, name: "Owned FX-10b renamed" }, actor),
          { id: campaign },
        );
        assert.equal((await snapshot(campaign)).name, "Owned FX-10b renamed");

        // A never-sent review campaign can still change its template.
        const fresh = await seedRetryCampaign(["T3"], { queue: false });
        assert.deepEqual(
          await adminData.saveAdminCampaign(
            { ...base, id: fresh.campaign, template_id: otherTemplate.id },
            actor,
          ),
          { id: fresh.campaign },
        );
        assert.equal((await snapshot(fresh.campaign)).template_id, otherTemplate.id);
        // An unknown id is still plainly not found.
        assert.deepEqual(
          await adminData.saveAdminCampaign(
            { ...base, id: "00000000-0000-4000-8000-000000000000", template_id: otherTemplate.id },
            actor,
          ),
          { id: "", error: "Not found" },
        );
      });

      await t.test("requeue refuses while a delivery is in flight", async () => {
        const state = async (campaignId) => ({
          rows: await query(
            "SELECT * FROM whatsapp_campaign_recipients WHERE campaign_id=$1 ORDER BY id",
            [campaignId],
          ),
          status: await campaignStatus(campaignId),
          audits: (await requeueAudits(campaignId)).length,
          jobs: await jobsOf(campaignId),
        });

        // (a) A recipient is still sending.
        const a = await seedRetryCampaign(["I1", "I2"], { queue: false, status: "failed" });
        await setRecipient(a.people.I1, "failed", "WOZTELL_PROVIDER_REJECTED", false);
        await setRecipient(a.people.I2, "sending", null, true);
        const beforeA = await state(a.campaign);
        assert.deepEqual(await requeue(a.campaign), {
          ok: false,
          error: "CAMPAIGN_STILL_SENDING",
        });
        assert.deepEqual(await state(a.campaign), beforeA);

        // (b) A delivery job still holds a live lease.
        const b = await seedRetryCampaign(["I3"], { queue: false, status: "completed" });
        await setRecipient(b.people.I3, "failed", "WOZTELL_PROVIDER_REJECTED", false);
        const [liveJob] = await query(
          `INSERT INTO ops_jobs(job_type,payload_version,payload,status,attempt_count,lease_owner,lease_expires_at,idempotency_key)
           VALUES('woztell.campaign.deliver',1,jsonb_build_object('campaignId',$1::text),'running',1,
                  'owned-fx10b-live-worker',now()+interval '5 minutes','owned-fx10b-live-' || $1::text)
           RETURNING id`,
          [b.campaign],
        );
        const beforeB = await state(b.campaign);
        assert.deepEqual(await requeue(b.campaign), {
          ok: false,
          error: "CAMPAIGN_STILL_SENDING",
        });
        assert.deepEqual(await state(b.campaign), beforeB);
        // Once that lease has expired, it no longer blocks.
        await query("UPDATE ops_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [
          liveJob.id,
        ]);
        assert.equal((await requeue(b.campaign)).ok, true);

        // (c) A campaign that is queued is not retryable.
        const c = await seedRetryCampaign(["I4", "I5"]);
        await setRecipient(c.people.I4, "failed", "WOZTELL_PROVIDER_REJECTED", false);
        const beforeC = await state(c.campaign);
        assert.deepEqual(await requeue(c.campaign), {
          ok: false,
          error: "CAMPAIGN_NOT_RETRYABLE",
        });
        assert.deepEqual(await state(c.campaign), beforeC);

        // (d) The real race: requeue while the job is mid-send (J2 on the wire),
        // then a late acceptance lands. J1 is refused in the same run.
        providerCalls.length = 0;
        const d = await seedRetryCampaign(["J1", "J2", "J3"]);
        let release;
        const onTheWire = new Promise((resolve) => (release = resolve));
        let markStarted;
        const started = new Promise((resolve) => (markStarted = resolve));
        provider = (memberId) => {
          if (memberId === d.people.J1.member) return refused;
          if (memberId === d.people.J2.member) {
            markStarted();
            return onTheWire;
          }
          return accepted();
        };
        const job = await leaseCampaignJob(d.campaign);
        const running = deliver(d.campaign, job);
        await started;
        const beforeD = await state(d.campaign);
        const during = await Promise.all([requeue(d.campaign), requeue(d.campaign)]);
        for (const result of during) {
          assert.deepEqual(result, { ok: false, error: "CAMPAIGN_STILL_SENDING" });
        }
        assert.deepEqual(await state(d.campaign), beforeD);
        release(accepted());
        assert.equal((await running).error?.code, "WOZTELL_CAMPAIGN_REJECTED");
        assert.equal((await recipientRow(d.people.J2.recipient)).status, "sent");
        assert.equal(await campaignStatus(d.campaign), "completed");
        // Only the refused J1 is re-queued; J2's late acceptance is never re-sent.
        assert.deepEqual(await requeue(d.campaign), {
          ok: true,
          requeued: 1,
          excludedUnknown: 0,
          excludedOther: 0,
          excludedContactChanged: 0,
        });
        assert.equal((await queueApproved(d.campaign)).ok, true);
        providerCalls.length = 0;
        provider = accepted;
        await deliver(d.campaign, await leaseCampaignJob(d.campaign));
        assert.deepEqual(
          providerCalls.map((call) => call.memberId),
          [d.people.J1.member],
        );
      });

      await t.test("a re-send through the UI path never grows past the preview", async () => {
        // Review I1: blocked rows that never reached WhatsApp must stay blocked
        // when 「發送…」 re-materialises a campaign with history.
        const source = "owned-fx10b-grow";
        const [scoped] = await query(
          "INSERT INTO whatsapp_audiences(name,filters,created_by) VALUES('Owned FX-10b grow audience',$1::jsonb,$2) RETURNING id",
          [JSON.stringify({ source }), staff.id],
        );
        const { campaign, people } = await seedRetryCampaign(["W1", "W2", "W3", "W4"], {
          audienceId: scoped.id,
          source,
          queue: false,
          status: "completed",
        });
        await setRecipient(people.W1, "sent", null, true);
        await setRecipient(people.W2, "failed", "WOZTELL_PROVIDER_REJECTED", false);
        await setRecipient(people.W3, "blocked", "WOZTELL_DISPATCH_INELIGIBLE", false);
        await setRecipient(people.W4, "blocked", "No longer eligible for audience", false);

        const shown = await preview(campaign);
        assert.equal(shown.retryable, 1);
        assert.equal((await requeue(campaign)).ok, true);
        const result = await adminData.sendAdminCampaignQueue(campaign, actor, {
          expectedCount: (await adminData.fetchCampaignSendPreview(campaign, actor)).sendable,
        });
        assert.equal(result.ok, true);
        const rows = await recipientsOf(campaign);
        assert.equal(
          count(rows, (row) => row.status === "queued"),
          shown.retryable,
        );
        for (const label of ["W3", "W4"]) {
          assert.equal((await recipientRow(people[label].recipient)).status, "blocked", label);
        }
        providerCalls.length = 0;
        provider = accepted;
        await deliver(campaign, await leaseCampaignJob(campaign));
        assert.deepEqual(
          providerCalls.map((call) => call.memberId),
          [people.W2.member],
        );
      });

      await t.test("a re-send never goes to a number changed since the attempt", async () => {
        // Controller ruling I2: a contact whose phone or member id may have
        // changed after the refused attempt is not re-queued.
        const { campaign, people } = await seedRetryCampaign(["K1", "K2"], {
          queue: false,
          status: "completed",
        });
        await setRecipient(people.K1, "failed", "WOZTELL_PROVIDER_REJECTED", false);
        await setRecipient(people.K2, "failed", "WOZTELL_PROVIDER_REJECTED", false);
        const changedPhone = "85264449990";
        retryPhones.push(changedPhone);
        await query(
          "UPDATE crm_contacts SET phone=$2, normalized_phone=$2, updated_at=clock_timestamp() WHERE id=$1",
          [people.K1.contact, changedPhone],
        );
        const shown = await preview(campaign);
        assert.equal(shown.retryable, 1);
        assert.equal(shown.excludedContactChanged, 1);
        assert.equal(shown.excludedOptedOut, 0);
        assert.deepEqual(shown.exclusions, [{ reason: "CONTACT_CHANGED_SINCE_ATTEMPT", count: 1 }]);
        assertNoContactData(shown);
        assert.deepEqual(await requeue(campaign), {
          ok: true,
          requeued: 1,
          excludedUnknown: 0,
          excludedOther: 1,
          excludedContactChanged: 1,
        });
        // K2's phone did not change, so it is re-queued; K1 stays failed.
        assert.equal((await recipientRow(people.K2.recipient)).status, "queued");
        assert.equal((await recipientRow(people.K1.recipient)).status, "failed");
        const [audit] = await requeueAudits(campaign);
        assert.equal(audit.metadata.excludedContactChanged, 1);
        assertNoContactData(audit.metadata);

        // The real phone-rewrite path: a live-agent visitor corrects the phone
        // on the contact the handoff created (updated_owned).
        const live = await import("../ai/live-agent.server.ts");
        const { session, accessToken } = await live.createLiveAgentSession({
          sourcePath: "/listings",
        });
        const handoff = (phone) =>
          live.requestLiveAgentHandoff({
            sessionId: session.id,
            accessToken,
            name: "Synthetic visitor",
            phone,
            intent: "buyer",
            opt_in_whatsapp: true,
          });
        await handoff("9444 0001");
        retryPhones.push("85294440001", "85294440002");
        const [visitor] = await query(
          "SELECT id FROM crm_contacts WHERE normalized_phone='85294440001'",
        );
        assert.ok(visitor, "the handoff created the visitor contact");
        const [liveCampaign] = await query(
          "INSERT INTO whatsapp_campaigns(name,template_id,audience_id,status,created_by) VALUES('Owned FX-10b live-agent campaign',$1,$2,'review',$3) RETURNING id",
          [template.id, audience.id, staff.id],
        );
        const [visitorRow] = await query(
          "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2) RETURNING id",
          [liveCampaign.id, visitor.id],
        );
        assert.equal((await queueAdminCampaign(liveCampaign.id, actor)).ok, true);
        providerCalls.length = 0;
        provider = () => refused;
        await deliver(liveCampaign.id, await leaseCampaignJob(liveCampaign.id));
        assert.equal(providerCalls.length, 1);
        assert.equal((await recipientRow(visitorRow.id)).error, "WOZTELL_PROVIDER_REJECTED");
        // Unchanged so far: the preview would retry it.
        assert.equal((await preview(liveCampaign.id)).retryable, 1);
        await handoff("9444 0002");
        assert.equal(
          (await query("SELECT normalized_phone FROM crm_contacts WHERE id=$1", [visitor.id]))[0]
            .normalized_phone,
          "85294440002",
        );
        const afterEdit = await preview(liveCampaign.id);
        assert.equal(afterEdit.retryable, 0);
        assert.equal(afterEdit.excludedContactChanged, 1);
        assertNoContactData(afterEdit);
        assert.deepEqual(await requeue(liveCampaign.id), {
          ok: false,
          error: "NOTHING_TO_RETRY",
        });
        assert.equal((await recipientRow(visitorRow.id)).status, "failed");
      });

      await t.test(
        "every count on the campaign screen comes from the server and matches the send",
        async () => {
          // Task 4 fix round 1: the row label, the retry confirmation, the 發送…
          // confirmation and the queue result are each one server number, and
          // each equals what actually happens next.
          const source = "owned-fx10b-exact";
          const [scoped] = await query(
            "INSERT INTO whatsapp_audiences(name,filters,created_by) VALUES('Owned FX-10b exact audience',$1::jsonb,$2) RETURNING id",
            [JSON.stringify({ source }), staff.id],
          );
          const { campaign, people } = await seedRetryCampaign(["V1", "V2", "V3", "V4", "V5"], {
            audienceId: scoped.id,
            source,
            queue: false,
            status: "review",
          });
          await setRecipient(people.V1, "sent", null, true);
          await setRecipient(people.V2, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          await setRecipient(people.V3, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          await setRecipient(people.V4, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          await setRecipient(people.V5, "queued", "WOZTELL_CAMPAIGN_PAUSED", false);
          await query("UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1", [
            people.V4.contact,
          ]);
          const listed = async () =>
            (await adminData.listAdminCampaigns()).find((row) => row.id === campaign);

          // I3: the row's （N） is the consent-aware count the preview shows.
          const shown = await preview(campaign);
          assert.equal(shown.retryable, 2);
          assert.equal(shown.alreadyQueued, 1);
          assert.equal((await listed()).retryable_failed, shown.retryable);

          // I2: a stale confirmed count moves nothing and says what is true now.
          assert.deepEqual(await requeue(campaign, actor, 3), {
            ok: false,
            error: "RETRY_COUNT_CHANGED",
            retryable: 2,
          });
          assert.equal((await recipientRow(people.V2.recipient)).status, "failed");
          assert.equal((await requeueAudits(campaign)).length, 0);
          assert.equal((await requeue(campaign, actor, 2)).requeued, 2);
          assert.equal((await listed()).retryable_failed, 0);

          // I1: 發送… shows exactly retryable + alreadyQueued from the preview...
          const send = await adminData.fetchCampaignSendPreview(campaign, actor);
          assert.deepEqual(send, {
            campaignId: campaign,
            deliveryStarted: true,
            sendable: shown.retryable + shown.alreadyQueued,
            finishable: false,
          });
          // ...and drops when a queued contact's consent lapses.
          await query("UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1", [
            people.V3.contact,
          ]);
          const lapsed = await adminData.fetchCampaignSendPreview(campaign, actor);
          assert.equal(lapsed.sendable, 2);

          // The queue reports what it queued, and delivery reaches exactly those.
          const queued = await adminData.sendAdminCampaignQueue(campaign, actor, {
            expectedCount: lapsed.sendable,
          });
          assert.equal(queued.ok, true);
          assert.equal(queued.queuedRecipients, lapsed.sendable);
          providerCalls.length = 0;
          provider = accepted;
          await deliver(campaign, await leaseCampaignJob(campaign));
          assert.deepEqual(
            providerCalls.map((call) => call.memberId).sort(),
            [people.V2.member, people.V5.member].sort(),
          );
          await assert.rejects(
            () => adminData.fetchCampaignSendPreview(campaign, agentActor),
            (error) => error instanceof Response && error.status === 403,
          );
        },
      );

      // FX-10b final fix wave, I1: the attempted identity is checked at send
      // time, so a phone changed after the requeue never gets the re-send.
      const attemptedIdentity = async (id) =>
        (
          await query("SELECT attempted_identity FROM whatsapp_campaign_recipients WHERE id=$1", [
            id,
          ])
        )[0].attempted_identity;
      const sendPreview = (campaignId) => adminData.fetchCampaignSendPreview(campaignId, actor);
      const approve = async (campaignId, expectedCount) =>
        adminData.sendAdminCampaignQueue(campaignId, actor, {
          expectedCount: expectedCount ?? (await sendPreview(campaignId)).sendable,
        });

      await t.test(
        "a re-send is blocked at dispatch when the phone changed after the requeue",
        async () => {
          const live = await import("../ai/live-agent.server.ts");
          const { session, accessToken } = await live.createLiveAgentSession({
            sourcePath: "/listings",
          });
          const handoff = (phone) =>
            live.requestLiveAgentHandoff({
              sessionId: session.id,
              accessToken,
              name: "Synthetic visitor",
              phone,
              intent: "buyer",
              opt_in_whatsapp: true,
            });
          await handoff("9444 0003");
          retryPhones.push("85294440003", "85294440004");
          const [visitor] = await query(
            "SELECT id FROM crm_contacts WHERE normalized_phone='85294440003'",
          );
          assert.ok(visitor, "the handoff created the visitor contact");
          const { campaign, people } = await seedRetryCampaign(["L1"], {
            queue: false,
            status: "review",
          });
          const [visitorRow] = await query(
            "INSERT INTO whatsapp_campaign_recipients(campaign_id,contact_id) VALUES($1,$2) RETURNING id",
            [campaign, visitor.id],
          );
          assert.equal((await queueAdminCampaign(campaign, actor)).ok, true);
          providerCalls.length = 0;
          provider = () => refused;
          await deliver(campaign, await leaseCampaignJob(campaign));
          assert.equal(providerCalls.length, 2);

          // The attempt stored a digest of the identity used, never the phone.
          const digest = await attemptedIdentity(visitorRow.id);
          assert.match(String(digest), /^[0-9a-f]{64}$/);
          for (const value of [...retryPhones, ...retryMembers]) {
            assert.equal(String(digest).includes(value), false, "digest must not carry " + value);
          }
          assert.match(String(await attemptedIdentity(people.L1.recipient)), /^[0-9a-f]{64}$/);

          // Requeue while nothing has changed: both move and keep the digest.
          assert.equal((await requeue(campaign, actor, 2)).requeued, 2);
          assert.equal(await attemptedIdentity(visitorRow.id), digest);

          // The live-agent visitor corrects the phone (updated_owned).
          await handoff("9444 0004");
          assert.equal(
            (await query("SELECT normalized_phone FROM crm_contacts WHERE id=$1", [visitor.id]))[0]
              .normalized_phone,
            "85294440004",
          );
          // 發送… counts only the unchanged contact, and the approval sends it.
          assert.equal((await sendPreview(campaign)).sendable, 1);
          const approved = await approve(campaign, 1);
          assert.equal(approved.ok, true);
          assert.equal(approved.queuedRecipients, 1);
          providerCalls.length = 0;
          provider = accepted;
          await deliver(campaign, await leaseCampaignJob(campaign));
          assert.deepEqual(
            providerCalls.map((call) => call.memberId),
            [people.L1.member],
          );
          const blocked = await recipientRow(visitorRow.id);
          assert.deepEqual(
            [blocked.status, blocked.error, blocked.dispatch_started_at],
            ["blocked", "CONTACT_CHANGED_SINCE_ATTEMPT", null],
          );
          assert.equal((await recipientRow(people.L1.recipient)).status, "sent");
          const dispatchAudits = await query(
            "SELECT metadata FROM audit_logs WHERE action='campaign.dispatch' AND subject_id=$1",
            [visitorRow.id],
          );
          assert.equal(dispatchAudits.length, 1, "only the first, refused attempt was dispatched");
          assertNoContactData(dispatchAudits);
        },
      );

      await t.test(
        "a phone changed after the approval is blocked at dispatch, not sent",
        async () => {
          const { campaign, people } = await seedRetryCampaign(["M1"]);
          providerCalls.length = 0;
          provider = () => refused;
          await deliver(campaign, await leaseCampaignJob(campaign));
          assert.equal(providerCalls.length, 1);
          assert.equal((await requeue(campaign, actor, 1)).requeued, 1);
          // Its only row was refused and requeued: the campaign still has
          // history, so the approval adds nobody from the audience.
          assert.equal((await sendPreview(campaign)).sendable, 1);
          assert.equal((await approve(campaign, 1)).ok, true);
          assert.equal((await recipientsOf(campaign)).length, 1);
          // A staff edit lands between the approval and the dispatch.
          const changedPhone = "85264449991";
          retryPhones.push(changedPhone);
          await query(
            "UPDATE crm_contacts SET phone=$2, normalized_phone=$2, updated_at=now() WHERE id=$1",
            [people.M1.contact, changedPhone],
          );
          providerCalls.length = 0;
          provider = accepted;
          await deliver(campaign, await leaseCampaignJob(campaign));
          assert.equal(providerCalls.length, 0);
          const row = await recipientRow(people.M1.recipient);
          assert.deepEqual([row.status, row.error], ["blocked", "CONTACT_CHANGED_SINCE_ATTEMPT"]);
          assert.equal(await campaignStatus(campaign), "failed");
        },
      );

      await t.test("a member id changed after the attempt also blocks the re-send", async () => {
        const { campaign, people } = await seedRetryCampaign(["N1", "N2"]);
        providerCalls.length = 0;
        provider = () => refused;
        await deliver(campaign, await leaseCampaignJob(campaign));
        assert.equal((await requeue(campaign, actor, 2)).requeued, 2);
        const otherMember = "owned-fx10b-retry-moved";
        retryMembers.push(otherMember);
        // Written without touching updated_at: the digest alone must catch it.
        await query("UPDATE crm_contacts SET whatsapp_member_id=$2 WHERE id=$1", [
          people.N1.contact,
          otherMember,
        ]);
        assert.equal((await sendPreview(campaign)).sendable, 1);
        assert.equal((await approve(campaign, 1)).ok, true);
        providerCalls.length = 0;
        provider = accepted;
        await deliver(campaign, await leaseCampaignJob(campaign));
        assert.deepEqual(
          providerCalls.map((call) => call.memberId),
          [people.N2.member],
        );
        assert.equal(
          (await recipientRow(people.N1.recipient)).error,
          "CONTACT_CHANGED_SINCE_ATTEMPT",
        );
      });

      await t.test(
        "發送… refuses with SEND_COUNT_CHANGED when the server would queue another number",
        async () => {
          const source = "owned-fx10b-count";
          const [scoped] = await query(
            "INSERT INTO whatsapp_audiences(name,filters,created_by) VALUES('Owned FX-10b count audience',$1::jsonb,$2) RETURNING id",
            [JSON.stringify({ source }), staff.id],
          );
          const { campaign, people } = await seedRetryCampaign(["S1", "S2"], {
            audienceId: scoped.id,
            source,
            queue: false,
            status: "review",
          });
          await setRecipient(people.S1, "sent", null, true);
          await setRecipient(people.S2, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          assert.equal((await requeue(campaign, actor, 1)).requeued, 1);
          // Review M3, the same-phone edge: an earlier queued row on the same
          // phone has left the audience. Before materialise it still holds the
          // phone, so the preview leaves the later row out.
          // The same phone in its two stored formats (normalized_phone is unique).
          const earlier = await addContact("SE", {
            phone: "85264449992",
            source: "owned-fx10b-gone",
          });
          const later = await addContact("SL", { phone: "64449992", source });
          await query(
            `INSERT INTO whatsapp_campaign_recipients(id,campaign_id,contact_id,status,queued_at)
             VALUES ('00000000-0000-4000-8000-000000010b01'::uuid,$1,$2,'queued',now())`,
            [campaign, earlier.contact],
          );
          const [laterRow] = await query(
            `INSERT INTO whatsapp_campaign_recipients(id,campaign_id,contact_id,status,queued_at)
             VALUES ('ffffffff-ffff-4fff-bfff-ffffffff0b01'::uuid,$1,$2,'queued',now()) RETURNING id`,
            [campaign, later.contact],
          );
          const shown = (await sendPreview(campaign)).sendable;
          assert.equal(shown, 1);
          const jobsBefore = await jobsOf(campaign);
          const queueAudits = async () =>
            (
              await query(
                "SELECT id FROM audit_logs WHERE action='campaign.queue' AND subject_id=$1",
                [campaign],
              )
            ).length;
          const auditsBefore = await queueAudits();

          // The server count after materialise is 2, so the shown 1 is refused.
          assert.deepEqual(
            {
              ...(await adminData.sendAdminCampaignQueue(campaign, actor, {
                expectedCount: shown,
              })),
              materialization: undefined,
            },
            { ok: false, error: "SEND_COUNT_CHANGED", sendable: 2, materialization: undefined },
          );
          // A missing count never matches either.
          assert.equal(
            (await adminData.sendAdminCampaignQueue(campaign, actor)).error,
            "SEND_COUNT_CHANGED",
          );
          assert.equal(await campaignStatus(campaign), "review");
          assert.deepEqual(await jobsOf(campaign), jobsBefore);
          assert.equal(await queueAudits(), auditsBefore);

          // The re-read number is the server number, and that approval sends it.
          assert.equal((await sendPreview(campaign)).sendable, 2);
          const approved = await approve(campaign);
          assert.equal(approved.ok, true);
          assert.equal(approved.queuedRecipients, 2);
          providerCalls.length = 0;
          provider = accepted;
          await deliver(campaign, await leaseCampaignJob(campaign));
          assert.deepEqual(
            providerCalls.map((call) => call.memberId).sort(),
            [people.S2.member, later.member].sort(),
          );
          assert.equal((await recipientRow(laterRow.id)).status, "sent");
        },
      );

      // FX-10b final fix wave, I2: a campaign with history left in 待審核 with
      // nothing sendable can be finished instead of cancelled.
      const finish = (campaignId, who = actor) =>
        adminData.finishCampaignWithoutSending({ campaignId }, who);
      const finishAudits = (campaignId) =>
        query(
          "SELECT actor_id, metadata FROM audit_logs WHERE action='campaign.finished_without_sending' AND subject_id=$1",
          [campaignId],
        );
      const listedRow = async (campaignId) =>
        (await adminData.listAdminCampaigns()).find((row) => row.id === campaignId);

      await t.test(
        "a stuck 待審核 campaign with nothing sendable finishes as completed, once",
        async () => {
          const { campaign, people } = await seedRetryCampaign(["F1", "F2", "F3"], {
            queue: false,
            status: "completed",
          });
          await setRecipient(people.F1, "sent", null, true);
          await setRecipient(people.F2, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          await setRecipient(people.F3, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          assert.equal((await requeue(campaign, actor, 2)).requeued, 2);
          assert.equal(await campaignStatus(campaign), "review");

          // While a row is still sendable the server refuses and changes nothing.
          assert.equal((await listedRow(campaign)).finishable, false);
          assert.equal((await sendPreview(campaign)).finishable, false);
          assert.deepEqual(await finish(campaign), {
            ok: false,
            error: "CAMPAIGN_HAS_SENDABLE",
            sendable: 2,
          });
          assert.equal((await recipientRow(people.F2.recipient)).status, "queued");
          assert.equal((await finishAudits(campaign)).length, 0);

          // Both waiting contacts opt out: 發送… has nobody left to send to.
          await query(
            "UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id = ANY($1::uuid[])",
            [[people.F2.contact, people.F3.contact]],
          );
          assert.deepEqual(await sendPreview(campaign), {
            campaignId: campaign,
            deliveryStarted: true,
            sendable: 0,
            finishable: true,
          });
          assert.equal((await listedRow(campaign)).finishable, true);
          await assert.rejects(
            () => finish(campaign, agentActor),
            (error) => error instanceof Response && error.status === 403,
          );
          const jobsBefore = await jobsOf(campaign);
          providerCalls.length = 0;
          const done = await finish(campaign);
          assert.deepEqual(done, { ok: true, status: "completed", blocked: 2 });
          for (const label of ["F2", "F3"]) {
            const row = await recipientRow(people[label].recipient);
            assert.deepEqual(
              [row.status, row.error, row.dispatch_started_at],
              ["blocked", "CAMPAIGN_FINISHED_NOT_SENDABLE", null],
              label,
            );
          }
          assert.equal((await recipientRow(people.F1.recipient)).status, "sent");
          assert.equal(await campaignStatus(campaign), "completed");
          assert.deepEqual(await jobsOf(campaign), jobsBefore);
          assert.equal(providerCalls.length, 0);
          const audits = await finishAudits(campaign);
          assert.equal(audits.length, 1);
          assert.equal(audits[0].actor_id, staff.id);
          assert.deepEqual(audits[0].metadata, {
            campaignId: campaign,
            status: "completed",
            blocked: 2,
            total: 3,
            sent: 1,
            failed: 0,
            previouslyBlocked: 0,
          });
          assertNoContactData(audits[0].metadata);
          assert.equal((await listedRow(campaign)).finishable, false);

          // Idempotent: a repeat changes nothing and writes no second audit.
          assert.deepEqual(await finish(campaign), {
            ok: true,
            status: "completed",
            blocked: 0,
            alreadyFinished: true,
          });
          assert.equal((await finishAudits(campaign)).length, 1);
        },
      );

      await t.test(
        "finishing a campaign that sent nothing marks it failed; an inactive template counts as nothing sendable",
        async () => {
          const [ownTemplate] = await query(
            "INSERT INTO whatsapp_templates(element_name,status) VALUES('owned_finish_template','active') RETURNING id",
          );
          const { campaign, people } = await seedRetryCampaign(["G1", "G2"], {
            queue: false,
            status: "failed",
            templateId: ownTemplate.id,
          });
          await setRecipient(people.G1, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          await setRecipient(people.G2, "failed", "WOZTELL_DELIVERY_UNKNOWN", true);
          assert.equal((await requeue(campaign, actor, 1)).requeued, 1);
          assert.equal((await sendPreview(campaign)).finishable, false);
          await query("UPDATE whatsapp_templates SET status='inactive' WHERE id=$1", [
            ownTemplate.id,
          ]);
          assert.equal((await sendPreview(campaign)).finishable, true);
          assert.equal((await listedRow(campaign)).finishable, true);
          assert.deepEqual(await finish(campaign), { ok: true, status: "failed", blocked: 1 });
          assert.equal(
            (await recipientRow(people.G1.recipient)).error,
            "CAMPAIGN_FINISHED_NOT_SENDABLE",
          );
          // The unknown row is history and is left exactly as it was.
          assert.equal((await recipientRow(people.G2.recipient)).error, "WOZTELL_DELIVERY_UNKNOWN");
          assert.equal(await campaignStatus(campaign), "failed");
        },
      );

      await t.test(
        "requeued legacy rows keep campaign history so a re-send never widens the audience",
        async () => {
          // Re-review N1: today's production shape. Every row was refused
          // before the migration, so none has a digest, and the refusal cleared
          // dispatch_started_at. Written directly to simulate that data.
          const source = "owned-fx10b-legacy";
          const [scoped] = await query(
            "INSERT INTO whatsapp_audiences(name,filters,created_by) VALUES('Owned FX-10b legacy audience',$1::jsonb,$2) RETURNING id",
            [JSON.stringify({ source }), staff.id],
          );
          const [otherAudience] = await query(
            "INSERT INTO whatsapp_audiences(name,created_by) VALUES('Owned FX-10b legacy other',$1) RETURNING id",
            [staff.id],
          );
          const { campaign, people } = await seedRetryCampaign(["Y1", "Y2"], {
            audienceId: scoped.id,
            source,
            queue: false,
            status: "failed",
          });
          await setRecipient(people.Y1, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          await setRecipient(people.Y2, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          await query(
            "UPDATE whatsapp_campaign_recipients SET attempted_identity=NULL WHERE campaign_id=$1",
            [campaign],
          );
          // Three more contacts now match the audience but were never part of it.
          const newcomers = [];
          for (const label of ["YN1", "YN2", "YN3"])
            newcomers.push(await addContact(label, { source }));

          assert.equal((await requeue(campaign, actor, 2)).requeued, 2);
          // Fix 1: the requeue stamps the identity the attempt was checked against.
          for (const label of ["Y1", "Y2"]) {
            assert.match(
              String(await attemptedIdentity(people[label].recipient)),
              /^[0-9a-f]{64}$/,
              label,
            );
          }
          const shown = await sendPreview(campaign);
          assert.equal(shown.deliveryStarted, true);
          assert.equal(shown.sendable, 2);
          assert.equal((await listedRow(campaign)).delivery_started, true);

          // Fix 2: even with no digest left, an audited requeue is history.
          await query(
            "UPDATE whatsapp_campaign_recipients SET attempted_identity=NULL WHERE campaign_id=$1",
            [campaign],
          );
          assert.equal((await sendPreview(campaign)).deliveryStarted, true);
          assert.equal((await listedRow(campaign)).delivery_started, true);

          // The freeze still applies: the audience cannot be swapped first.
          assert.deepEqual(
            await adminData.saveAdminCampaign(
              {
                id: campaign,
                name: "Owned FX-10b retry campaign",
                template_id: template.id,
                audience_id: otherAudience.id,
                status: "review",
                scheduled_at: null,
              },
              actor,
            ),
            { id: "", error: "CAMPAIGN_HAS_DELIVERY_HISTORY" },
          );
          // SEND_COUNT_CHANGED still applies: the audience size is refused.
          assert.equal(
            (await adminData.sendAdminCampaignQueue(campaign, actor, { expectedCount: 5 })).error,
            "SEND_COUNT_CHANGED",
          );
          const approved = await approve(campaign, 2);
          assert.equal(approved.ok, true);
          assert.equal(approved.queuedRecipients, 2);
          for (const person of newcomers) {
            assert.equal(
              (
                await query(
                  "SELECT id FROM whatsapp_campaign_recipients WHERE campaign_id=$1 AND contact_id=$2",
                  [campaign, person.contact],
                )
              ).length,
              0,
            );
          }
          assert.equal((await recipientsOf(campaign)).length, 2);
          providerCalls.length = 0;
          provider = accepted;
          await deliver(campaign, await leaseCampaignJob(campaign));
          assert.deepEqual(
            providerCalls.map((call) => call.memberId).sort(),
            [people.Y1.member, people.Y2.member].sort(),
          );
        },
      );

      await t.test(
        "a requeue is refused up front when the template is inactive or the audience is gone",
        async () => {
          const [ownTemplate] = await query(
            "INSERT INTO whatsapp_templates(element_name,status) VALUES('owned_requeue_gate','inactive') RETURNING id",
          );
          const gated = await seedRetryCampaign(["R1"], {
            queue: false,
            status: "failed",
            templateId: ownTemplate.id,
          });
          await setRecipient(gated.people.R1, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          assert.deepEqual(await requeue(gated.campaign, actor, 1), {
            ok: false,
            error: "TEMPLATE_NOT_ACTIVE",
          });
          assert.equal((await recipientRow(gated.people.R1.recipient)).status, "failed");
          assert.equal(await campaignStatus(gated.campaign), "failed");
          assert.equal((await requeueAudits(gated.campaign)).length, 0);

          const [gone] = await query(
            "INSERT INTO whatsapp_audiences(name,created_by) VALUES('Owned FX-10b deleted audience',$1) RETURNING id",
            [staff.id],
          );
          const orphan = await seedRetryCampaign(["R2"], {
            queue: false,
            status: "failed",
            audienceId: gone.id,
          });
          await setRecipient(orphan.people.R2, "failed", "WOZTELL_PROVIDER_REJECTED", false);
          await query("DELETE FROM whatsapp_audiences WHERE id=$1", [gone.id]);
          assert.deepEqual(await requeue(orphan.campaign, actor, 1), {
            ok: false,
            error: "AUDIENCE_NOT_FOUND",
          });
          assert.equal(await campaignStatus(orphan.campaign), "failed");
        },
      );

      await t.test("finishing is refused without history or outside 待審核", async () => {
        const fresh = await seedRetryCampaign(["H1"], { queue: false, status: "review" });
        await query("UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1", [
          fresh.people.H1.contact,
        ]);
        assert.deepEqual(await finish(fresh.campaign), {
          ok: false,
          error: "CAMPAIGN_NOT_FINISHABLE",
        });
        assert.equal((await listedRow(fresh.campaign)).finishable, false);
        const done = await seedRetryCampaign(["H2"], { queue: false, status: "completed" });
        await setRecipient(done.people.H2, "sent", null, true);
        assert.deepEqual(await finish(done.campaign), {
          ok: false,
          error: "CAMPAIGN_NOT_FINISHABLE",
        });
        assert.deepEqual(await finish("not-a-uuid"), { ok: false, error: "Campaign not found" });
        assert.equal((await finishAudits(done.campaign)).length, 0);
      });

      await t.test(
        "the attempted-identity migration is re-runnable and writes no row",
        async () => {
          const { readFileSync } = await import("node:fs");
          const file = new URL(
            "../../../neon/migrations/20261010100000_campaign_attempted_identity.sql",
            import.meta.url,
          );
          const source = readFileSync(file, "utf8");
          const comments = source
            .split("\n")
            .filter((line) => line.trim().startsWith("--"))
            .join("\n");
          assert.doesNotMatch(comments, /[;']/, "apply-migrations.mjs splits on ; and '");
          assert.match(source, /^SET LOCAL lock_timeout = '5s';$/m);
          const before = await query(
            "SELECT id, xmin::text AS xmin, attempted_identity FROM whatsapp_campaign_recipients ORDER BY id",
          );
          assert.ok(before.length > 0);
          await transaction([{ statement: source }]);
          await transaction([{ statement: source }]);
          const after = await query(
            "SELECT id, xmin::text AS xmin, attempted_identity FROM whatsapp_campaign_recipients ORDER BY id",
          );
          assert.deepEqual(after, before);
          const [column] = await query(
            `SELECT data_type, is_nullable, column_default FROM information_schema.columns
           WHERE table_name='whatsapp_campaign_recipients' AND column_name='attempted_identity'`,
          );
          assert.deepEqual(column, { data_type: "text", is_nullable: "YES", column_default: null });
        },
      );

      // FX-17a D-13: 已排期 and its time never sent anything. A campaign in that
      // status waits (no job, no recipients) until 發送…, which re-materialises
      // the audience with the opt-out, consent and duplicate-phone checks.
      await t.test(
        "a 已排期 campaign is never sent by itself; 發送… re-checks opt-out, consent and duplicates",
        async () => {
          const source = "owned-fx17a-scheduled";
          const [scoped] = await query(
            "INSERT INTO whatsapp_audiences(name,filters,created_by) VALUES('Owned FX-17a scheduled audience',$1::jsonb,$2) RETURNING id",
            [JSON.stringify({ source }), staff.id],
          );
          const stored = "2026-10-01T02:00:00.000Z";
          const [campaign] = await query(
            "INSERT INTO whatsapp_campaigns(name,template_id,audience_id,status,scheduled_at,created_by) VALUES('Owned FX-17a scheduled campaign',$1,$2,'scheduled',$3,$4) RETURNING id",
            [template.id, scoped.id, stored, staff.id],
          );
          const ok = await addContact("S1", { source });
          const optedOut = await addContact("S2", { source });
          const noConsent = await addContact("S3", { source });
          // The same number written without the 852 prefix: one person, one message.
          const duplicate = await addContact("S4", { source, phone: ok.phone.slice(3) });
          await query("UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1", [
            optedOut.contact,
          ]);
          await query("UPDATE crm_contacts SET opt_in_whatsapp=false WHERE id=$1", [
            noConsent.contact,
          ]);

          // The stored time is in the past; nothing has queued, materialised or sent it.
          assert.equal(await campaignStatus(campaign.id), "scheduled");
          assert.deepEqual(await jobsOf(campaign.id), []);
          assert.deepEqual(await recipientsOf(campaign.id), []);

          providerCalls.length = 0;
          const result = await adminData.sendAdminCampaignQueue(campaign.id, actor);
          assert.equal(result.ok, true);
          assert.equal(result.materialization.eligible, 1);
          assert.equal(result.materialization.optedOut, 1);
          assert.equal(result.materialization.notOptedIn, 1);
          assert.equal(result.materialization.duplicatePhone, 1);
          assert.equal(result.queuedRecipients, 1);
          const rows = await query(
            "SELECT contact_id::text AS contact, status FROM whatsapp_campaign_recipients WHERE campaign_id=$1",
            [campaign.id],
          );
          assert.equal(rows.length, 1);
          assert.ok([ok.contact, duplicate.contact].includes(rows[0].contact));
          assert.equal(rows[0].status, "queued");
          assert.equal(await campaignStatus(campaign.id), "queued");
          // The stored schedule value is left exactly as it was.
          const [{ scheduled_at: after }] = await query(
            "SELECT scheduled_at FROM whatsapp_campaigns WHERE id=$1",
            [campaign.id],
          );
          assert.equal(new Date(after).toISOString(), stored);

          provider = accepted;
          await deliver(campaign.id, await leaseCampaignJob(campaign.id));
          assert.equal(providerCalls.length, 1);
          assert.ok([ok.member, duplicate.member].includes(providerCalls[0].memberId));
          assert.equal(
            providerCalls.some((call) =>
              [optedOut.member, noConsent.member].includes(call.memberId),
            ),
            false,
          );
        },
      );

      await t.test("no recipient gets two accepted sends: every provider call in this file", () => {
        assert.ok(allProviderCalls.length > 0);
        const acceptedPerMember = new Map();
        for (const call of allProviderCalls) {
          if (!call.accepted) continue;
          acceptedPerMember.set(call.memberId, (acceptedPerMember.get(call.memberId) ?? 0) + 1);
        }
        for (const [memberId, accepted] of acceptedPerMember) {
          assert.ok(accepted <= 1, `${memberId} was accepted ${accepted} times`);
        }
      });
    });
    assert.equal(network.mock.calls.length, 0);
  },
);
