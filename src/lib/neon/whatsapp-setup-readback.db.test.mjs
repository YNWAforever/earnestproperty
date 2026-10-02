import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test("EP-06 owned setup saves provider evidence, version and audit; capabilities remain independent", async () => {
  await withOwnedPostgres(async ({ query, transaction }) => {
    await mockOwnedServerDb(mock, query, transaction);
    const { saveInboxFolder, verifyInboxSelection } = await import("./inbox-directory.server.ts");
    const { saveReviewedStaffChannel } = await import("./staff-mapping-review.server.ts");
    const { listWhatsappStaffReadiness } = await import("./whatsapp-readiness.server.ts");
    const original = {
      channel: process.env.EP_WA_COMPANY_CHANNEL_ID,
      integration: process.env.EP_WA_INBOX_INTEGRATION_ID,
    };
    process.env.EP_WA_COMPANY_CHANNEL_ID = "synthetic-owned-channel";
    process.env.EP_WA_INBOX_INTEGRATION_ID = "synthetic-owned-integration";
    try {
      const [admin, staff] = await query(
        "INSERT INTO staff_users(auth_user_id,name_zh) VALUES('qa-setup-admin','合成主管'),('qa-setup-agent','同名同事') RETURNING id",
      );
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'admin'),($2,'agent')", [
        admin.id,
        staff.id,
      ]);
      const actor = { staffId: admin.id, roles: ["admin"] };
      const ports = {
        query,
        rateLimit: async () => {},
        provider: {
          listUsers: async ({ after }) =>
            after
              ? {
                  items: [
                    {
                      userId: "synthetic-owned-user",
                      channelId: "synthetic-owned-channel",
                      name: "同名同事",
                    },
                  ],
                  nextCursor: null,
                }
              : { items: [], nextCursor: "page2" },
        },
      };
      await saveInboxFolder(
        {
          folderKey: "company-sales",
          displayName: "合成接單群組",
          providerFolderId: "synthetic-owned-folder",
          expectedVersion: null,
        },
        actor,
        ports,
      );
      const input = {
        staffId: staff.id,
        userId: "synthetic-owned-user",
        folderKey: "company-sales",
        expectedVersion: null,
      };
      const review = await verifyInboxSelection(input, actor, ports);
      assert.equal(review.result, "verified");
      const saved = await saveReviewedStaffChannel(
        { staffId: staff.id, expectedVersion: null, evidenceId: review.evidenceId, eligible: true },
        actor,
        { query },
      );
      const [readback] = await query(
        "SELECT m.*,e.result,e.provider_scope FROM whatsapp_staff_channels m JOIN whatsapp_staff_mapping_reviews e ON e.id=m.review_evidence_id WHERE m.id=$1",
        [saved.mappingId],
      );
      assert.equal(readback.version, saved.version);
      assert.equal(readback.result, "verified");
      assert.equal(readback.provider_scope, "synthetic-owned-integration");
      assert.equal(readback.inbox_user_id, input.userId);
      assert.equal(
        (
          await query(
            "SELECT count(*)::int n FROM audit_logs WHERE subject_id=$1 AND action='whatsapp.mapping.review'",
            [saved.mappingId],
          )
        )[0].n,
        1,
      );
      const runtime = {
        channelId: "synthetic-owned-channel",
        assignmentEnabled: true,
        notificationsEnabled: false,
        staffWhatsAppEnabled: false,
        inboxProviderVerified: true,
        staffTransportVerified: false,
        templateContractVerified: false,
      };
      const readiness = (await listWhatsappStaffReadiness(actor, { query, runtime })).find(
        (s) => s.staffId === staff.id,
      );
      assert.equal(readiness.assignment.state, "ready");
      assert.notEqual(readiness.staffWhatsapp.state, "ready");
      assert.equal((await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n, 0);
      await assert.rejects(
        saveReviewedStaffChannel(
          {
            staffId: staff.id,
            expectedVersion: null,
            evidenceId: review.evidenceId,
            eligible: true,
          },
          actor,
          { query },
        ),
        (e) => e instanceof Response && e.status === 409,
      );
      const outage = {
        ...ports,
        provider: {
          listUsers: async () => {
            throw new Error("WOZTELL_INBOX_UNAVAILABLE");
          },
        },
      };
      await assert.rejects(
        verifyInboxSelection({ ...input, expectedVersion: saved.version }, actor, outage),
        (e) => e instanceof Response && e.status === 503,
      );
      const wrongIdentity = {
        ...ports,
        provider: {
          listUsers: async () => ({
            items: [
              {
                userId: "different-same-name-user",
                channelId: "synthetic-owned-channel",
                name: "同名同事",
              },
            ],
            nextCursor: null,
          }),
        },
      };
      await assert.rejects(
        verifyInboxSelection({ ...input, expectedVersion: saved.version }, actor, wrongIdentity),
        (e) => e instanceof Response && e.status === 502,
      );
      await query("UPDATE staff_users SET active=false WHERE id=$1", [staff.id]);
      await assert.rejects(
        verifyInboxSelection({ ...input, expectedVersion: saved.version }, actor, ports),
        (e) => e instanceof Response && e.status === 409,
      );
      assert.equal(
        (await query("SELECT count(*)::int n FROM whatsapp_staff_mapping_reviews"))[0].n,
        1,
      );
    } finally {
      for (const [key, value] of [
        ["EP_WA_COMPANY_CHANNEL_ID", original.channel],
        ["EP_WA_INBOX_INTEGRATION_ID", original.integration],
      ])
        value === undefined ? delete process.env[key] : (process.env[key] = value);
    }
  });
});
