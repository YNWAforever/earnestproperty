import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test("EP-06 owned setup saves provider evidence, version and audit; capabilities remain independent", async (t) => {
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
      await t.test(
        "EP-15 original test request survives response loss and repeated reads/replays without a new intent",
        async () => {
          const testEnvironment = {
            EP_WA_ENQUIRY_MODE: "active",
            EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
            EP_WA_INBOX_VERIFICATION_REF: "owned-only-verification",
            EP_WA_INBOX_SIGNATURE: "owned-only-signature",
            WOZTELL_APP_ID: "owned-only-app",
            EP_WA_INBOX_LIST_THREADS_URL: "https://api.inbox.woztell.sanuker.com/test/threads",
            EP_WA_INBOX_LIST_USERS_URL: "https://api.inbox.woztell.sanuker.com/test/users",
            EP_WA_INBOX_ASSIGN_URL: "https://api.inbox.woztell.sanuker.com/test/assign",
            EP_WA_INBOX_INTERNAL_MESSAGE_URL: "https://api.inbox.woztell.sanuker.com/test/notes",
            EP_WA_TEST_INBOX_MEMBER_ID: "owned-only-no-customer-thread",
          };
          const oldEnvironment = Object.fromEntries(
            Object.keys(testEnvironment).map((key) => [key, process.env[key]]),
          );
          Object.assign(process.env, testEnvironment);
          const wakes = [];
          mock.module(new URL("../control-plane/job-wake.server.ts", import.meta.url).href, {
            exports: { wakeAfterCommit: (lane) => wakes.push(lane), laneForJob: () => "service" },
          });
          try {
            const { saveStaffEndpoint } = await import("./staff-endpoints.server.ts");
            const {
              previewStaffTestNotification,
              enqueueStaffTestNotification,
              readStaffTestNotificationByRequest,
            } = await import("./whatsapp-test-notification.server.ts");
            const endpoint = await saveStaffEndpoint(
              {
                staffId: staff.id,
                transport: "inbox_private_note",
                permissionRef: "owned-only-consent",
                allowAllHours: true,
                enabled: true,
              },
              actor,
              { query, transaction },
            );
            const preview = await previewStaffTestNotification(
              {
                staffId: staff.id,
                transport: "inbox_private_note",
                endpointVersion: endpoint.version,
              },
              actor,
              query,
            );
            assert.equal(preview.ready, true);
            const request = {
              staffId: staff.id,
              transport: "inbox_private_note",
              endpointVersion: endpoint.version,
              previewToken: preview.previewToken,
              requestId: randomUUID(),
            };
            let committed;
            await assert.rejects(async () => {
              committed = await enqueueStaffTestNotification(request, actor, {
                query,
                transaction,
              });
              throw Error("owned-response-lost-after-commit");
            }, /owned-response-lost-after-commit/);
            await query(
              "UPDATE staff_notification_test_attempts SET state='unknown',safe_error='owned_response_unknown' WHERE id=$1",
              [committed.attemptId],
            );
            const readback = await readStaffTestNotificationByRequest(
              request.requestId,
              actor,
              query,
            );
            assert.equal(readback.attemptId, committed.attemptId);
            assert.equal(readback.jobId, committed.jobId);
            assert.equal(readback.state, "unknown");
            assert.equal(readback.endpointVersion, endpoint.version);
            assert.equal(readback.providerAcceptedAt, null);
            assert.equal(readback.providerDeliveredAt, null);
            assert.equal(readback.recipientConfirmedAt, null);
            const replays = await Promise.all(
              [1, 2].map(() =>
                enqueueStaffTestNotification(request, actor, { query, transaction }),
              ),
            );
            assert.ok(
              replays.every(
                (row) =>
                  row.attemptId === committed.attemptId &&
                  row.jobId === committed.jobId &&
                  row.state === "unknown",
              ),
            );
            const [other] = await query(
              "INSERT INTO staff_users(auth_user_id) VALUES('owned-other-reviewer') RETURNING id",
            );
            await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [
              other.id,
            ]);
            assert.equal(
              await readStaffTestNotificationByRequest(
                request.requestId,
                { staffId: other.id, roles: ["manager"] },
                query,
              ),
              null,
            );
            await assert.rejects(
              enqueueStaffTestNotification(
                request,
                { staffId: other.id, roles: ["manager"] },
                { query, transaction },
              ),
              (e) => e instanceof Response && e.status === 409,
            );
            assert.equal(
              (await query("SELECT count(*)::int n FROM staff_notification_test_attempts"))[0].n,
              1,
            );
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM ops_jobs WHERE job_type='woztell.enquiry.staff.test'",
                )
              )[0].n,
              1,
            );
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM ops_audit_logs WHERE permission='staff.notification.test' AND request_id=$1",
                  [request.requestId],
                )
              )[0].n,
              1,
            );
            assert.deepEqual(wakes, ["service"]);
            assert.equal(
              (await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n,
              0,
            );
          } finally {
            for (const [key, value] of Object.entries(oldEnvironment))
              value === undefined ? delete process.env[key] : (process.env[key] = value);
          }
        },
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
