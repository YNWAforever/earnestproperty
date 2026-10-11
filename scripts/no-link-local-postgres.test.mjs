import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import test, { mock } from "node:test";
import pg from "pg";
import { MIGRATION_VERSIONS } from "../src/lib/control-plane/migration-versions.js";
import { withRestoredOwnedSnapshot } from "./acceptance/owned-postgres-restore.mjs";

const root = new URL("../", import.meta.url);
// Vite resolves extensionless TS imports; Node's test runner needs the same
// resolution for actual server modules. This never replaces source or exports.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      const candidate = specifier.startsWith("@/")
        ? new URL(`src/${specifier.slice(2)}`, root)
        : specifier.startsWith(".") && context.parentURL
          ? new URL(specifier, context.parentURL)
          : null;
      if (candidate?.href.startsWith(root.href)) {
        for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
          const target = new URL(candidate.href + extension);
          if (existsSync(target)) return nextResolve(target.href, context);
        }
      }
      throw error;
    }
  },
});
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
    await withDisposablePostgres(async ({ pool, query, transaction, effectCalls, containerId }) => {
      const actualDb = await import("../src/lib/neon/db.server.ts");
      mock.module(new URL("../src/lib/neon/db.server.ts", import.meta.url).href, {
        exports: {
          ...actualDb,
          queryRows: query,
          transactionRows: transaction,
          getSql: () => ({
            transaction: (build) =>
              transaction(build({ query: (statement, params = []) => ({ statement, params }) })),
          }),
        },
      });
      let networkCalls = 0;
      let syntheticCrmValue = null;
      mock.module(new URL("../src/lib/ai/provider.server.ts", import.meta.url).href, {
        exports: {
          generateAiJson: async (input) =>
            syntheticCrmValue
              ? {
                  ok: true,
                  value: syntheticCrmValue,
                  metadata: {
                    provider: "synthetic-owned",
                    resolvedModel: "synthetic-owned",
                    usage: {
                      inputTokens: 17,
                      outputTokens: 9,
                      costAmount: null,
                      costCurrency: null,
                    },
                  },
                }
              : { ok: false, value: input.fallback, error: "SYNTHETIC_DISABLED" },
          generateAiText: async () => ({ ok: false }),
          embedAiTexts: async () => ({ ok: false }),
        },
      });
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
        OPS_WAKE_URL: "",
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
        const { listMyStaffNotifications, acknowledgeStaffAssignment, requestStaffAssignmentHelp } =
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
        await t.test(
          "local staff acknowledgement and help retries keep one audit each",
          async () => {
            const confirmations = await Promise.all([
              acknowledgeStaffAssignment(ack, actor, ports),
              acknowledgeStaffAssignment(ack, actor, ports),
            ]);
            assert.equal(confirmations[0].acknowledgedAt, confirmations[1].acknowledgedAt);
            const auditCount = async (action) =>
              Number(
                (
                  await query(
                    "SELECT count(*)::int total FROM audit_logs WHERE subject_id=$1::uuid AND action=$2",
                    [notification.id, action],
                  )
                )[0].total,
              );
            const acknowledgements = await auditCount("staff.notification.ack");
            const help = { ...ack, reason: "Synthetic first help reason" };
            const helpResults = await Promise.all([
              requestStaffAssignmentHelp(help, actor, ports),
              requestStaffAssignmentHelp(help, actor, ports),
            ]);
            assert.equal(helpResults[0].helpRequestedAt, helpResults[1].helpRequestedAt);
            await requestStaffAssignmentHelp(
              { ...help, reason: "Synthetic different retry" },
              actor,
              ports,
            );
            const helpAudits = await auditCount("staff.notification.help");
            assert.equal(
              (
                await query(
                  "SELECT help_reason FROM staff_notification_intents WHERE id=$1::uuid",
                  [notification.id],
                )
              )[0].help_reason,
              help.reason,
            );
            await assert.rejects(
              requestStaffAssignmentHelp({ ...help, reason: " " }, actor, ports),
            );
            await assert.rejects(
              requestStaffAssignmentHelp(help, otherActor, ports),
              (error) => error instanceof Response && error.status === 409,
            );
            await assert.rejects(
              requestStaffAssignmentHelp(
                { ...help, expectedAssignmentVersion: ack.expectedAssignmentVersion + 1 },
                actor,
                ports,
              ),
              (error) => error instanceof Response && error.status === 409,
            );
            assert.deepEqual(
              { acknowledgements, helpAudits },
              { acknowledgements: 1, helpAudits: 1 },
            );
          },
        );
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
        await t.test(
          "new outbound request IDs cannot bypass an unresolved conversation",
          async () => {
            const writer = await pool.connect();
            const writeQuery = async (statement, params) =>
              (await writer.query(statement, params)).rows;
            try {
              await writer.query("BEGIN");
              const { readOutboundReservation } =
                await import("../src/lib/woztell/outbound-intent.server.ts");
              for (const state of ["unknown", "dispatching"]) {
                await writer.query("UPDATE whatsapp_outbound_intents SET state=$2 WHERE id=$1", [
                  reply.requestId,
                  state,
                ]);
                assert.deepEqual(
                  await readOutboundReservation(
                    { conversationId: reply.conversationId },
                    ids.s1,
                    ids.s1,
                    writeQuery,
                  ),
                  {
                    blocked: true,
                    intent: { id: reply.requestId, kind: "text", state },
                  },
                );
                assert.deepEqual(
                  await readOutboundReservation(
                    { conversationId: reply.conversationId },
                    ids.manager,
                    null,
                    writeQuery,
                  ),
                  { blocked: true, intent: null },
                );
                assert.equal(
                  await readOutboundReservation(
                    { conversationId: reply.conversationId },
                    ids.s2,
                    ids.s2,
                    writeQuery,
                  ),
                  null,
                );
                const original = await enqueueOutboundIntent(reply, ids.s1, ids.s1, writeQuery);
                assert.deepEqual(original, { id: reply.requestId, state });
                for (const variant of [
                  { ...reply, requestId: randomUUID() },
                  {
                    ...reply,
                    requestId: randomUUID(),
                    kind: "template",
                    payload: { templateId: randomUUID() },
                  },
                ]) {
                  await writer.query("SAVEPOINT attempt");
                  await assert.rejects(
                    enqueueOutboundIntent(variant, ids.s1, ids.s1, writeQuery),
                    /OUTBOUND_RECONCILIATION_REQUIRED/,
                  );
                  await writer.query("ROLLBACK TO attempt");
                  assert.equal(
                    (
                      await writeQuery(
                        "SELECT count(*)::int n FROM whatsapp_outbound_intents WHERE id=$1",
                        [variant.requestId],
                      )
                    )[0].n,
                    0,
                  );
                  assert.equal(
                    (
                      await writeQuery(
                        "SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key=$1",
                        ["woztell.reply:" + variant.requestId],
                      )
                    )[0].n,
                    0,
                  );
                }
              }
              for (const state of ["accepted", "failed", "cancelled"]) {
                await writer.query("UPDATE whatsapp_outbound_intents SET state=$2 WHERE id=$1", [
                  reply.requestId,
                  state,
                ]);
                assert.deepEqual(
                  await readOutboundReservation(
                    { conversationId: reply.conversationId },
                    ids.s1,
                    ids.s1,
                    writeQuery,
                  ),
                  { blocked: false, intent: null },
                );
                const deliberate = {
                  ...reply,
                  requestId: randomUUID(),
                  payload: { text: "Synthetic new deliberate " + state },
                };
                assert.equal(
                  (await enqueueOutboundIntent(deliberate, ids.s1, ids.s1, writeQuery)).state,
                  "queued",
                );
              }
            } finally {
              await writer.query("ROLLBACK");
              writer.release();
            }
          },
        );
        await t.test(
          "reservation checks see unknown committed while a different writer waits",
          async () => {
            const blocker = await pool.connect();
            const writer = await pool.connect();
            let held = false;
            try {
              const pid = (await writer.query("SELECT pg_backend_pid() pid")).rows[0].pid;
              await blocker.query("BEGIN");
              held = true;
              await blocker.query("SELECT id FROM whatsapp_conversations WHERE id=$1 FOR UPDATE", [
                reply.conversationId,
              ]);
              await blocker.query(
                "UPDATE whatsapp_outbound_intents SET state='unknown' WHERE id=$1",
                [reply.requestId],
              );
              const result = enqueueOutboundIntent(
                { ...reply, requestId: randomUUID() },
                ids.s1,
                ids.s1,
                async (statement, params) => (await writer.query(statement, params)).rows,
              ).then(
                (value) => ({ value }),
                (error) => ({ error }),
              );
              let waiting = false;
              for (let attempt = 0; attempt < 150; attempt++) {
                waiting = (
                  await pool.query(
                    "SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",
                    [pid],
                  )
                ).rows[0]?.waiting;
                if (waiting) break;
                await delay(10);
              }
              assert.equal(
                waiting,
                true,
                "second session must wait on the conversation reservation",
              );
              await blocker.query("COMMIT");
              held = false;
              const outcome = await result;
              assert.match(
                outcome.error?.message ?? "new request succeeded",
                /OUTBOUND_RECONCILIATION_REQUIRED/,
              );
            } finally {
              if (held) await blocker.query("ROLLBACK");
              writer.release();
              blocker.release();
              await query("UPDATE whatsapp_outbound_intents SET state='queued' WHERE id=$1", [
                reply.requestId,
              ]);
            }
          },
        );
        await t.test(
          "outbound readback is actor-bound scoped readonly and validates input",
          async () => {
            const { readOutboundIntent } =
              await import("../src/lib/woztell/outbound-intent.server.ts");
            assert.equal(typeof readOutboundIntent, "function");
            const input = { requestId: reply.requestId, conversationId: reply.conversationId };
            assert.deepEqual(await readOutboundIntent(input, ids.s1, ids.s1, query), {
              id: reply.requestId,
              kind: "text",
              state: "queued",
            });
            assert.equal(await readOutboundIntent(input, ids.s2, ids.s2, query), null);
            assert.equal(await readOutboundIntent(input, ids.manager, null, query), null);
            assert.equal(
              await readOutboundIntent(
                { ...input, conversationId: randomUUID() },
                ids.s1,
                ids.s1,
                query,
              ),
              null,
            );
            assert.equal(
              await readOutboundIntent(
                { ...input, requestId: randomUUID() },
                ids.s1,
                ids.s1,
                query,
              ),
              null,
            );
            await assert.rejects(
              readOutboundIntent({ ...input, requestId: "invalid" }, ids.s1, ids.s1, query),
              /VALIDATION/,
            );
            // Inactivation intentionally retires mappings; rollback the whole
            // local transaction so later golden cases keep their original setup.
            const reader = await pool.connect();
            const readQuery = async (statement, params) =>
              (await reader.query(statement, params)).rows;
            try {
              await reader.query("BEGIN");
              await reader.query("UPDATE staff_users SET active=false WHERE id=$1", [ids.s1]);
              assert.equal(await readOutboundIntent(input, ids.s1, ids.s1, readQuery), null);
              await reader.query("ROLLBACK");
              await reader.query("BEGIN");
              // Synthetic provider-confirmed transfer; a bare assignment write
              // intentionally creates review and leaves the original owner.
              await reader.query("SELECT set_config('app.wa_confirm_assignment','true',true)");
              await reader.query(
                "UPDATE whatsapp_conversations SET assigned_agent_id=$2,confirmed_staff_id=$2 WHERE id=$1",
                [reply.conversationId, ids.s2],
              );
              assert.equal(await readOutboundIntent(input, ids.s1, ids.s1, readQuery), null);
            } finally {
              await reader.query("ROLLBACK");
              reader.release();
            }
            await query("UPDATE whatsapp_outbound_intents SET state='unknown' WHERE id=$1", [
              reply.requestId,
            ]);
            assert.equal((await readOutboundIntent(input, ids.s1, ids.s1, query)).state, "unknown");
            await query("UPDATE whatsapp_outbound_intents SET state='queued' WHERE id=$1", [
              reply.requestId,
            ]);
            assert.equal(
              Number(
                (
                  await query("SELECT count(*)::int total FROM ops_jobs WHERE idempotency_key=$1", [
                    "woztell.reply:" + reply.requestId,
                  ])
                )[0].total,
              ),
              1,
            );
          },
        );
        await t.test(
          "a waiting writer must recheck current ownership after the conversation lock",
          async () => {
            const conversationId = randomUUID();
            const requestId = randomUUID();
            const contactId = (
              await query("SELECT contact_id FROM whatsapp_conversations WHERE id=$1", [
                reply.conversationId,
              ])
            )[0].contact_id;
            await query(
              "INSERT INTO whatsapp_conversations(id,contact_id,woztell_member_id,channel_id,assigned_agent_id,confirmed_staff_id,last_inbound_at) VALUES($1,$2,$3,$4,$5,$5,now())",
              [conversationId, contactId, "synthetic-scope-" + conversationId, channel, ids.s1],
            );
            const blocker = await pool.connect();
            const writer = await pool.connect();
            let held = false;
            try {
              const pid = (await writer.query("SELECT pg_backend_pid() pid")).rows[0].pid;
              await blocker.query("BEGIN");
              held = true;
              await blocker.query("SELECT id FROM whatsapp_conversations WHERE id=$1 FOR UPDATE", [
                conversationId,
              ]);
              await blocker.query("SELECT set_config('app.wa_confirm_assignment','true',true)");
              await blocker.query(
                "UPDATE whatsapp_conversations SET assigned_agent_id=$2,confirmed_staff_id=$2 WHERE id=$1",
                [conversationId, ids.s2],
              );
              const result = enqueueOutboundIntent(
                {
                  requestId,
                  conversationId,
                  kind: "text",
                  payload: { text: "Synthetic stale actor must not queue" },
                },
                ids.s1,
                ids.s1,
                async (statement, params) => (await writer.query(statement, params)).rows,
              ).then(
                (value) => ({ value }),
                (error) => ({ error }),
              );
              let waiting = false;
              for (let attempt = 0; attempt < 150; attempt++) {
                waiting = (
                  await pool.query(
                    "SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",
                    [pid],
                  )
                ).rows[0]?.waiting;
                if (waiting) break;
                await delay(10);
              }
              assert.equal(waiting, true);
              await blocker.query("COMMIT");
              held = false;
              const outcome = await result;
              assert.match(
                outcome.error?.message ?? "stale actor queued a request",
                /OUTBOUND_CONFLICT_OR_NOT_FOUND/,
              );
              assert.equal(
                (
                  await query("SELECT count(*)::int n FROM whatsapp_outbound_intents WHERE id=$1", [
                    requestId,
                  ])
                )[0].n,
                0,
              );
            } finally {
              if (held) await blocker.query("ROLLBACK");
              writer.release();
              blocker.release();
              await query("DELETE FROM ops_jobs WHERE idempotency_key=$1", [
                "woztell.reply:" + requestId,
              ]);
              const messages = await query(
                "DELETE FROM whatsapp_outbound_intents WHERE id=$1 RETURNING message_id",
                [requestId],
              );
              for (const message of messages)
                await query("DELETE FROM whatsapp_messages WHERE id=$1", [message.message_id]);
              await query("DELETE FROM whatsapp_conversations WHERE id=$1", [conversationId]);
            }
          },
        );
        await t.test(
          "previously queued different request cannot dispatch behind an unknown send",
          async () => {
            for (const state of ["unknown", "dispatching"]) {
              const second = {
                ...reply,
                requestId: randomUUID(),
                payload: { text: "Synthetic queued before uncertainty " + state },
              };
              let sends = 0;
              try {
                await enqueueOutboundIntent(second, ids.s1, ids.s1, query);
                await query("UPDATE whatsapp_outbound_intents SET state=$2 WHERE id=$1", [
                  reply.requestId,
                  state,
                ]);
                const [pendingJob] = await query(
                  "UPDATE ops_jobs SET status='running',lease_owner='synthetic-reservation-worker',lease_expires_at=now()+interval '5 minutes' WHERE idempotency_key=$1 RETURNING id",
                  ["woztell.reply:" + second.requestId],
                );
                assert.deepEqual(
                  await deliverOutboundIntent(second.requestId, {
                    checkpoint: async () => {},
                    job: { jobId: pendingJob.id, workerId: "synthetic-reservation-worker" },
                    send: async () => {
                      sends++;
                      return { ok: true, body: { messageId: "must-not-send" } };
                    },
                  }),
                  { dispatched: 0 },
                );
                assert.equal(sends, 0);
                const [intent] = await query(
                  "SELECT state,error,dispatch_started_at FROM whatsapp_outbound_intents WHERE id=$1",
                  [second.requestId],
                );
                assert.deepEqual(intent, {
                  state: "cancelled",
                  error: "OUTBOUND_RECONCILIATION_REQUIRED",
                  dispatch_started_at: null,
                });
                const [message] = await query(
                  "SELECT m.status,m.error FROM whatsapp_messages m JOIN whatsapp_outbound_intents i ON i.message_id=m.id WHERE i.id=$1",
                  [second.requestId],
                );
                assert.deepEqual(message, {
                  status: "cancelled",
                  error: "OUTBOUND_RECONCILIATION_REQUIRED",
                });
              } finally {
                await query("DELETE FROM ops_jobs WHERE idempotency_key=$1", [
                  "woztell.reply:" + second.requestId,
                ]);
                const messages = await query(
                  "DELETE FROM whatsapp_outbound_intents WHERE id=$1 RETURNING message_id",
                  [second.requestId],
                );
                for (const message of messages)
                  await query("DELETE FROM whatsapp_messages WHERE id=$1", [message.message_id]);
                await query("UPDATE whatsapp_outbound_intents SET state='queued' WHERE id=$1", [
                  reply.requestId,
                ]);
              }
            }
          },
        );
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
        await t.test(
          "signed delivery receipts reconcile unknown intents without another send",
          async () => {
            const { readOutboundReservation, finishOutboundIntent } =
              await import("../src/lib/woztell/outbound-intent.server.ts");
            const { ingestWoztellEvent } =
              await import("../src/lib/woztell/woztell-ingest.server.ts");
            const { normalizeWoztellEvent } = await import("../src/lib/woztell/woztell.server.ts");
            for (const receiptType of ["DELIVERED", "READ"]) {
              const requestId = randomUUID();
              const externalId = "synthetic-unknown-receipt-" + requestId;
              let sends = 0;
              try {
                await enqueueOutboundIntent(
                  {
                    requestId,
                    conversationId: reply.conversationId,
                    enquiryId: reply.enquiryId,
                    kind: "text",
                    payload: { text: "Synthetic uncertain delivery " + receiptType },
                  },
                  ids.s1,
                  ids.s1,
                  query,
                );
                const [receiptJob] = await query(
                  "UPDATE ops_jobs SET status='running',lease_owner='synthetic-receipt-worker',lease_expires_at=now()+interval '5 minutes' WHERE idempotency_key=$1 RETURNING id",
                  ["woztell.reply:" + requestId],
                );
                const deliverUnknown = () =>
                  deliverOutboundIntent(requestId, {
                    checkpoint: async () => {},
                    job: { jobId: receiptJob.id, workerId: "synthetic-receipt-worker" },
                    send: async () => {
                      sends++;
                      return {
                        ok: false,
                        body: {
                          ok: 1,
                          sendResult: {
                            result: [
                              { messageEvent: { messageId: externalId } },
                              { err: "Synthetic partial refusal" },
                            ],
                          },
                        },
                      };
                    },
                  });
                assert.deepEqual(await deliverUnknown(), { dispatched: 1 });
                const readState = async () =>
                  (
                    await query(
                      "SELECT state,external_message_id FROM whatsapp_outbound_intents WHERE id=$1",
                      [requestId],
                    )
                  )[0];
                assert.deepEqual(await readState(), {
                  state: "unknown",
                  external_message_id: externalId,
                });
                const receiptPayload = {
                  type: receiptType,
                  messageId: externalId,
                  member: "synthetic-customer",
                  channel,
                  app,
                  timestamp: Math.floor(Date.now() / 1000),
                };
                const journal = () =>
                  readOutboundReservation(
                    { conversationId: reply.conversationId },
                    ids.s1,
                    ids.s1,
                    query,
                  );
                assert.equal((await journal()).blocked, true);
                // No trusted match: another sender, synthesized identity, no timestamp,
                // earlier event, failed/sent status, history and unsigned ingestion.
                for (const patch of [
                  { member: "synthetic-other-customer" },
                  { messageId: undefined },
                  { timestamp: undefined },
                  { timestamp: Math.floor(Date.now() / 1000) - 60 },
                  { timestamp: Math.floor(Date.now() / 1000) + 3600 },
                  { type: "FAILED" },
                  { type: "SENT" },
                ]) {
                  assert.equal((await signedWebhook({ ...receiptPayload, ...patch })).status, 200);
                  assert.equal((await readState()).state, "unknown");
                }
                assert.equal(
                  (await signedWebhook({ ...receiptPayload, channel: "synthetic-other-channel" }))
                    .status,
                  403,
                );
                await ingestWoztellEvent(
                  normalizeWoztellEvent(receiptPayload),
                  "history_import",
                  transaction,
                  { mode: "off", signedEvent: true },
                );
                await ingestWoztellEvent(
                  normalizeWoztellEvent(receiptPayload),
                  "live_webhook",
                  transaction,
                  { mode: "off" },
                );
                assert.equal((await readState()).state, "unknown");
                // Different durable event from the negative timestamp case; the
                // signed live receipt is the only evidence that resolves the intent.
                const authoritative = { ...receiptPayload, timestamp: Date.now() };
                const outcomes = await Promise.all([
                  signedWebhook(authoritative),
                  signedWebhook(authoritative),
                ]);
                assert.ok(outcomes.every((response) => response.status === 200));
                assert.deepEqual(await readState(), {
                  state: "accepted",
                  external_message_id: externalId,
                });
                assert.deepEqual(await journal(), { blocked: false, intent: null });
                assert.deepEqual(await deliverUnknown(), { dispatched: 0 });
                assert.equal(sends, 1);
                await finishOutboundIntent(
                  requestId,
                  {
                    state: "unknown",
                    externalMessageId: externalId,
                    error: "WOZTELL_DELIVERY_UNKNOWN",
                  },
                  transaction,
                );
                assert.equal((await readState()).state, "accepted");
                const [message] = await query(
                  "SELECT status,error FROM whatsapp_messages WHERE external_message_id=$1",
                  [externalId],
                );
                assert.equal(message.status, receiptType.toLowerCase());
                assert.equal(message.error, null);
              } finally {
                await query("DELETE FROM ops_jobs WHERE idempotency_key=$1", [
                  "woztell.reply:" + requestId,
                ]);
                const messages = await query(
                  "DELETE FROM whatsapp_outbound_intents WHERE id=$1 RETURNING message_id",
                  [requestId],
                );
                for (const message of messages) {
                  await query("DELETE FROM whatsapp_human_response_evidence WHERE message_id=$1", [
                    message.message_id,
                  ]);
                  await query("DELETE FROM whatsapp_messages WHERE id=$1", [message.message_id]);
                }
              }
            }
          },
        );
        await t.test("an early signed receipt resolves the later unknown HTTP result", async () => {
          const { readOutboundReservation, finishOutboundIntent } =
            await import("../src/lib/woztell/outbound-intent.server.ts");
          const { ingestWoztellEvent } =
            await import("../src/lib/woztell/woztell-ingest.server.ts");
          const { normalizeWoztellEvent } = await import("../src/lib/woztell/woztell.server.ts");
          const priorMode = process.env.EP_WA_ENQUIRY_MODE;
          const [priorEvidence] = await query(
            "SELECT first_human_response_at,first_human_response_staff_id FROM inquiries WHERE id=$1",
            [enquiry.id],
          );
          for (const proof of [
            "live",
            "off",
            "observe",
            "history",
            "unsigned",
            "other-member",
            "missing-time",
            "future-time",
            "missing-id",
          ]) {
            const requestId = randomUUID();
            const externalId = "synthetic-early-delivery-" + requestId;
            const accepted = ["live", "off", "observe"].includes(proof);
            let sends = 0;
            try {
              await enqueueOutboundIntent(
                { ...reply, requestId, payload: { text: "Synthetic early receipt" } },
                ids.s1,
                ids.s1,
                query,
              );
              const [earlyJob] = await query(
                "UPDATE ops_jobs SET status='running',lease_owner='synthetic-early-receipt-worker',lease_expires_at=now()+interval '5 minutes' WHERE idempotency_key=$1 RETURNING id",
                ["woztell.reply:" + requestId],
              );
              const deliverEarly = () =>
                deliverOutboundIntent(requestId, {
                  checkpoint: async () => {},
                  job: { jobId: earlyJob.id, workerId: "synthetic-early-receipt-worker" },
                  send: async () => {
                    sends++;
                    const event = {
                      type: "READ",
                      messageId: externalId,
                      member: "synthetic-customer",
                      channel,
                      app,
                      timestamp: Date.now(),
                    };
                    if (proof === "history" || proof === "unsigned") {
                      await ingestWoztellEvent(
                        normalizeWoztellEvent(event),
                        proof === "history" ? "history_import" : "live_webhook",
                        transaction,
                        { mode: "off", signedEvent: proof === "history" },
                      );
                    } else {
                      if (proof === "other-member") event.member = "synthetic-wrong-member";
                      if (proof === "missing-time") delete event.timestamp;
                      if (proof === "future-time") event.timestamp += 60000;
                      if (proof === "missing-id") delete event.messageId;
                      if (proof === "off" || proof === "observe")
                        process.env.EP_WA_ENQUIRY_MODE = proof;
                      const [jobsBeforeReceipt] = await query(
                        "SELECT count(*)::int n FROM ops_jobs",
                      );
                      assert.equal((await signedWebhook(event)).status, 200);
                      assert.deepEqual(
                        (await query("SELECT count(*)::int n FROM ops_jobs"))[0],
                        jobsBeforeReceipt,
                      );
                    }
                    return {
                      ok: false,
                      body: {
                        ok: 1,
                        sendResult: {
                          result: [
                            { messageEvent: { messageId: externalId } },
                            { err: "Synthetic partial refusal" },
                          ],
                        },
                      },
                    };
                  },
                });
              assert.deepEqual(await deliverEarly(), { dispatched: 1 });
              const [intent] = await query(
                "SELECT state,error FROM whatsapp_outbound_intents WHERE id=$1",
                [requestId],
              );
              assert.deepEqual(
                intent,
                accepted
                  ? { state: "accepted", error: null }
                  : { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" },
                proof,
              );
              assert.deepEqual(
                await readOutboundReservation(
                  { conversationId: reply.conversationId },
                  ids.s1,
                  ids.s1,
                  query,
                ),
                accepted
                  ? { blocked: false, intent: null }
                  : { blocked: true, intent: { id: requestId, kind: "text", state: "unknown" } },
                proof,
              );
              assert.deepEqual(await deliverEarly(), { dispatched: 0 });
              assert.equal(sends, 1);
              await finishOutboundIntent(
                requestId,
                {
                  state: "unknown",
                  externalMessageId: externalId,
                  error: "WOZTELL_DELIVERY_UNKNOWN",
                },
                transaction,
              );
              assert.equal(
                (
                  await query("SELECT state FROM whatsapp_outbound_intents WHERE id=$1", [
                    requestId,
                  ])
                )[0].state,
                accepted ? "accepted" : "unknown",
                proof,
              );
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM whatsapp_human_response_evidence e JOIN whatsapp_outbound_intents i ON i.message_id=e.message_id WHERE i.id=$1",
                    [requestId],
                  )
                )[0].n,
                accepted ? 1 : 0,
                proof,
              );
              if (accepted)
                assert.deepEqual(
                  (
                    await query(
                      "SELECT m.status,m.error FROM whatsapp_messages m JOIN whatsapp_outbound_intents i ON i.message_id=m.id WHERE i.id=$1",
                      [requestId],
                    )
                  )[0],
                  { status: "read", error: null },
                );
              assert.deepEqual(
                (
                  await query(
                    "SELECT first_human_response_at,first_human_response_staff_id FROM inquiries WHERE id=$1",
                    [enquiry.id],
                  )
                )[0],
                priorEvidence,
              );
            } finally {
              process.env.EP_WA_ENQUIRY_MODE = priorMode;
              await query("DELETE FROM ops_jobs WHERE idempotency_key=$1", [
                "woztell.reply:" + requestId,
              ]);
              const messages = await query(
                "DELETE FROM whatsapp_outbound_intents WHERE id=$1 RETURNING message_id",
                [requestId],
              );
              for (const message of messages) {
                await query("DELETE FROM whatsapp_human_response_evidence WHERE message_id=$1", [
                  message.message_id,
                ]);
                await query("DELETE FROM whatsapp_messages WHERE id=$1", [message.message_id]);
              }
            }
          }
        });
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
            // FX-07: recovery leaves a receipt alone for its 2-minute in-flight grace and
            // backoff, then claims it once it is due.
            assert.equal((await recoverPendingInboundReceipts({ query })).projected, 0);
            await query(
              "UPDATE whatsapp_inbound_receipts SET updated_at=now()-interval '5 minutes',lease_until=NULL WHERE member_id=$1",
              [body.member],
            );
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
        await t.test(
          "contact CAS serializes competing writers and rejects a pointer changed while waiting",
          async () => {
            const { updateLeadContact } =
              await import("../src/lib/whatsapp-enquiries/forwarded-enquiries.server.ts");
            const contactId = randomUUID(),
              replacementId = randomUUID(),
              leadId = randomUUID();
            await query(
              "INSERT INTO crm_contacts(id,name,email,phone,opt_in_whatsapp) VALUES($1,'原姓名','old@example.test','synthetic-phone',false),($2,'原姓名','old@example.test',NULL,false)",
              [contactId, replacementId],
            );
            await query(
              "INSERT INTO crm_leads(id,contact_id,assigned_agent_id,source) VALUES($1,$2,$3,'whatsapp')",
              [leadId, contactId, ids.s1],
            );
            const input = {
              leadId,
              name: "修改甲",
              email: "new@example.test",
              expectedContactId: contactId,
              expectedName: "原姓名",
              expectedEmail: "old@example.test",
            };
            const outcomes = await Promise.allSettled([
              updateLeadContact(input, actor, query),
              updateLeadContact({ ...input, name: "修改乙" }, actor, query),
            ]);
            assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
            const rejected = outcomes.find((r) => r.status === "rejected");
            assert.equal(rejected.reason.status, 409);
            const [saved] = await query(
              "SELECT name,email,phone,opt_in_whatsapp FROM crm_contacts WHERE id=$1",
              [contactId],
            );
            assert.ok(["修改甲", "修改乙"].includes(saved.name));
            assert.equal(saved.phone, "synthetic-phone");
            assert.equal(saved.opt_in_whatsapp, false);
            await updateLeadContact({ ...input, name: saved.name }, actor, query);
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM audit_logs WHERE subject_id=$1 AND action='lead.contact.update'",
                  [contactId],
                )
              )[0].n,
              1,
            );
            const lock = await pool.connect();
            let pending;
            try {
              await lock.query("BEGIN");
              await lock.query("UPDATE crm_leads SET contact_id=$1 WHERE id=$2", [
                replacementId,
                leadId,
              ]);
              pending = updateLeadContact(
                {
                  ...input,
                  name: "舊畫面再修改",
                  expectedName: saved.name,
                  expectedEmail: saved.email,
                },
                actor,
                query,
              ).then(
                (value) => ({ value }),
                (error) => ({ error }),
              );
              // Observe the actual blocked backend before committing the pointer change.
              let waiting = false;
              for (let n = 0; n < 100 && !waiting; n++) {
                waiting =
                  (
                    await query(
                      "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'WITH locked_lead%'",
                    )
                  )[0].n > 0;
                if (!waiting) await delay(25);
              }
              assert.equal(waiting, true, "CAS must wait on the lead lock");
              await lock.query("COMMIT");
              const result = await pending;
              assert.equal(result.error?.status, 409);
              assert.equal(
                (await query("SELECT name FROM crm_contacts WHERE id=$1", [replacementId]))[0].name,
                "原姓名",
              );
              assert.equal(
                (
                  await query("SELECT count(*)::int n FROM audit_logs WHERE subject_id=$1", [
                    replacementId,
                  ])
                )[0].n,
                0,
              );
            } finally {
              await lock.query("ROLLBACK");
              lock.release();
              await pending;
            }
          },
        );
        await t.test(
          "concurrent enquiry corrections have one revision and effective readback preserves original evidence",
          async () => {
            const { resolveEnquiry } =
              await import("../src/lib/whatsapp-enquiries/enquiry-resolution.server.ts");
            const { readEnquiryResolutionContext, readEnquiryMessages } =
              await import("../src/lib/whatsapp-enquiries/enquiry-access.server.ts");
            const manager = { staffId: ids.manager, roles: ["manager"] };
            const correction = {
              inquiryId: enquiry.id,
              expectedVersion: 0,
              requestedStaffId: null,
              reason: "已核對原指定同事",
            };
            await assert.rejects(resolveEnquiry(correction, actor, query), (e) => e.status === 403);
            const outcomes = await Promise.allSettled([
              resolveEnquiry(correction, manager, query),
              resolveEnquiry({ ...correction, reason: "另一主管同步核對" }, manager, query),
            ]);
            assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
            assert.equal(outcomes.find((r) => r.status === "rejected").reason.status, 409);
            const readback = await readEnquiryResolutionContext(manager, enquiry.id, query);
            assert.equal(readback.version, 1);
            assert.equal(readback.requestedStaffId, null);
            assert.equal(readback.propertyId, ids.property);
            assert.equal(
              (await query("SELECT requested_staff_id FROM inquiries WHERE id=$1", [enquiry.id]))[0]
                .requested_staff_id,
              ids.s1,
            );
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM whatsapp_enquiry_revisions WHERE inquiry_id=$1",
                  [enquiry.id],
                )
              )[0].n,
              1,
            );
            const [thread] = await query(
              "SELECT assigned_agent_id,confirmed_staff_id FROM whatsapp_conversations WHERE id=$1",
              [enquiry.conversation_id],
            );
            assert.equal(thread.assigned_agent_id, ids.s1);
            assert.equal(thread.confirmed_staff_id, ids.s1);
            const messages = await readEnquiryMessages(manager, enquiry.id, query);
            assert.ok(messages.some((message) => message.text === sample));
            await assert.rejects(
              readEnquiryMessages(otherActor, enquiry.id, query),
              (e) => e.status === 403,
            );
            await query("UPDATE staff_users SET branch_id=NULL WHERE id=$1", [ids.manager]);
            try {
              await assert.rejects(
                resolveEnquiry(
                  { ...correction, expectedVersion: 1, ownerStaffId: null },
                  manager,
                  query,
                ),
                (e) => e.status === 403,
              );
            } finally {
              await query("UPDATE staff_users SET branch_id=$2 WHERE id=$1", [
                ids.manager,
                ids.branch,
              ]);
            }
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM whatsapp_enquiry_revisions WHERE inquiry_id=$1",
                  [enquiry.id],
                )
              )[0].n,
              1,
            );
          },
        );
        await t.test(
          "campaign with missing saved audience cannot materialize all contacts",
          async () => {
            const { materializeCampaignRecipients } =
              await import("../src/lib/neon/admin-data.server.ts");
            const templateId = randomUUID(),
              campaignId = randomUUID();
            await query(
              "INSERT INTO crm_contacts(name,normalized_phone,source,opt_in_whatsapp) VALUES('合成全庫候選','85268888888','synthetic-global',true)",
            );
            await query(
              "INSERT INTO whatsapp_templates(id,element_name,status) VALUES($1,'synthetic_campaign_missing_audience','active')",
              [templateId],
            );
            await query(
              "INSERT INTO whatsapp_campaigns(id,name,template_id,status) VALUES($1,'合成缺失群組',$2,'review')",
              [campaignId, templateId],
            );
            const result = await materializeCampaignRecipients(campaignId, {
              staffId: ids.manager,
              roles: ["manager"],
            });
            assert.deepEqual(result, { ok: false, error: "AUDIENCE_NOT_FOUND" });
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM whatsapp_campaign_recipients WHERE campaign_id=$1",
                  [campaignId],
                )
              )[0].n,
              0,
            );
            assert.equal(
              (
                await query("SELECT count(*)::int n FROM audit_logs WHERE subject_id=$1", [
                  campaignId,
                ])
              )[0].n,
              0,
            );
            assert.equal(
              (await query("SELECT status FROM whatsapp_campaigns WHERE id=$1", [campaignId]))[0]
                .status,
              "review",
            );
          },
        );
        await t.test(
          "campaign audience deletion before queue cannot create a delivery job",
          async () => {
            const {
              materializeCampaignRecipients,
              queueAdminCampaignForTests: queueAdminCampaign,
            } = await import("../src/lib/neon/admin-data.server.ts");
            const templateId = randomUUID(),
              campaignId = randomUUID(),
              audienceId = randomUUID(),
              contactId = randomUUID();
            const manager = { staffId: ids.manager, roles: ["manager"] };
            await query(
              "INSERT INTO crm_contacts(id,name,normalized_phone,source,opt_in_whatsapp) VALUES($1,'合成推廣客戶','85269999999','synthetic-campaign',true)",
              [contactId],
            );
            await query(
              "INSERT INTO whatsapp_templates(id,element_name,status) VALUES($1,'synthetic_campaign_scope','active')",
              [templateId],
            );
            await query(
              "INSERT INTO whatsapp_audiences(id,name,filters) VALUES($1,'合成推廣群組','{\"source\":\"synthetic-campaign\"}')",
              [audienceId],
            );
            await query(
              "INSERT INTO whatsapp_campaigns(id,name,template_id,audience_id,status) VALUES($1,'合成群組變更',$2,$3,'review')",
              [campaignId, templateId, audienceId],
            );
            assert.equal((await materializeCampaignRecipients(campaignId, manager)).eligible, 1);
            await query("DELETE FROM whatsapp_audiences WHERE id=$1", [audienceId]);
            assert.deepEqual(await queueAdminCampaign(campaignId, manager), {
              ok: false,
              error: "CAMPAIGN_NOT_ELIGIBLE",
            });
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM ops_jobs WHERE payload->>'campaignId'=$1",
                  [campaignId],
                )
              )[0].n,
              0,
            );
            assert.equal(
              (await query("SELECT status FROM whatsapp_campaigns WHERE id=$1", [campaignId]))[0]
                .status,
              "review",
            );
            await query(
              "INSERT INTO whatsapp_audiences(id,name,filters) VALUES($1,'合成推廣群組','{\"source\":\"synthetic-campaign\"}')",
              [audienceId],
            );
            await query("UPDATE whatsapp_campaigns SET audience_id=$2 WHERE id=$1", [
              campaignId,
              audienceId,
            ]);
            const queued = await Promise.all([
              queueAdminCampaign(campaignId, manager),
              queueAdminCampaign(campaignId, manager),
            ]);
            assert.equal(queued.filter((result) => result.ok).length, 1);
            assert.ok(
              queued.some(
                (result) =>
                  !result.ok &&
                  ["INVALID_CAMPAIGN_STATUS", "CAMPAIGN_NOT_ELIGIBLE"].includes(result.error),
              ),
            );
            assert.equal(
              (await queueAdminCampaign(campaignId, manager)).error,
              "INVALID_CAMPAIGN_STATUS",
            );
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM ops_jobs WHERE payload->>'campaignId'=$1",
                  [campaignId],
                )
              )[0].n,
              1,
            );
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM audit_logs WHERE action='campaign.queue' AND subject_id=$1",
                  [campaignId],
                )
              )[0].n,
              1,
            );
          },
        );
        await t.test(
          "Golden B authorised validated review and apply in the same schema as Golden A",
          async () => {
            syntheticCrmValue = {
              summary: "合成查詢待人工覆核",
              urgency: "normal",
              timeline: null,
              action: { type: "review_enquiry", reason: "核對已收原訊息" },
              suggested_tags: [
                { tag: "needs_confirmation", confidence: 0.4, reason: "待人工確認" },
              ],
            };
            await query(
              "UPDATE staff_users SET auth_user_id='qa-golden-manager',active=true WHERE id=$1",
              [ids.manager],
            );
            const actor = {
              staffId: ids.manager,
              authUserId: "qa-golden-manager",
              roles: ["manager"],
              email: null,
              name: null,
              bootstrap: false,
            };
            const [lead] = await query(
              "INSERT INTO crm_leads(contact_id,property_id,source,assigned_agent_id) VALUES($1,$2,'website',$3) RETURNING id",
              [enquiry.contact_id, ids.property, ids.s1],
            );
            const { analyzeCrmLead, approveCrmAiTag } =
              await import("../src/lib/ai/crm-enrichment.server.ts");
            const runId = randomUUID();
            const generated = await analyzeCrmLead(lead.id, actor, { requestId: runId });
            assert.equal(generated.analysis.status, "completed");
            assert.equal(generated.analysis.resultKind, "model_validated");
            const [tag] = await query(
              "SELECT * FROM crm_ai_tags WHERE lead_id=$1 AND status='suggested'",
              [lead.id],
            );
            assert.equal(tag.analysis_run_id, runId);
            await approveCrmAiTag({ tagId: tag.id, staffId: actor.staffId, approve: true }, actor);
            const [stored] = await query(
              "SELECT r.status,r.source_fingerprint,p.result_kind,t.status tag_status FROM crm_ai_analysis_runs r JOIN crm_ai_profiles p ON p.analysis_run_id=r.id JOIN crm_ai_tags t ON t.analysis_run_id=r.id WHERE r.id=$1 AND t.id=$2",
              [runId, tag.id],
            );
            assert.equal(stored.status, "completed");
            assert.equal(stored.tag_status, "approved");
            assert.equal(stored.source_fingerprint, generated.analysis.sourceFingerprint);
            assert.deepEqual(
              (await analyzeCrmLead(lead.id, actor, { requestId: runId })).analysis.runId,
              runId,
            );
          },
        );
        await t.test(
          "Golden C saved price invalidates public AI then targeted repair restores canonical facts",
          async () => {
            const knowledge = await import("../src/lib/ai/knowledge.server.ts");
            await query("UPDATE properties SET price=12680000,status='active' WHERE id=$1", [
              ids.property,
            ]);
            await knowledge.rebuildAiKnowledgeIndex();
            const [identity] = await query(
              "SELECT public_listing_no FROM property_public_members WHERE property_id=$1",
              [ids.property],
            );
            const [version] = await query("SELECT admin_property_group_version($1) version", [
              identity.public_listing_no,
            ]);
            await query(
              "SELECT admin_property_manage($1,$2,'sale','{\"price\":12300000}'::jsonb,$3)",
              [identity.public_listing_no, version.version, ids.manager],
            );
            assert.equal(
              (await query("SELECT price::text FROM properties WHERE id=$1", [ids.property]))[0]
                .price,
              "12300000",
            );
            const { canonicalListingCte } = await import("../src/lib/neon/public-listing-query.js");
            const publicRows = await query(
              canonicalListingCte("TRUE") +
                " SELECT p.price::text,canonical.public_listing_no FROM canonical JOIN properties p ON p.id=canonical.id WHERE canonical.public_listing_no=$1",
              [identity.public_listing_no],
            );
            assert.equal(publicRows.length, 1);
            assert.equal(publicRows[0].price, "12300000");
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM ai_knowledge_chunks WHERE listing_id=$1 AND stale",
                  [ids.property],
                )
              )[0].n,
              1,
            );
            await knowledge.repairPublicKnowledgeIndex();
            const fresh = await knowledge.searchPublicKnowledge({ query: "碧堤半島", limit: 12 });
            // FX-11a writes listing prices into knowledge chunks as HK$ with a 萬 gloss
            // ("出售：$12,300,000（1230萬）"), so match the formatted figure.
            assert.ok(
              fresh.some(
                (c) => c.listing_id === ids.property && c.chunk_text.includes("$12,300,000"),
              ),
            );
            assert.ok(
              !fresh.some(
                (c) =>
                  c.listing_id === ids.property &&
                  (c.chunk_text.includes("$12,680,000") || c.chunk_text.includes("12680000")),
              ),
            );
          },
        );
        await t.test(
          "eight concurrent owned actor sessions enforce admin/manager/agent/viewer and other-branch scope",
          async () => {
            const [otherBranch] = await query(
              "INSERT INTO branches(slug,name) VALUES('qa-golden-other','合成另一分行') RETURNING id",
            );
            const actors = [];
            const roles = [
              "admin",
              "admin",
              "manager",
              "manager",
              "agent",
              "agent",
              "viewer",
              "viewer",
            ];
            for (const [i, role] of roles.entries()) {
              const authUserId = "qa-golden-session-" + i;
              const [staff] = await query(
                "INSERT INTO staff_users(auth_user_id,branch_id) VALUES($1,$2) RETURNING id",
                [authUserId, i % 2 ? otherBranch.id : ids.branch],
              );
              await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [
                staff.id,
                role,
              ]);
              actors.push({
                staffId: staff.id,
                authUserId,
                roles: [role],
                email: null,
                name: null,
                bootstrap: false,
              });
            }
            const [lead] = await query(
              "INSERT INTO crm_leads(source,assigned_agent_id) VALUES('website',$1) RETURNING id",
              [actors[4].staffId],
            );
            const { analyzeCrmLead } = await import("../src/lib/ai/crm-enrichment.server.ts");
            const results = await Promise.all(
              actors.map((actor) => analyzeCrmLead(lead.id, actor, { requestId: randomUUID() })),
            );
            for (const i of [5, 6, 7]) assert.equal(results[i].analysis.status, "denied");
            for (const i of [0, 1, 2, 3, 4]) assert.notEqual(results[i].analysis.status, "denied");
            const [profile] = await query(
              "SELECT r.actor_staff_id FROM crm_ai_profiles p JOIN crm_ai_analysis_runs r ON r.id=p.analysis_run_id WHERE p.lead_id=$1",
              [lead.id],
            );
            assert.ok(actors.slice(0, 5).some((actor) => actor.staffId === profile.actor_staff_id));
          },
        );
        await t.test(
          "owned pg_dump restore preserves receipts, FK, provenance and replay identity without overwriting recent live writes",
          async () => {
            const tables = [
              "app_migrations",
              "whatsapp_inbound_receipts",
              "whatsapp_enquiry_events",
              "inquiries",
              "crm_ai_analysis_runs",
              "crm_ai_profiles",
              "crm_ai_tags",
              "whatsapp_outbound_intents",
            ];
            const counts = Object.fromEntries(
              await Promise.all(
                tables.map(async (table) => [
                  table,
                  (await query(`SELECT count(*)::int n FROM ${table}`))[0].n,
                ]),
              ),
            );
            await withRestoredOwnedSnapshot({ containerId, pool }, async (restored) => {
              for (const table of tables)
                assert.equal(
                  (await restored.query(`SELECT count(*)::int n FROM ${table}`))[0].n,
                  counts[table],
                  table,
                );
              assert.equal(
                (
                  await restored.query(
                    "SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND NOT convalidated",
                  )
                )[0].n,
                0,
              );
              const { storeInboundReceipt } =
                await import("../src/lib/whatsapp-enquiries/inbound-receipts.server.ts");
              const replay = await storeInboundReceipt(
                {
                  tenantKey: receipt.tenant_key,
                  appId: receipt.app_id,
                  channelId: receipt.channel_id,
                  eventKind: receipt.event_kind,
                  origin: receipt.origin,
                  event: receipt.normalized_event,
                  bodyDigest: receipt.body_digest,
                  receivedAt: new Date(receipt.received_at),
                  providerOccurredAt: receipt.provider_occurred_at,
                  providerEventId: null,
                  capture: {
                    mode: receipt.capture_mode,
                    activationId: receipt.activation_id,
                    effectsEligible: receipt.effects_eligible,
                  },
                },
                { query: restored.query },
              );
              assert.equal(replay.receiptId, receipt.id);
              assert.equal(replay.disposition, "duplicate");
              assert.equal(
                (await restored.query("SELECT count(*)::int n FROM whatsapp_inbound_receipts"))[0]
                  .n,
                counts.whatsapp_inbound_receipts,
              );
              // Restore goes into a new DB. The current source continues accepting new data.
              const [recent] = await query(
                "INSERT INTO crm_leads(source,note) VALUES('test','合成還原後新寫入') RETURNING id",
              );
              assert.equal(
                (await query("SELECT count(*)::int n FROM crm_leads WHERE id=$1", [recent.id]))[0]
                  .n,
                1,
              );
              assert.equal(
                (
                  await restored.query("SELECT count(*)::int n FROM crm_leads WHERE id=$1", [
                    recent.id,
                  ])
                )[0].n,
                0,
              );
              t.diagnostic(
                `Owned restored clone: ${restored.dumpBytes} dump bytes; original recent write retained; restored receipt replay creates zero duplicates`,
              );
            });
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
