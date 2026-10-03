import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test(
  "campaign recovery preserves one original queue job and existing dispatch boundaries",
  { timeout: 120000 },
  async (t) => {
    const network = t.mock.method(globalThis, "fetch", () => {
      throw Error("Provider/network request forbidden in owned cancellation acceptance");
    });
    await withOwnedPostgres(async ({ query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
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
    });
    assert.equal(network.mock.calls.length, 0);
  },
);
