// FX-08 Task 4 / D-02: definite provider refusals become `failed`, and a manager can resolve a
// real `unknown` send (migration B) on owned full-schema Postgres.
// Synthetic data only. No provider call: fetch throws, wake is disabled, and every send is a
// fake that counts its calls. Resolving never resends anything.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test, { mock } from "node:test";
import {
  mockOwnedServerDb,
  repoRoot,
  withOwnedPostgres,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS, pendingMigrations } from "../control-plane/migration-versions.js";
import { formatDriftReport } from "../../../scripts/neon/check-migration-drift.mjs";

const MIGRATION = "20261008110000_outbound_unknown_resolution.sql";
const REVERT_PATH = "neon/reverts/20261008110000_outbound_unknown_resolution_revert.sql";
const STATES = [
  "accepted",
  "cancelled",
  "dispatching",
  "failed",
  "queued",
  "resolved_not_sent",
  "resolved_sent",
  "unknown",
];
const RESOLVED = "whatsapp.outbound_unknown_resolved";
const CHANNEL = "synthetic-unknown-channel";
const id = (n) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Windows checkouts may carry CRLF; compare the reviewed text, not the platform EOL.
const read = (path) => readFileSync(new URL(path, repoRoot), "utf8").replace(/\r\n/g, "\n");

