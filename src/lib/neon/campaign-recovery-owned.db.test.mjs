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
      let provider = () => ({
        status: 200,
        body: { ok: 1, messageId: `wamid.synthetic-fx10b-${providerCalls.length}` },
      });
      mock.module(new URL("../woztell/provider-fetch.ts", import.meta.url).href, {
        exports: {
          boundedProviderFetch: async (_url, init) => {
            const { memberId } = JSON.parse(init.body);
            const out = await provider(memberId);
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
    });
    assert.equal(network.mock.calls.length, 0);
  },
);
