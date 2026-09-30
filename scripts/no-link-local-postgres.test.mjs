import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import test, { mock } from "node:test";
import pg from "pg";
import { MIGRATION_VERSIONS } from "../src/lib/control-plane/migration-versions.js";

const root = new URL("../", import.meta.url);
const sample = JSON.parse(
  readFileSync(
    new URL("../src/lib/whatsapp-enquiries/fixtures/portal-enquiries.json", import.meta.url),
    "utf8",
  ),
).golden28hse;
const image =
  "pgvector/pgvector@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0";

function docker(...args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
  if (result.error || result.status !== 0)
    throw new Error(`Local Docker failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}

// Never accepts DATABASE_URL, TEST_DATABASE_URL or a remote endpoint. The port is
// discovered only from the brand-new, uniquely named loopback container we own.
async function withDisposablePostgres(run) {
  const name = `earnest-no-link-qa-${randomUUID()}`;
  let containerId;
  let pool;
  try {
    containerId = docker(
      "run",
      "--rm",
      "--pull",
      "never",
      "--detach",
      "--name",
      name,
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "--publish",
      "127.0.0.1::5432",
      image,
    );
    assert.match(containerId, /^[a-f0-9]{64}$/);
    const metadata = JSON.parse(docker("inspect", containerId))[0];
    assert.equal(metadata.Name, `/${name}`);
    assert.equal(metadata.Config.Image, image);
    const bindings = metadata.NetworkSettings.Ports["5432/tcp"];
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].HostIp, "127.0.0.1");
    pool = new pg.Pool({
      host: "127.0.0.1",
      port: Number(bindings[0].HostPort),
      user: "postgres",
      database: "postgres",
      max: 8,
      connectionTimeoutMillis: 2000,
      statement_timeout: 15000,
    });
    for (let i = 0; ; i++) {
      try {
        await pool.query("SELECT 1");
        break;
      } catch (error) {
        if (i === 60) throw error;
        await delay(200);
      }
    }
    let effectSqlCalls = 0;
    const query = async (sql, params = []) => {
      if (/SELECT wa_prepare_no_link_followup/i.test(sql)) effectSqlCalls++;
      return (await pool.query(sql, params)).rows;
    };
    const transaction = async (statements) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const results = [];
        for (const { statement, params = [] } of statements)
          results.push((await client.query(statement, params)).rows);
        await client.query("COMMIT");
        return results;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    await query(
      "CREATE TABLE app_migrations(version text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    for (const version of MIGRATION_VERSIONS) {
      const sql = readFileSync(new URL(`neon/migrations/${version}`, root), "utf8");
      const client = await pool.connect();
      const transactional = !/ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE/i.test(sql);
      try {
        if (transactional) await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO app_migrations(version) VALUES($1)", [version]);
        if (transactional) await client.query("COMMIT");
      } catch (error) {
        if (transactional) await client.query("ROLLBACK");
        throw new Error(`Migration ${version}: ${error.message}`, { cause: error });
      } finally {
        client.release();
      }
    }
    assert.equal(
      (await query("SELECT count(*)::int n FROM app_migrations"))[0].n,
      MIGRATION_VERSIONS.length,
    );
    await run({ pool, query, transaction, containerId, effectCalls: () => effectSqlCalls });
  } finally {
    await pool?.end();
    if (containerId) {
      const metadata = JSON.parse(docker("inspect", containerId))[0];
      assert.equal(metadata.Name, `/${name}`);
      assert.equal(metadata.Config.Image, image);
      docker("stop", containerId);
    }
  }
}

test(
  "one local Postgres environment: signed exact sample to confirmed assignment and delivered human reply",
  { timeout: 240000 },
  async (t) => {
    await withDisposablePostgres(async ({ pool, query, transaction, effectCalls }) => {
      const actualDb = await import("../src/lib/neon/db.server.ts");
      mock.module(new URL("../src/lib/neon/db.server.ts", import.meta.url).href, {
        exports: {
          ...actualDb,
          queryRows: query,
          transactionRows: transaction,
          getSql: () => {
            throw new Error("Remote SQL forbidden in local integration");
          },
        },
      });
      let networkCalls = 0;
      t.mock.method(globalThis, "fetch", () => {
        networkCalls++;
        throw new Error("Network effect forbidden in local integration");
      });
      const ids = {
        s1: randomUUID(),
        s2: randomUUID(),
        manager: randomUUID(),
        branch: randomUUID(),
        property: randomUUID(),
        policy: randomUUID(),
        activation: randomUUID(),
        observation: randomUUID(),
      };
      const channel = "synthetic-company",
        app = "synthetic-app";
      const environment = {
        EP_WA_ENQUIRY_MODE: "active",
        EP_WA_COMPANY_CHANNEL_ID: channel,
        EP_WA_ACTIVATION_ID: ids.activation,
        EP_WA_NO_LINK_EFFECTS_ENABLED: "true",
        EP_WA_NO_LINK_CANARY_CHANNEL_ID: channel,
        EP_WA_NO_LINK_CANARY_ACTIVATION_ID: ids.activation,
        EP_WA_NO_LINK_CANARY_STAFF_IDS: ids.s1,
        EP_WA_ROUTING_ENABLED: "true",
        EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
        EP_WA_SERVICE_AUTOMATION_ENABLED: "false",
        OPS_EVENT_WAKE_ENABLED: "false",
      };
      const oldEnvironment = Object.fromEntries(
        Object.keys(environment).map((key) => [key, process.env[key]]),
      );
      Object.assign(process.env, environment);
      try {
        const { handleWoztellWebhook } =
          await import("../src/lib/whatsapp-enquiries/webhook.server.ts");
        const { observeEnquiryEvent } =
          await import("../src/lib/whatsapp-enquiries/workflow.server.ts");
        const { executeAssignment, reconcileAssignment } =
          await import("../src/lib/whatsapp-enquiries/assignment.server.ts");
        const { listMyStaffNotifications, acknowledgeStaffAssignment } =
          await import("../src/lib/neon/staff-notifications.server.ts");
        const { enqueueOutboundIntent, deliverOutboundIntent } =
          await import("../src/lib/woztell/outbound-intent.server.ts");
        const config = { channelId: channel, appId: app, channelSecret: "synthetic-only-secret" };
        const signedWebhook = async (payload) => {
          const body = JSON.stringify(payload);
          return handleWoztellWebhook(
            new Request("https://example.invalid/api/woztell/webhook", {
              method: "POST",
              body,
              headers: {
                "x-woztell-signature": createHmac("sha256", config.channelSecret)
                  .update(body)
                  .digest("base64"),
              },
            }),
            { config },
          );
        };
        await query(
          "INSERT INTO branches(id,slug,name) VALUES($1,'synthetic','Synthetic Branch')",
          [ids.branch],
        );
        await query(
          "INSERT INTO staff_users(id,email,name_zh,name_en,active,branch_id) VALUES($1,'s1@example.invalid','合成同事一','Synthetic S1',true,$4),($2,'s2@example.invalid','合成同事二','Synthetic S2',true,$4),($3,'manager@example.invalid','合成主管','Synthetic Manager',true,$4)",
          [ids.s1, ids.s2, ids.manager, ids.branch],
        );
        await query(
          "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent'),($2,'agent'),($3,'manager')",
          [ids.s1, ids.s2, ids.manager],
        );
        await query(
          "INSERT INTO whatsapp_service_policies(id,version,status,rules,effective_at,approved_by,copy_version) VALUES($1,1,'approved',$2::jsonb,now()-interval '5 minutes',$3,'synthetic-copy-v1')",
          [
            ids.policy,
            JSON.stringify({ freshnessSeconds: 86400, managerStaffId: ids.manager }),
            ids.manager,
          ],
        );
        await query(
          "INSERT INTO whatsapp_enquiry_activations(id,mode,policy_id,cutover_at,created_by) VALUES($1,'active',$2,now()-interval '1 minute',$3)",
          [ids.activation, ids.policy, ids.manager],
        );
        const [run] = await query(
          "INSERT INTO listing_sync_runs(scheduled_for,mode,status,parser_version) VALUES(current_date,'shadow','running','synthetic-parser') RETURNING id",
        );
        await query(
          "INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version) VALUES('28hse_agent_540','agent:540','synthetic-v1','synthetic-parser')",
        );
        const [mlsReceipt] = await query(
          "INSERT INTO mls_ingestion_receipts(source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,response) VALUES('28hse_agent_540','agent:540','synthetic-v1','synthetic-parser',now()-interval '1 minute',repeat('a',64),$1,'{}') RETURNING id",
          [run.id],
        );
        await query(
          "INSERT INTO listing_source_observations(id,run_id,source,external_listing_id,deal_type,source_url,payload,content_hash,validation_state,discovered_at,fetched_at) VALUES($1,$2,'28hse_agent_540','4033349','sale','https://www.28hse.com/buy/apartment/property-4033349','{}',repeat('a',64),'valid',now()-interval '1 minute',now()-interval '1 minute')",
          [ids.observation, run.id],
        );
        await query(
          "INSERT INTO properties(id,listing_no,title_zh,deal_type,district_slug,status,agent_id) VALUES($1,'SYNTHETIC-P1','碧堤半島','sale','sham-tseng','active',$2)",
          [ids.property, ids.s1],
        );
        await query("SELECT assign_property_public_identity($1)", [ids.property]);
        await query(
          "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,'28hse_agent_540','4033349','sale','source_id_v2','active',now(),now(),$2)",
          [ids.property, run.id],
        );
        await query(
          "INSERT INTO mls_source_state(source,external_listing_id,deal_type,scope_id,policy_version,observation_id,last_receipt_id,property_id,source_status,first_seen_at,last_accepted_at) VALUES('28hse_agent_540','4033349','sale','agent:540','synthetic-v1',$1,$2,$3,'active',now(),now())",
          [ids.observation, mlsReceipt.id, ids.property],
        );
        await query(
          "INSERT INTO whatsapp_portal_source_scopes(channel_id,source,scope_id,staff_namespace,enabled,verified_by,verified_at,verification_ref) VALUES($1,'28hse_agent_540','agent:540','synthetic-28hse-staff',true,$2,now()-interval '1 minute','SYNTHETIC-ONLY')",
          [channel, ids.manager],
        );
        await query(
          "INSERT INTO staff_external_references(namespace,external_reference,staff_id,mapping_version,valid_from,verified_by,verified_at,verification_ref) VALUES('synthetic-28hse-staff','鄧錦雄 Terence Tang',$1,1,now()-interval '1 minute',$2,now()-interval '1 minute','SYNTHETIC-ONLY')",
          [ids.s1, ids.manager],
        );
        const [mappingReview] = await query(
          "INSERT INTO whatsapp_staff_mapping_reviews(staff_id,channel_id,provider_scope,inbox_user_id,folder_id,basis,result,expires_at,actor_id,mapping_version) VALUES($1,$2,'synthetic-app','synthetic-s1-inbox','synthetic-folder','provider_verified','verified',now()+interval '1 hour',$3,1) RETURNING id",
          [ids.s1, channel, ids.manager],
        );
        await query(
          "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verification_ref,verified_at,verified_by,review_enforced,review_basis,review_evidence_id) VALUES($1,$2,'synthetic-s1-inbox','synthetic-folder','synthetic-node',true,'SYNTHETIC-ONLY',now()-interval '1 minute',$3,true,'provider_verified',$4)",
          [ids.s1, channel, ids.manager, mappingReview.id],
        );
        const payload = {
          type: "TEXT",
          eventType: "INBOUND",
          messageId: "synthetic-golden",
          member: "synthetic-customer",
          memberExtra: { name: "Synthetic Customer" },
          from: "85290000001",
          channel,
          app,
          timestamp: Math.floor(Date.now() / 1000),
          data: { text: sample },
        };
        const response = await signedWebhook(payload);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
        const [receipt] = await query("SELECT * FROM whatsapp_inbound_receipts");
        assert.equal(receipt.normalized_event.text, sample);
        assert.equal(receipt.projection_state, "projected");
        const [event] = await query(
          "SELECT * FROM whatsapp_enquiry_events ORDER BY received_at DESC LIMIT 1",
        );
        assert.ok(event, "signed inbound must create workflow event in full schema");
        assert.equal(event.capture_mode, "active");
        await observeEnquiryEvent(event.id, async () => {}, query);
        const [enquiry] = await query("SELECT * FROM inquiries WHERE id=$1", [
          event.inquiry_id ??
            (
              await query("SELECT inquiry_id FROM whatsapp_enquiry_events WHERE id=$1", [event.id])
            )[0].inquiry_id,
        ]);
        assert.equal(enquiry.property_id, ids.property);
        assert.equal(enquiry.name, "Synthetic Customer");
        assert.equal(enquiry.requested_staff_id, ids.s1);
        const [interpretation] = await query(
          "SELECT interpretation,resolution FROM whatsapp_portal_interpretations WHERE receipt_id=$1",
          [receipt.id],
        );
        assert.equal(interpretation.resolution[0].status, "resolved");
        const [decision] = await query(
          "SELECT * FROM whatsapp_no_link_effect_decisions WHERE event_id=$1",
          [event.id],
        );
        assert.equal(
          decision.decision,
          "assignment_pending",
          `full-schema golden decision: ${decision.reason}`,
        );
        const [reference] = await query(
          "SELECT * FROM whatsapp_enquiry_reference_links WHERE event_id=$1",
          [event.id],
        );
        assert.deepEqual(reference.resolution.snapshot, interpretation.resolution[0].snapshot);
        assert.equal(interpretation.interpretation.requestedStaffText, "鄧錦雄 Terence Tang");
        assert.equal(interpretation.interpretation.estateText, "碧堤半島");
        assert.equal(interpretation.interpretation.quotedPriceHkd, 12680000);
        assert.equal(
          interpretation.interpretation.references[0].canonicalUrl,
          "https://www.28hse.com/buy/apartment/property-4033349",
        );
        assert.equal(reference.external_listing_id, "4033349");
        assert.equal(reference.property_id, ids.property);
        assert.equal((await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n, 0);
        assert.equal((await query("SELECT count(*)::int n FROM whatsapp_link_opens"))[0].n, 0);
        assert.equal(enquiry.link_open_id, null);
        assert.equal(enquiry.attribution_method, "explicit_customer_statement");
        assert.equal((await signedWebhook(payload)).status, 200);
        assert.equal((await query("SELECT count(*)::int n FROM whatsapp_enquiry_events"))[0].n, 1);
        assert.equal((await query("SELECT count(*)::int n FROM inquiries"))[0].n, 1);
        const [assignment] = await query(
          "SELECT * FROM whatsapp_assignment_requests WHERE conversation_id=$1",
          [enquiry.conversation_id],
        );
        let assignmentsSent = 0;
        let actualAssignment = { inboxUserId: null, folderId: null };
        const provider = {
          execute: async (target) => {
            assignmentsSent++;
            assert.equal(target.channelId, channel);
            assert.equal(target.memberId, "synthetic-customer");
            assert.equal(target.inboxUserId, "synthetic-s1-inbox");
            await target.beforeSend();
            return { ok: 1 };
          },
          readAuthoritativeAssignment: async () => actualAssignment,
        };
        const ports = { query, transaction };
        assert.deepEqual(await executeAssignment(assignment.id, provider, ports), {
          state: "unknown",
        });
        assert.equal(
          (
            await query("SELECT confirmed_staff_id FROM whatsapp_conversations WHERE id=$1", [
              enquiry.conversation_id,
            ])
          )[0].confirmed_staff_id,
          null,
        );
        assert.equal(
          (await query("SELECT wa_can_reply_enquiry($1,$2) allowed", [ids.s1, enquiry.id]))[0]
            .allowed,
          false,
        );
        assert.equal(
          (await query("SELECT count(*)::int n FROM staff_notification_intents"))[0].n,
          0,
        );
        assert.deepEqual(await executeAssignment(assignment.id, provider, ports), {
          state: "blocked",
        });
        assert.equal(assignmentsSent, 1);
        assert.deepEqual(await reconcileAssignment(assignment.id, provider, ports), {
          confirmed: false,
        });
        actualAssignment = { inboxUserId: "synthetic-s1-inbox", folderId: "synthetic-folder" };
        assert.deepEqual(await reconcileAssignment(assignment.id, provider, ports), {
          confirmed: true,
        });
        assert.equal(
          (await query("SELECT wa_can_reply_enquiry($1,$2) allowed", [ids.s1, enquiry.id]))[0]
            .allowed,
          true,
        );
        assert.equal(
          (await query("SELECT wa_can_read_enquiry($1,$2) allowed", [ids.s2, enquiry.id]))[0]
            .allowed,
          false,
        );
        const actor = { staffId: ids.s1, roles: ["agent"] };
        const otherActor = { staffId: ids.s2, roles: ["agent"] };
        const notifications = await listMyStaffNotifications({ status: "all" }, actor, query);
        assert.equal(notifications.items.length, 1);
        const notification = notifications.items[0];
        assert.equal(notification.canAct, true);
        assert.equal(notification.acknowledgedAt, null);
        assert.equal(
          (await listMyStaffNotifications({ status: "all" }, otherActor, query)).items.length,
          0,
        );
        const ack = {
          notificationId: notification.id,
          expectedAssignmentVersion: notification.assignmentVersion,
        };
        await assert.rejects(
          acknowledgeStaffAssignment(ack, otherActor, ports),
          (error) => error instanceof Response && error.status === 409,
        );
        await assert.rejects(
          acknowledgeStaffAssignment(
            { ...ack, expectedAssignmentVersion: ack.expectedAssignmentVersion + 1 },
            actor,
            ports,
          ),
          (error) => error instanceof Response && error.status === 409,
        );
        await acknowledgeStaffAssignment(ack, actor, ports);
        assert.equal(
          (await listMyStaffNotifications({ status: "all" }, actor, query)).items[0].workState,
          "acknowledged",
        );
        const reply = {
          requestId: randomUUID(),
          conversationId: enquiry.conversation_id,
          enquiryId: enquiry.id,
          kind: "text",
          payload: { text: "Synthetic reply only" },
        };
        await assert.rejects(enqueueOutboundIntent(reply, ids.s2, ids.s2, query), /CONFLICT/);
        const concurrent = await Promise.all(
          Array.from({ length: 8 }, () => enqueueOutboundIntent(reply, ids.s1, ids.s1, query)),
        );
        assert.ok(concurrent.every((row) => row.id === reply.requestId));
        assert.equal(
          (await query("SELECT count(*)::int n FROM whatsapp_outbound_intents"))[0].n,
          1,
        );
        const [job] = await query(
          "UPDATE ops_jobs SET status='running',lease_owner='synthetic-worker',lease_expires_at=now()+interval '5 minutes' WHERE idempotency_key=$1 RETURNING id",
          ["woztell.reply:" + reply.requestId],
        );
        let repliesSent = 0;
        const deliver = () =>
          deliverOutboundIntent(reply.requestId, {
            checkpoint: async () => {},
            job: { jobId: job.id, workerId: "synthetic-worker" },
            send: async (reservation) => {
              repliesSent++;
              assert.equal(reservation.channelId, channel);
              assert.equal(reservation.memberId, "synthetic-customer");
              assert.deepEqual(reservation.response, [
                { type: "TEXT", text: "Synthetic reply only" },
              ]);
              return { ok: true, body: { ok: 1, messageId: "synthetic-reply-provider-id" } };
            },
          });
        assert.deepEqual(await deliver(), { dispatched: 1 });
        assert.equal(
          (
            await query("SELECT state FROM whatsapp_outbound_intents WHERE id=$1", [
              reply.requestId,
            ])
          )[0].state,
          "accepted",
        );
        assert.equal(
          (
            await query("SELECT first_human_response_at FROM inquiries WHERE id=$1", [enquiry.id])
          )[0].first_human_response_at,
          null,
        );
        assert.deepEqual(await deliver(), { dispatched: 0 });
        assert.equal(repliesSent, 1);
        const delivery = {
          type: "DELIVERED",
          messageId: "synthetic-reply-provider-id",
          member: "synthetic-customer",
          channel,
          app,
          timestamp: Math.floor(Date.now() / 1000),
        };
        assert.equal((await signedWebhook(delivery)).status, 200);
        const [answered] = await query(
          "SELECT first_human_response_at,first_human_response_staff_id FROM inquiries WHERE id=$1",
          [enquiry.id],
        );
        assert.ok(answered.first_human_response_at);
        assert.equal(answered.first_human_response_staff_id, ids.s1);
        assert.equal(
          (
            await query(
              "SELECT count(*)::int n FROM whatsapp_human_response_evidence WHERE inquiry_id=$1",
              [enquiry.id],
            )
          )[0].n,
          1,
        );
        assert.equal(
          (await listMyStaffNotifications({ status: "all" }, actor, query)).items[0].workState,
          "resolved",
        );
        assert.equal((await signedWebhook({ ...delivery, type: "READ" })).status, 200);
        assert.equal((await signedWebhook(delivery)).status, 200);
        assert.equal(
          (
            await query("SELECT status FROM whatsapp_messages WHERE external_message_id=$1", [
              delivery.messageId,
            ])
          )[0].status,
          "read",
        );
        assert.equal(
          (
            await query(
              "SELECT count(*)::int n FROM whatsapp_human_response_evidence WHERE inquiry_id=$1",
              [enquiry.id],
            )
          )[0].n,
          1,
        );
        const clients = await Promise.all([pool.connect(), pool.connect()]);
        try {
          const pids = await Promise.all(
            clients.map((client) => client.query("SELECT pg_backend_pid() pid")),
          );
          assert.notEqual(pids[0].rows[0].pid, pids[1].rows[0].pid);
        } finally {
          clients.forEach((client) => client.release());
        }
        const receive = async (id, member, text = sample, extra = {}) => {
          const input = {
            ...payload,
            messageId: id,
            member,
            memberExtra: { name: "Synthetic Customer" },
            from: null,
            data: { text },
            ...extra,
          };
          const res = await signedWebhook(input);
          assert.equal(res.status, 200);
          assert.deepEqual(await res.json(), { ok: true });
          const [row] = await query(
            "SELECT * FROM whatsapp_enquiry_events WHERE member_id=$1 AND kind='customer_message' ORDER BY received_at DESC,id DESC LIMIT 1",
            [member],
          );
          assert.ok(row);
          await observeEnquiryEvent(row.id, async () => {}, query);
          return (await query("SELECT * FROM whatsapp_enquiry_events WHERE id=$1", [row.id]))[0];
        };
        await t.test(
          "shadow writes receipt/parser/enquiry evidence with zero effect calls",
          async () => {
            process.env.EP_WA_ENQUIRY_MODE = "observe";
            const calls = effectCalls();
            const [before] = await query(
              "SELECT (SELECT count(*)::int FROM whatsapp_assignment_requests) assignments,(SELECT count(*)::int FROM whatsapp_outbound_intents) outbound,(SELECT count(*)::int FROM staff_notification_intents) notifications",
            );
            const shadow = await receive("synthetic-shadow", "synthetic-shadow-customer");
            assert.equal(shadow.capture_mode, "observe");
            assert.equal(shadow.effects_eligible, false);
            assert.equal(shadow.processing_state, "observed");
            assert.equal(effectCalls(), calls);
            assert.ok(
              (await query("SELECT * FROM inquiries WHERE id=$1", [shadow.inquiry_id]))[0]
                .association_review,
            );
            const [after] = await query(
              "SELECT (SELECT count(*)::int FROM whatsapp_assignment_requests) assignments,(SELECT count(*)::int FROM whatsapp_outbound_intents) outbound,(SELECT count(*)::int FROM staff_notification_intents) notifications",
            );
            assert.deepEqual(after, before);
            assert.equal(
              (await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n,
              0,
            );
            process.env.EP_WA_ENQUIRY_MODE = "active";
            await observeEnquiryEvent(shadow.id, async () => {}, query);
            assert.equal(effectCalls(), calls);
            assert.equal(
              (
                await query("SELECT effects_eligible FROM whatsapp_enquiry_events WHERE id=$1", [
                  shadow.id,
                ])
              )[0].effects_eligible,
              false,
            );
          },
        );
        await t.test(
          "second listing keeps its own root, triage and original customer relationship",
          async () => {
            const second = await receive(
              "synthetic-second",
              "synthetic-customer",
              sample.replaceAll("4033349", "4999999"),
            );
            assert.notEqual(second.inquiry_id, enquiry.id);
            const [secondInquiry] = await query("SELECT * FROM inquiries WHERE id=$1", [
              second.inquiry_id,
            ]);
            assert.equal(secondInquiry.property_id, null);
            assert.equal(secondInquiry.association_review, true);
            assert.equal(secondInquiry.conversation_id, enquiry.conversation_id);
            assert.equal(
              (
                await query(
                  "SELECT confirmed_staff_id,assigned_agent_id FROM whatsapp_conversations WHERE id=$1",
                  [enquiry.conversation_id],
                )
              )[0].confirmed_staff_id,
              ids.s1,
            );
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM whatsapp_assignment_requests WHERE conversation_id=$1",
                  [enquiry.conversation_id],
                )
              )[0].n,
              1,
            );
            assert.equal(
              (
                await query("SELECT wa_can_read_conversation($1,$2) allowed", [
                  ids.s2,
                  enquiry.conversation_id,
                ])
              )[0].allowed,
              false,
            );
            assert.equal(
              (
                await query("SELECT wa_can_reply_enquiry($1,$2) allowed", [
                  ids.s1,
                  second.inquiry_id,
                ])
              )[0].allowed,
              false,
            );
          },
        );
        await t.test(
          "missing provider ID retains identical attempts while genuine new IDs remain distinct events",
          async () => {
            const first = await receive(null, "synthetic-missing-id");
            const second = await receive(null, "synthetic-missing-id");
            assert.notEqual(first.id, second.id);
            assert.equal(first.identity_quality, "synthetic_ambiguous");
            assert.equal(second.effects_eligible, false);
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM whatsapp_inbound_receipts WHERE member_id='synthetic-missing-id'",
                )
              )[0].n,
              2,
            );
            const next = await receive("synthetic-genuine-repeat", "synthetic-missing-id");
            assert.notEqual(next.id, second.id);
            assert.equal(next.identity_quality, "provider_id");
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM whatsapp_messages WHERE woztell_member_id='synthetic-missing-id'",
                )
              )[0].n,
              3,
            );
          },
        );
        await t.test(
          "workflow outage saves raw sample and recovery cannot upgrade old active receipt",
          async () => {
            const body = {
              ...payload,
              messageId: "synthetic-schema-outage",
              member: "synthetic-schema-customer",
              from: null,
            };
            await query("ALTER TABLE whatsapp_enquiry_events RENAME TO qa_workflow_offline");
            try {
              const res = await signedWebhook(body);
              assert.equal(res.status, 200);
              assert.equal((await res.json()).projection, "blocked_schema");
              const [saved] = await query(
                "SELECT normalized_event,projection_state,capture_mode FROM whatsapp_inbound_receipts WHERE member_id=$1",
                [body.member],
              );
              assert.equal(saved.normalized_event.text, sample);
              assert.equal(saved.projection_state, "blocked_schema");
              assert.equal(saved.capture_mode, "active");
            } finally {
              await query("ALTER TABLE qa_workflow_offline RENAME TO whatsapp_enquiry_events");
            }
            const { recoverPendingInboundReceipts } =
              await import("../src/lib/whatsapp-enquiries/inbound-receipts.server.ts");
            const calls = effectCalls();
            assert.equal((await recoverPendingInboundReceipts({ query })).projected, 1);
            const [recovered] = await query(
              "SELECT id,capture_mode,effects_eligible FROM whatsapp_enquiry_events WHERE member_id=$1",
              [body.member],
            );
            assert.equal(recovered.capture_mode, "observe");
            assert.equal(recovered.effects_eligible, false);
            await observeEnquiryEvent(recovered.id, async () => {}, query);
            assert.equal(effectCalls(), calls);
            assert.ok(
              (
                await query("SELECT inquiry_id FROM whatsapp_enquiry_events WHERE id=$1", [
                  recovered.id,
                ])
              )[0].inquiry_id,
            );
          },
        );
        await t.test(
          "accepted assignment timeout is reconciled without a second irreversible call",
          async () => {
            const next = await receive("synthetic-timeout", "synthetic-timeout-customer");
            const [q] = await query("SELECT * FROM inquiries WHERE id=$1", [next.inquiry_id]);
            const [request] = await query(
              "SELECT id FROM whatsapp_assignment_requests WHERE conversation_id=$1",
              [q.conversation_id],
            );
            let calls = 0;
            const timedOut = {
              execute: async (target) => {
                await target.beforeSend();
                calls++;
                throw new Error("Synthetic accepted-then-timeout");
              },
              readAuthoritativeAssignment: async () => ({
                inboxUserId: "synthetic-s1-inbox",
                folderId: "synthetic-folder",
              }),
            };
            assert.equal((await executeAssignment(request.id, timedOut, ports)).state, "unknown");
            assert.equal((await executeAssignment(request.id, timedOut, ports)).state, "blocked");
            assert.equal(calls, 1);
            assert.equal((await reconcileAssignment(request.id, timedOut, ports)).confirmed, true);
            assert.equal(calls, 1);
            assert.equal(
              (
                await query("SELECT confirmed_staff_id FROM whatsapp_conversations WHERE id=$1", [
                  q.conversation_id,
                ])
              )[0].confirmed_staff_id,
              ids.s1,
            );
          },
        );
        await t.test(
          "revoked reply consent is rechecked at dispatch with no fake provider send",
          async () => {
            const blockedReply = { ...reply, requestId: randomUUID() };
            await enqueueOutboundIntent(blockedReply, ids.s1, ids.s1, query);
            const [blockedJob] = await query(
              "UPDATE ops_jobs SET status='running',lease_owner='synthetic-worker',lease_expires_at=now()+interval '5 minutes' WHERE idempotency_key=$1 RETURNING id",
              ["woztell.reply:" + blockedReply.requestId],
            );
            await query("UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1", [
              enquiry.crm_contact_id,
            ]);
            let calls = 0;
            const result = await deliverOutboundIntent(blockedReply.requestId, {
              checkpoint: async () => {},
              job: { jobId: blockedJob.id, workerId: "synthetic-worker" },
              send: async () => {
                calls++;
                throw new Error("Consent must block before provider");
              },
            });
            assert.equal(result.dispatched, 0);
            assert.equal(calls, 0);
            assert.equal(
              (
                await query("SELECT state FROM whatsapp_outbound_intents WHERE id=$1", [
                  blockedReply.requestId,
                ])
              )[0].state,
              "cancelled",
            );
          },
        );
        assert.equal(networkCalls, 0, "no portal, LLM, provider or external network request");
        t.diagnostic(
          `Postgres 17; ${MIGRATION_VERSIONS.length} full migrations; 8 concurrent intent calls; signed receipt ${receipt.id} -> event ${event.id} -> enquiry ${enquiry.id} -> assignment ${assignment.id} -> ack ${notification.id} -> outbound ${reply.requestId} -> synthetic delivered/read`,
        );
      } finally {
        for (const [key, value] of Object.entries(oldEnvironment))
          value === undefined ? delete process.env[key] : (process.env[key] = value);
        mock.restoreAll();
      }
    });
  },
);