test("FX-08 unknown outcomes (owned Postgres)", { timeout: 300000 }, async (t) => {
  const network = mock.method(globalThis, "fetch", () => {
    throw Error("Provider/network request forbidden in owned unknown-outcome acceptance");
  });
  const previousWake = process.env.OPS_EVENT_WAKE_ENABLED;
  delete process.env.OPS_EVENT_WAKE_ENABLED;
  try {
    await withOwnedPostgres(async ({ pool, query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const {
        enqueueOutboundIntent,
        deliverOutboundIntent,
        finishOutboundIntent,
        readOutboundReservation,
      } = await import("./outbound-intent.server.ts");
      const { resolveUnknownOutbound, UNKNOWN_RESOLUTION_MIN_AGE_MINUTES } =
        await import("./outbound-resolution.server.ts");
      assert.equal(UNKNOWN_RESOLUTION_MIN_AGE_MINUTES, 15);

      // The manager has a branch and the conversations are assigned to them, so the current
      // wa_can_read_conversation (branch-scoped managers) and the FX-06 one (org-wide managers)
      // both grant the read. A manager with no branch cannot read today (see the report).
      const BRANCH = id(400),
        OTHER_BRANCH = id(401),
        MANAGER = id(410),
        MANAGER_2 = id(411),
        AGENT = id(412),
        VIEWER = id(413),
        INACTIVE_MANAGER = id(414),
        OTHER_MANAGER = id(415);
      await query(
        "INSERT INTO branches(id,slug,name) VALUES($1,'synthetic-unknown-a','合成分行甲'),($2,'synthetic-unknown-b','合成分行乙')",
        [BRANCH, OTHER_BRANCH],
      );
      for (const [staffId, role, active, branch] of [
        [MANAGER, "manager", true, BRANCH],
        [MANAGER_2, "manager", true, BRANCH],
        [AGENT, "agent", true, BRANCH],
        [VIEWER, "viewer", true, BRANCH],
        [INACTIVE_MANAGER, "manager", false, BRANCH],
        [OTHER_MANAGER, "manager", true, OTHER_BRANCH],
      ]) {
        await query(
          "INSERT INTO staff_users(id,auth_user_id,name_zh,active,branch_id) VALUES($1,$2,'合成職員',$3,$4)",
          [staffId, `synthetic-unknown-${role}-${staffId.slice(-3)}`, active, branch],
        );
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [staffId, role]);
      }
      const manager = { staffId: MANAGER, roles: ["manager"] };

      let seq = 0;
      // A fresh contact + conversation, inside the 24 h window, assigned to MANAGER.
      const newConversation = async () => {
        seq += 1;
        const contactId = randomUUID();
        const conversationId = randomUUID();
        await query(
          "INSERT INTO crm_contacts(id,name,source,whatsapp_member_id,last_inbound_at) VALUES($1,'合成客戶','test',$2,now())",
          [contactId, `synthetic-unknown-member-${seq}`],
        );
        await query(
          `INSERT INTO whatsapp_conversations(id,contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at,assigned_agent_id,confirmed_staff_id)
           VALUES($1,$2,$3,$4,now(),now(),$5,$5)`,
          [conversationId, contactId, `synthetic-unknown-member-${seq}`, CHANNEL, MANAGER],
        );
        return { conversationId, contactId, member: `synthetic-unknown-member-${seq}` };
      };
      let sends = 0;
      const enqueue = (conversationId, extra = {}) =>
        enqueueOutboundIntent(
          {
            requestId: randomUUID(),
            conversationId,
            kind: "text",
            payload: { text: "合成回覆 " + randomUUID() },
            ...extra,
          },
          MANAGER,
          null,
        );
      // Real enqueue, a real ops_jobs lease and the real begin/finish; only `send` is fake.
      const deliver = async (conversationId, outcome, extra = {}) => {
        const { id: intentId } = await enqueue(conversationId, extra);
        const [job] = await query(
          "UPDATE ops_jobs SET status='running',lease_owner='synthetic-worker',lease_expires_at=now()+interval '5 minutes' WHERE idempotency_key=$1 RETURNING id",
          ["woztell.reply:" + intentId],
        );
        await deliverOutboundIntent(intentId, {
          checkpoint: async () => {},
          job: { jobId: job.id, workerId: "synthetic-worker" },
          send: async () => {
            sends++;
            if (outcome instanceof Error) throw outcome;
            return outcome;
          },
        });
        return intentId;
      };
      const timeout = () =>
        Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        });
      const intent = async (intentId) =>
        (
          await query(
            `SELECT i.state,i.error,i.resolved_at,i.resolved_by,i.resolution_reason,i.dispatch_started_at,
              i.external_message_id,m.status AS message_status
             FROM whatsapp_outbound_intents i JOIN whatsapp_messages m ON m.id=i.message_id WHERE i.id=$1`,
            [intentId],
          )
        )[0];
      const age = (intentId, minutes) =>
        query(
          "UPDATE whatsapp_outbound_intents SET dispatch_started_at=now()-make_interval(mins => $2::int) WHERE id=$1",
          [intentId, minutes],
        );
      const audits = (intentId) =>
        query(
          "SELECT actor_id,subject_type,metadata FROM audit_logs WHERE action=$1 AND subject_id=$2 ORDER BY created_at",
          [RESOLVED, intentId],
        );
      const resolve = (intentId, conversationId, outcome = "resolved_not_sent", actor = manager) =>
        resolveUnknownOutbound(
          {
            intentId,
            conversationId,
            outcome,
            reason: "已向客戶電話確認沒有收到",
          },
          actor,
        );
      // assert.rejects needs a synchronous validator, so the Response body is read here.
      const rejectsWith = async (promise, status, body) => {
        let error;
        try {
          await promise;
        } catch (caught) {
          error = caught;
        }
        assert.ok(error instanceof Response, `expected a ${status} Response, got ${error}`);
        assert.equal(error.status, status);
        if (body) assert.equal(await error.text(), body);
      };
      const dbError = async (promise, code) => {
        await assert.rejects(promise, (error) => {
          assert.match(String(error.message), new RegExp(code));
          return true;
        });
      };

      await t.test("401 non-JSON → failed, next send allowed", async () => {
        const { conversationId } = await newConversation();
        const before = sends;
        const intentId = await deliver(conversationId, {
          ok: false,
          error: "WOZTELL_INVALID_RESPONSE",
          status: 401,
        });
        assert.equal(sends, before + 1);
        const row = await intent(intentId);
        assert.equal(row.state, "failed");
        assert.equal(row.error, "WOZTELL_PROVIDER_REJECTED");
        assert.equal(row.message_status, "failed");
        assert.deepEqual(await readOutboundReservation({ conversationId }, MANAGER, null, query), {
          blocked: false,
          intent: null,
        });
        // No OUTBOUND_RECONCILIATION_REQUIRED: the next staff send is queued.
        assert.equal((await enqueue(conversationId)).state, "queued");
        // A config error is failed too, and does not lock either.
        const configId = await deliver((await newConversation()).conversationId, {
          ok: false,
          error: "WOZTELL_ENABLED is not true",
          stage: "preflight",
        });
        assert.equal((await intent(configId)).state, "failed");
        assert.equal((await intent(configId)).error, "WOZTELL_CONFIGURATION_UNAVAILABLE");
      });

      await t.test("timeout → unknown; resolveUnknownOutbound releases lock", async () => {
        const { conversationId } = await newConversation();
        const intentId = await deliver(conversationId, timeout());
        assert.equal((await intent(intentId)).state, "unknown");
        await assert.rejects(enqueue(conversationId), /OUTBOUND_RECONCILIATION_REQUIRED/);
        assert.equal(
          (await readOutboundReservation({ conversationId }, MANAGER, null, query)).blocked,
          true,
        );
        await age(intentId, 16);
        const result = await resolve(intentId, conversationId);
        assert.deepEqual(result, {
          ok: true,
          intentId,
          state: "resolved_not_sent",
          changed: true,
          lockReleased: true,
        });
        const row = await intent(intentId);
        assert.equal(row.state, "resolved_not_sent");
        assert.equal(row.message_status, "resolved_not_sent");
        assert.equal(row.resolved_by, MANAGER);
        assert.ok(row.resolved_at);
        assert.equal(row.resolution_reason, "已向客戶電話確認沒有收到");
        assert.equal(row.error, "WOZTELL_DELIVERY_UNKNOWN");
        const logged = await audits(intentId);
        assert.equal(logged.length, 1);
        assert.equal(logged[0].actor_id, MANAGER);
        assert.equal(logged[0].subject_type, "whatsapp_outbound_intent");
        assert.equal(logged[0].metadata.conversationId, conversationId);
        assert.equal(logged[0].metadata.outcome, "resolved_not_sent");
        assert.equal(logged[0].metadata.reason, "已向客戶電話確認沒有收到");
        assert.equal(logged[0].metadata.kind, "text");
        assert.equal(logged[0].metadata.actorType, "staff");
        assert.equal(logged[0].metadata.previousError, "WOZTELL_DELIVERY_UNKNOWN");
        assert.ok(logged[0].metadata.dispatchStartedAt);
        assert.deepEqual(await readOutboundReservation({ conversationId }, MANAGER, null, query), {
          blocked: false,
          intent: null,
        });
        assert.equal((await enqueue(conversationId)).state, "queued");
      });

      await t.test(
        "resolution is refused until 15 minutes after dispatch_started_at and never enqueues, sends or credits a human response",
        async () => {
          const { conversationId } = await newConversation();
          const enquiryId = randomUUID();
          await query(
            `INSERT INTO inquiries(id,source,name,status,conversation_id,attribution_method,customer_message_at,association_review,provider_thread_review)
             VALUES($1,'whatsapp','合成客戶','new',$2,'reference',now()-interval '1 hour',false,false)`,
            [enquiryId, conversationId],
          );
          const intentId = await deliver(conversationId, timeout(), { enquiryId });
          assert.equal(
            (
              await query("SELECT enquiry_id FROM whatsapp_outbound_intents WHERE id=$1", [
                intentId,
              ])
            )[0].enquiry_id,
            enquiryId,
          );
          await age(intentId, 14);
          await rejectsWith(
            resolve(intentId, conversationId, "resolved_sent"),
            409,
            "OUTBOUND_RESOLUTION_TOO_EARLY",
          );
          assert.equal((await intent(intentId)).state, "unknown");
          assert.equal((await audits(intentId)).length, 0);

          await age(intentId, 16);
          const snapshot = async () => ({
            jobs: (await query("SELECT count(*)::int n FROM ops_jobs"))[0].n,
            evidence: (
              await query("SELECT count(*)::int n FROM whatsapp_human_response_evidence")
            )[0].n,
            firstResponse: (
              await query("SELECT first_human_response_at::text AS t FROM inquiries WHERE id=$1", [
                enquiryId,
              ])
            )[0].t,
            sends,
            fetches: network.mock.callCount(),
            intents: (await query("SELECT count(*)::int n FROM whatsapp_outbound_intents"))[0].n,
          });
          const before = await snapshot();
          const result = await resolve(intentId, conversationId, "resolved_sent");
          assert.equal(result.changed, true);
          assert.equal(result.state, "resolved_sent");
          assert.deepEqual(await snapshot(), before);
          assert.equal(before.firstResponse, null);
          assert.equal((await intent(intentId)).message_status, "resolved_sent");

          const source = read("src/lib/woztell/outbound-resolution.server.ts");
          assert.doesNotMatch(source, /woztell\.server/);
          assert.doesNotMatch(source, /enqueueOutboundIntent/);
          assert.doesNotMatch(source, /ops_jobs/i);
          assert.doesNotMatch(source, /sendWoztellResponse|deliverOutboundIntent|fetch\(/);
        },
      );

      await t.test("idempotency: double click and two managers resolve once", async () => {
        const { conversationId } = await newConversation();
        const intentId = await deliver(conversationId, timeout());
        await age(intentId, 20);
        const results = await Promise.all([
          resolve(intentId, conversationId),
          resolve(intentId, conversationId),
        ]);
        assert.ok(results.every((r) => r.ok && r.state === "resolved_not_sent"));
        assert.deepEqual(results.map((r) => r.changed).sort(), [false, true]);
        assert.ok(results.every((r) => r.lockReleased));
        const second = await resolve(intentId, conversationId, "resolved_not_sent", {
          staffId: MANAGER_2,
          roles: ["manager"],
        });
        assert.equal(second.changed, false);
        assert.equal((await intent(intentId)).resolved_by, MANAGER);
        assert.equal((await audits(intentId)).length, 1);
        await rejectsWith(
          resolve(intentId, conversationId, "resolved_sent", {
            staffId: MANAGER_2,
            roles: ["manager"],
          }),
          409,
          "OUTBOUND_ALREADY_RESOLVED",
        );
        assert.equal((await intent(intentId)).state, "resolved_not_sent");
        assert.equal((await audits(intentId)).length, 1);
      });

      await t.test(
        "wrong-recipient guard: an intent id with another conversation's id is not found",
        async () => {
          const a = await newConversation();
          const b = await newConversation();
          const intentId = await deliver(a.conversationId, timeout());
          await age(intentId, 20);
          await rejectsWith(
            resolve(intentId, b.conversationId),
            404,
            "OUTBOUND_NOT_FOUND_OR_FORBIDDEN",
          );
          await rejectsWith(
            resolve(randomUUID(), a.conversationId),
            404,
            "OUTBOUND_NOT_FOUND_OR_FORBIDDEN",
          );
          const row = await intent(intentId);
          assert.equal(row.state, "unknown");
          assert.equal(row.resolved_by, null);
          assert.equal((await audits(intentId)).length, 0);
        },
      );

      await t.test(
        "approval gate: agent, viewer and inactive manager get 403; the reason is required",
        async () => {
          const { conversationId } = await newConversation();
          const intentId = await deliver(conversationId, timeout());
          await age(intentId, 20);
          for (const actor of [
            { staffId: AGENT, roles: ["agent"] },
            { staffId: VIEWER, roles: ["viewer"] },
            { staffId: INACTIVE_MANAGER, roles: ["manager"] },
            // A stale or forged role claim is re-checked against staff_roles in SQL.
            { staffId: AGENT, roles: ["manager"] },
          ])
            await rejectsWith(
              resolve(intentId, conversationId, "resolved_not_sent", actor),
              403,
              undefined,
            );
          // An active manager who cannot read the conversation is refused too. Today that is a
          // manager of another branch; once FX-06 makes manager reads org-wide it cannot happen.
          const [{ readable }] = await query("SELECT wa_can_read_conversation($1,$2) AS readable", [
            OTHER_MANAGER,
            conversationId,
          ]);
          if (!readable)
            await rejectsWith(
              resolve(intentId, conversationId, "resolved_not_sent", {
                staffId: OTHER_MANAGER,
                roles: ["manager"],
              }),
              403,
              undefined,
            );
          for (const value of [
            { intentId, conversationId, outcome: "resolved_not_sent", reason: "短" },
            { intentId, conversationId, outcome: "resolved_not_sent", reason: "    abcd   " },
            { intentId, conversationId, outcome: "resolved_not_sent" },
            { intentId, conversationId, outcome: "resolved_not_sent", reason: "x".repeat(501) },
            { intentId, conversationId, outcome: "accepted", reason: "已向客戶確認" },
            { intentId, conversationId, outcome: "resolved_sent", reason: "已向客戶確認", x: 1 },
            { intentId: "bad", conversationId, outcome: "resolved_sent", reason: "已向客戶確認" },
          ])
            await rejectsWith(resolveUnknownOutbound(value, manager), 400, "VALIDATION_ERROR");
          const row = await intent(intentId);
          assert.equal(row.state, "unknown");
          assert.equal(row.resolved_at, null);
          assert.equal(row.resolution_reason, null);
          assert.equal((await audits(intentId)).length, 0);
        },
      );

      await t.test(
        "a resolved intent is final; provider evidence and lease recovery cannot move it",
        async () => {
          // Both sends possibly reached the provider: unknown, with an external id kept.
          const possible = (externalId) => ({
            ok: false,
            error: "WOZTELL_HTTP_500",
            status: 500,
            body: { ok: 1, messageId: externalId },
          });
          const resolved = await newConversation();
          const control = await newConversation();
          const resolvedExt = "synthetic-unknown-ext-" + randomUUID();
          const controlExt = "synthetic-unknown-ext-" + randomUUID();
          const intentId = await deliver(resolved.conversationId, possible(resolvedExt));
          const controlId = await deliver(control.conversationId, possible(controlExt));
          assert.equal((await intent(intentId)).state, "unknown");
          assert.equal((await intent(intentId)).external_message_id, resolvedExt);
          await age(intentId, 20);
          await resolve(intentId, resolved.conversationId);
          const frozen = await intent(intentId);
          assert.equal(frozen.state, "resolved_not_sent");

          await dbError(
            query("UPDATE whatsapp_outbound_intents SET state='unknown' WHERE id=$1", [intentId]),
            "OUTBOUND_RESOLUTION_FINAL",
          );
          await dbError(
            query("UPDATE whatsapp_outbound_intents SET state='resolved_sent' WHERE id=$1", [
              intentId,
            ]),
            "OUTBOUND_RESOLUTION_FINAL",
          );
          await finishOutboundIntent(
            intentId,
            { state: "accepted", externalMessageId: resolvedExt, error: null },
            transaction,
          );
          assert.equal((await intent(intentId)).state, "resolved_not_sent");

          const { ingestWoztellEvent } = await import("./woztell-ingest.server.ts");
          const { normalizeWoztellEvent } = await import("./woztell.server.ts");
          const receipt = (externalId, member) =>
            ingestWoztellEvent(
              normalizeWoztellEvent({
                type: "DELIVERED",
                messageId: externalId,
                member,
                channel: CHANNEL,
                timestamp: Date.now(),
              }),
              "live_webhook",
              transaction,
              { mode: "off", signedEvent: true, wake: () => assert.fail("no wake") },
            );
          await receipt(controlExt, control.member);
          await receipt(resolvedExt, resolved.member);
          // Control: the same signed receipt does resolve a still-unknown intent.
          assert.equal((await intent(controlId)).state, "accepted");
          const after = await intent(intentId);
          assert.equal(after.state, "resolved_not_sent");
          assert.equal(after.resolved_by, frozen.resolved_by);
          assert.equal(String(after.resolved_at), String(frozen.resolved_at));

          // Lease recovery: an expired reply job turns only `dispatching` into `unknown`.
          const recovery = read("src/lib/control-plane/jobs.server.ts");
          assert.match(
            recovery,
            /uncertain AS \(UPDATE whatsapp_outbound_intents o SET state='unknown',[^\n]*AND o\.state='dispatching' RETURNING o\.\*\),/,
          );
          await query(
            "UPDATE ops_jobs SET status='running',lease_owner='synthetic-expired',lease_expires_at=now()-interval '1 minute' WHERE idempotency_key=$1",
            ["woztell.reply:" + intentId],
          );
          const { recoverExpiredServiceLeases } = await import("../control-plane/jobs.server.ts");
          await recoverExpiredServiceLeases(query);
          assert.equal((await intent(intentId)).state, "resolved_not_sent");
        },
      );

      await t.test(
        "resolving a service-automation unknown also releases the staff lock",
        async () => {
          const { conversationId, contactId } = await newConversation();
          const serviceIntent = randomUUID();
          const messageId = randomUUID();
          await query(
            `INSERT INTO whatsapp_messages(id,conversation_id,contact_id,direction,message_type,text,status,woztell_member_id,channel_id)
           SELECT $1,$2,$3,'outbound','TEXT','合成問卷','unknown',woztell_member_id,channel_id
           FROM whatsapp_conversations WHERE id=$2`,
            [messageId, conversationId, contactId],
          );
          // A service intent needs a whole survey/action chain. For this synthetic fixture only, the
          // FK and trigger layer is skipped for one insert; every CHECK constraint still applies.
          await transaction([
            { statement: "SET LOCAL session_replication_role = replica", params: [] },
            {
              statement: `INSERT INTO whatsapp_outbound_intents(id,conversation_id,actor_type,actor_staff_id,service_action_id,kind,payload,payload_hash,message_id,state,error,dispatch_started_at)
              VALUES($1,$2,'service',NULL,$3,'text','{"text":"合成問卷"}'::jsonb,repeat('a',64),$4,'unknown','WOZTELL_DELIVERY_UNKNOWN',now()-interval '30 minutes')`,
              params: [serviceIntent, conversationId, randomUUID(), messageId],
            },
          ]);
          await assert.rejects(enqueue(conversationId), /OUTBOUND_RECONCILIATION_REQUIRED/);
          const result = await resolve(serviceIntent, conversationId);
          assert.equal(result.changed, true);
          assert.equal(result.lockReleased, true);
          const logged = await audits(serviceIntent);
          assert.equal(logged.length, 1);
          assert.equal(logged[0].metadata.actorType, "service");
          assert.equal((await intent(serviceIntent)).message_status, "resolved_not_sent");
          assert.equal((await enqueue(conversationId)).state, "queued");
        },
      );

      await t.test("only unknown can be resolved", async () => {
        const queuedConv = await newConversation();
        const { id: queuedId } = await enqueue(queuedConv.conversationId);
        const dispatchingConv = await newConversation();
        const { id: dispatchingId } = await enqueue(dispatchingConv.conversationId);
        await query(
          "UPDATE whatsapp_outbound_intents SET state='dispatching',dispatch_started_at=now()-interval '1 hour' WHERE id=$1",
          [dispatchingId],
        );
        const acceptedConv = await newConversation();
        const acceptedId = await deliver(acceptedConv.conversationId, {
          ok: true,
          status: 200,
          body: { ok: 1, messageId: "synthetic-unknown-accepted-" + randomUUID() },
        });
        const failedConv = await newConversation();
        const failedId = await deliver(failedConv.conversationId, {
          ok: false,
          error: "WOZTELL_HTTP_403",
          status: 403,
          body: {},
          refused: false,
        });
        for (const [intentId, conversationId, state] of [
          [queuedId, queuedConv.conversationId, "queued"],
          [dispatchingId, dispatchingConv.conversationId, "dispatching"],
          [acceptedId, acceptedConv.conversationId, "accepted"],
          [failedId, failedConv.conversationId, "failed"],
        ]) {
          await age(intentId, 60);
          assert.equal((await intent(intentId)).state, state);
          await rejectsWith(resolve(intentId, conversationId), 409, "OUTBOUND_NOT_UNKNOWN");
          assert.equal((await intent(intentId)).state, state);
          assert.equal((await audits(intentId)).length, 0);
        }
        // The guard trigger: only from unknown, only with actor, time and reason.
        const unknownConv = await newConversation();
        const unknownId = await deliver(unknownConv.conversationId, timeout());
        await dbError(
          query("UPDATE whatsapp_outbound_intents SET state='resolved_sent' WHERE id=$1", [
            unknownId,
          ]),
          "OUTBOUND_RESOLUTION_INVALID",
        );
        await dbError(
          query(
            "UPDATE whatsapp_outbound_intents SET state='resolved_sent',resolved_at=now(),resolution_reason='synthetic' WHERE id=$1",
            [unknownId],
          ),
          "OUTBOUND_RESOLUTION_INVALID",
        );
        await dbError(
          query(
            "UPDATE whatsapp_outbound_intents SET state='resolved_not_sent',resolved_at=now(),resolved_by=$2,resolution_reason='synthetic' WHERE id=$1",
            [failedId, MANAGER],
          ),
          "OUTBOUND_RESOLUTION_INVALID",
        );
        await dbError(
          query(
            `INSERT INTO whatsapp_outbound_intents(id,conversation_id,actor_staff_id,kind,payload,payload_hash,message_id,state,resolved_at,resolved_by,resolution_reason)
             VALUES($1,$2,$3,'text','{"text":"x"}'::jsonb,repeat('b',64),$4,'resolved_sent',now(),$3,'synthetic')`,
            [randomUUID(), unknownConv.conversationId, MANAGER, randomUUID()],
          ),
          "OUTBOUND_RESOLUTION_INVALID",
        );
        assert.equal((await intent(unknownId)).state, "unknown");
      });

      await t.test(
        "migration B widens the state check, adds the guard, and the revert drops only the guard",
        async () => {
          assert.ok(MIGRATION_VERSIONS.includes(MIGRATION));
          const checkStates = async () => {
            const rows = await query(
              `SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint
               WHERE conrelid='whatsapp_outbound_intents'::regclass AND contype='c'
                 AND conname IN ('wa_intent_state_check','whatsapp_outbound_intents_state_check')`,
            );
            assert.deepEqual(
              rows.map((r) => r.conname),
              ["wa_intent_state_check"],
            );
            return [...rows[0].def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
          };
          const triggers = async () =>
            (
              await query(
                `SELECT tgname FROM pg_trigger WHERE tgrelid='whatsapp_outbound_intents'::regclass
                 AND NOT tgisinternal ORDER BY tgname`,
              )
            ).map((r) => r.tgname);
          const guardFunction = async () =>
            (
              await query("SELECT count(*)::int n FROM pg_proc WHERE proname=$1", [
                "wa_guard_outbound_resolution",
              ])
            )[0].n;
          assert.deepEqual(await checkStates(), STATES);
          assert.ok((await triggers()).includes("wa_intent_resolution_guard"));
          assert.ok((await triggers()).includes("wa_intent_unknown_reservation"));
          const columns = await query(
            `SELECT column_name,data_type FROM information_schema.columns
             WHERE table_name='whatsapp_outbound_intents' AND column_name IN ('resolved_at','resolved_by','resolution_reason')
             ORDER BY column_name`,
          );
          assert.deepEqual(
            columns.map((c) => [c.column_name, c.data_type]),
            [
              ["resolution_reason", "text"],
              ["resolved_at", "timestamp with time zone"],
              ["resolved_by", "uuid"],
            ],
          );

          const forward = read("neon/migrations/" + MIGRATION);
          const revert = read(REVERT_PATH);
          // Bounded lock wait inside the runner transaction, first statement in the file.
          assert.equal(
            forward.split("\n").find((line) => line.trim() && !line.trim().startsWith("--")),
            "SET LOCAL lock_timeout = '5s';",
          );
          assert.match(
            forward,
            /neon\/reverts\/20261008110000_outbound_unknown_resolution_revert\.sql/,
          );
          // It never touches the reservation guard, and never rewrites an intent row.
          assert.doesNotMatch(
            forward,
            /wa_guard_outbound_reservation|wa_intent_unknown_reservation/,
          );
          assert.doesNotMatch(forward, /UPDATE\s+whatsapp_outbound_intents/i);
          assert.doesNotMatch(forward, /DEFAULT/i);
          assert.match(revert, /DROP TRIGGER IF EXISTS wa_intent_resolution_guard/);
          assert.match(revert, /DROP FUNCTION IF EXISTS wa_guard_outbound_resolution\(\)/);
          assert.doesNotMatch(revert, /DROP CONSTRAINT|DROP COLUMN|wa_intent_unknown_reservation/);
          assert.match(revert, /lives outside neon\/migrations/);
          assert.match(revert, /owner approval/);
          assert.match(revert, /app_migrations row/);
          // apply-migrations.mjs splits statements on these characters, so comments avoid them.
          for (const [file, sql] of [
            [MIGRATION, forward],
            [REVERT_PATH, revert],
          ])
            for (const line of sql.split("\n").filter((l) => l.trim().startsWith("--")))
              assert.doesNotMatch(line, /[;']/, `${file}: ${line}`);

          const rows = async () =>
            query("SELECT id,xmin::text AS xmin,state FROM whatsapp_outbound_intents ORDER BY id");
          const before = await rows();
          assert.ok(before.length > 10);
          await pool.query(revert);
          assert.ok(!(await triggers()).includes("wa_intent_resolution_guard"));
          assert.equal(await guardFunction(), 0);
          assert.deepEqual(await checkStates(), STATES);
          assert.ok((await triggers()).includes("wa_intent_unknown_reservation"));
          // Re-apply the forward file twice, as the runner would (one transaction each).
          for (let i = 0; i < 2; i++) {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              await client.query(forward);
              await client.query("COMMIT");
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            } finally {
              client.release();
            }
          }
          assert.ok((await triggers()).includes("wa_intent_resolution_guard"));
          assert.equal(await guardFunction(), 1);
          assert.deepEqual(await checkStates(), STATES);
          // No intent row was rewritten by the revert or by either re-application.
          assert.deepEqual(await rows(), before);
        },
      );

      await t.test("revert file is ignored by the migration runner and drift check", async () => {
        // The runner applies only `.sql` files directly inside neon/migrations
        // (non-recursive readdirSync), and the drift check reads MIGRATION_VERSIONS.
        const runner = read("scripts/neon/apply-migrations.mjs");
        assert.match(runner, /const migrationsDir = "neon\/migrations";/);
        assert.match(runner, /readdirSync\(migrationsDir\)/);
        assert.doesNotMatch(runner, /recursive|neon\/reverts/);
        const drift = read("scripts/neon/check-migration-drift.mjs");
        assert.match(drift, /MIGRATION_VERSIONS,\s*pendingMigrations,/);
        assert.doesNotMatch(drift, /readdirSync|neon\/reverts/);

        const revertName = REVERT_PATH.split("/").pop();
        const runnerFiles = readdirSync(new URL("neon/migrations/", repoRoot))
          .filter((file) => file.endsWith(".sql"))
          .sort();
        assert.ok(runnerFiles.includes(MIGRATION));
        assert.ok(!runnerFiles.includes(revertName));
        assert.ok(MIGRATION_VERSIONS.includes(MIGRATION));
        assert.ok(!MIGRATION_VERSIONS.some((version) => version.includes("revert")));
        assert.deepEqual(pendingMigrations(MIGRATION_VERSIONS), []);

        const applied = (await query("SELECT version FROM app_migrations ORDER BY version")).map(
          (row) => row.version,
        );
        assert.ok(applied.includes(MIGRATION));
        assert.ok(!applied.some((version) => version.includes("revert")));
        const report = formatDriftReport(pendingMigrations(applied));
        assert.equal(report.ok, true);
        assert.doesNotMatch(report.message, /revert/);
      });
    });
    assert.equal(network.mock.callCount(), 0);
  } finally {
    network.mock.restore();
    if (previousWake === undefined) delete process.env.OPS_EVENT_WAKE_ENABLED;
    else process.env.OPS_EVENT_WAKE_ENABLED = previousWake;
  }
});
