import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import { onDbTarget } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import {
  applyMigrations,
  isolatedDatabase,
  migrationsAfter,
  migrationsBefore,
} from "../../../scripts/acceptance/migrated-schema.mjs";
import {
  activateServiceGeneration,
  scheduleServiceForEvent,
  prepareServiceAction,
  deliverServiceAction,
  processServiceAnswer,
} from "./service-workflow.server.ts";
import { buildLiveEventStatements } from "./workflow.server.ts";
import { normalizeWoztellEvent } from "../woztell/woztell.server.ts";
import { customerGreetingScope, queueCustomerGreeting } from "./customer-greeting.server.ts";
import { storeInboundReceipt } from "./inbound-receipts.server.ts";
import { eventForReceiptProjection } from "./inbound-identity.ts";
import { getServiceHealth } from "./service-health.server.ts";
import {
  saveServicePolicyDraft,
  approveServicePolicy,
  listServicePolicies,
} from "./policy-admin.server.ts";
import { executeAssignment, reconcileAssignment } from "./assignment.server.ts";
import { observeEpisode } from "./episodes.server.ts";
import { claimJobs, recoverExpiredServiceLeases } from "../control-plane/jobs.server.ts";
import { SERVICE_CAPABILITIES } from "../control-plane/job-handlers.server.ts";
// The on-demand Neon run keeps its ASTRA_TEST_DATABASE_URL contract.
const neonRun = { urlVar: "ASTRA_TEST_DATABASE_URL" };
const SERVICE = "20260912150000_whatsapp_service_workflow.sql";
// Owned Docker Postgres by default (a fresh database in the container); ASTRA_TEST_DATABASE_URL
// (behind the disposable guard) for an explicit Neon run. In CI a missing database fails instead
// of skipping. The isolated schema is built from the real migrations, in order.
test(
  "Phase4 isolated service transactions and capability lane",
  onDbTarget(async (target, t) => {
    const { sql: db, end } = await isolatedDatabase(target),
      schema = "wa_p4_" + randomUUID().replaceAll("-", "");
    const tx = async (statements) =>
      (
        await db.transaction((q) => [
          q.query("SELECT set_config('search_path',$1,true)", [schema]),
          ...statements.map((s) => q.query(s.statement, s.params ?? [])),
        ])
      ).slice(1);
    const query = async (statement, params = []) => (await tx([{ statement, params }]))[0];
    const ports = { query, transaction: tx },
      admin = randomUUID(),
      contact = randomUUID(),
      conv = randomUUID(),
      policy = randomUUID();
    const now = new Date("2026-09-12T01:00:00Z");
    const rules = {
      timezone: "Asia/Hong_Kong",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      holidays: [],
      openMinute: 480,
      closeMinute: 1320,
      durationMode: "elapsed",
      beforeOpen: "overnight",
      atOpen: "daytime",
      atClose: "overnight",
      crossClosing: "elapsed",
      reception: "sales",
      suppressSurveyAfterHuman: false,
      freshnessSeconds: 3600,
      surveyExpirySeconds: 86400,
      workerLagSeconds: 3600,
      managerStaffId: admin,
      afterHoursCopy: "Hypothetical approved fixture after-hours copy",
    };
    let runtime,
      generation,
      sends = 0,
      lastToken;
    const adapter = {
      verificationRef: "SYNTHETIC_ONLY",
      render: ({ text, token }) => {
        lastToken = token;
        return [{ fixtureText: text, fixtureToken: token }];
      },
      send: async () => {
        sends++;
        return { ok: true, body: { messageId: "fixture-out-" + sends } };
      },
      decode: (p) => p?.fixtureAnswer ?? null,
    };
    async function capture(suffix, mode = "active", at = now) {
      const mid = randomUUID();
      await query(
        "INSERT INTO whatsapp_messages(id,conversation_id,contact_id,direction,message_type,text,channel_id,woztell_member_id,external_message_id) VALUES($1,$2,$3,'inbound','text','synthetic','fixture','synthetic',$4)",
        [mid, conv, contact, suffix],
      );
      const e = normalizeWoztellEvent({
        type: "TEXT",
        messageId: suffix,
        member: "synthetic",
        channel: "fixture",
        app: "fixture-app",
        timestamp: at.getTime() / 1000,
        data: { text: "synthetic" },
      });
      const statements = buildLiveEventStatements(e, at, mode);
      await tx(statements);
      const id = statements[0].params[0];
      await observeEpisode(id, query);
      return id;
    }
    async function running(actionId) {
      const [j] = await query(
        "SELECT id FROM ops_jobs WHERE job_type='woztell.reply.deliver' AND payload_version=2 AND payload->>'actionId'=$1",
        [actionId],
      );
      await tx([
        {
          statement: "SELECT set_config('app.wa_worker_capabilities',$1,true)",
          params: [JSON.stringify(SERVICE_CAPABILITIES)],
        },
        {
          statement:
            "UPDATE ops_jobs SET status='running',lease_owner='fixture-worker',lease_expires_at=now()+interval '5 minutes' WHERE id=$1::uuid",
          params: [j.id],
        },
      ]);
      return { checkpoint: async () => {}, job: { jobId: j.id, workerId: "fixture-worker" } };
    }
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      // The service migration is applied twice (re-runnable) at its place in the order.
      await applyMigrations(db, schema, migrationsBefore(SERVICE));
      await applyMigrations(db, schema, [SERVICE]);
      await applyMigrations(db, schema, [SERVICE]);
      await applyMigrations(db, schema, migrationsAfter(SERVICE));
      await query("INSERT INTO staff_users(id) VALUES($1)", [admin]);
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [admin]);
      await query("INSERT INTO crm_contacts(id) VALUES($1)", [contact]);
      await query(
        "INSERT INTO whatsapp_conversations(id,contact_id,channel_id,woztell_member_id,last_inbound_at) VALUES($1,$2,'fixture','synthetic',$3::timestamptz)",
        [conv, contact, now.toISOString()],
      );
      await query(
        "INSERT INTO whatsapp_service_policies(id,version,rules) VALUES($1,1,$2::jsonb)",
        [policy, JSON.stringify(rules)],
      );
      await t.test("AT38 unapproved activation fails", async () => {
        await assert.rejects(activateServiceGeneration(policy, admin, ports, now), /UNAPPROVED/);
      });
      await query(
        "UPDATE whatsapp_service_policies SET status='approved',approved_by=$2,copy_version='fixture-only',effective_at=$3::timestamptz WHERE id=$1",
        [policy, admin, "2026-09-11T00:00:00Z"],
      );
      generation = await activateServiceGeneration(
        policy,
        admin,
        ports,
        new Date(now.getTime() - 1000),
      );
      runtime = { enabled: true, generationId: generation, channelId: "fixture" };
      process.env.EP_WA_SERVICE_AUTOMATION_ENABLED = "true";
      process.env.EP_WA_ACTIVATION_ID = generation;
      process.env.EP_WA_COMPANY_CHANNEL_ID = "fixture";
      const event = await capture("fixture-intake");
      await t.test(
        "AT27 persisted fresh generation and concurrent scheduling create one survey plus durable job",
        async () => {
          const result = await Promise.all(
            Array.from({ length: 4 }, () => scheduleServiceForEvent(event, ports, runtime, now)),
          );
          assert.equal(
            result.reduce((n, r) => n + r.scheduled, 0),
            1,
          );
          assert.equal(
            (await query("SELECT count(*)::int n FROM whatsapp_service_surveys"))[0].n,
            1,
          );
          await assert.rejects(
            query("UPDATE whatsapp_enquiry_events SET effects_eligible=false WHERE id=$1", [event]),
            /IMMUTABLE/,
          );
        },
      );
      const [action] = await query("SELECT * FROM whatsapp_service_actions WHERE purpose='survey'");
      const due = new Date(action.due_at);
      await t.test(
        "AT42 one server-owned intent and transcript under concurrent preparation",
        async () => {
          await Promise.all(
            Array.from({ length: 4 }, () =>
              prepareServiceAction(action.id, ports, runtime, due, adapter),
            ),
          );
          assert.equal(
            (await query("SELECT count(*)::int n FROM whatsapp_outbound_intents"))[0].n,
            1,
          );
          assert.equal(
            (
              await query(
                "SELECT count(*)::int n FROM ops_jobs WHERE payload_version=2 AND job_type='woztell.reply.deliver'",
              )
            )[0].n,
            1,
          );
          const [o] = await query(
            "SELECT actor_type,actor_staff_id,payload FROM whatsapp_outbound_intents",
          );
          assert.equal(o.actor_type, "service");
          assert.equal(o.actor_staff_id, null);
          lastToken = o.payload.response[0].fixtureToken;
        },
      );
      await t.test(
        "AT49 concurrent dispatch invokes provider fixture once and does not credit human",
        async () => {
          const context = await running(action.id);
          await Promise.all(
            Array.from({ length: 3 }, () =>
              deliverServiceAction(action.id, context, ports, runtime, due, adapter),
            ),
          );
          assert.equal(sends, 1);
          assert.equal(
            (await query("SELECT count(*)::int n FROM whatsapp_human_response_evidence"))[0].n,
            0,
          );
          assert.equal(
            (await query("SELECT state FROM whatsapp_service_surveys"))[0].state,
            "sent",
          );
        },
      );

      await t.test(
        "AT49 accepted outbox recovers survey state after a finalization crash without resending",
        async () => {
          await query("UPDATE whatsapp_service_actions SET state='dispatching' WHERE id=$1", [
            action.id,
          ]);
          await query("UPDATE whatsapp_service_surveys SET state='queued',sent_at=NULL");
          const context = await running(action.id);
          await deliverServiceAction(action.id, context, ports, runtime, due, adapter);
          assert.equal(sends, 1);
          assert.equal(
            (await query("SELECT state FROM whatsapp_service_surveys"))[0].state,
            "sent",
          );
        },
      );
      await t.test(
        "AT45/46/47 satisfied answer is bound to prompt, closes survey only and thanks once",
        async () => {
          const answer = await capture("fixture-answer", "active", new Date(due.getTime() + 1000));
          await query(
            "UPDATE whatsapp_messages SET payload=$2::jsonb WHERE id=(SELECT message_id FROM whatsapp_enquiry_events WHERE id=$1)",
            [answer, JSON.stringify({ fixtureAnswer: { token: lastToken, answer: "satisfied" } })],
          );
          const results = await Promise.all(
            Array.from({ length: 3 }, () =>
              processServiceAnswer(answer, ports, runtime, due, adapter),
            ),
          );
          assert.equal(
            results.reduce((n, r) => n + r.answered, 0),
            1,
          );
          assert.equal(
            (
              await query(
                "SELECT count(*)::int n FROM whatsapp_service_actions WHERE purpose='survey_thanks'",
              )
            )[0].n,
            1,
          );
          assert.equal((await query("SELECT status FROM inquiries"))[0].status, "new");
        },
      );

      await t.test(
        "AT47/49 replay after answer preserves closed survey and sent time",
        async () => {
          const [before] = await query(
            "SELECT state,sent_at FROM whatsapp_service_surveys WHERE id=$1",
            [action.survey_id],
          );
          assert.equal(before.state, "closed");
          await deliverServiceAction(
            action.id,
            await running(action.id),
            ports,
            runtime,
            due,
            adapter,
          );
          const [after] = await query(
            "SELECT state,sent_at FROM whatsapp_service_surveys WHERE id=$1",
            [action.survey_id],
          );
          assert.deepEqual(after, before);
          assert.equal(sends, 1);
        },
      );
      await t.test(
        "AT43/44/52 queued thanks is blocked by window, opt-out and disable rechecks",
        async () => {
          const [thanks] = await query(
            "SELECT id FROM whatsapp_service_actions WHERE purpose='survey_thanks'",
          );
          await query(
            "UPDATE whatsapp_conversations SET last_inbound_at=$1::timestamptz-interval '25 hours'",
            [due.toISOString()],
          );
          await prepareServiceAction(thanks.id, ports, runtime, due, adapter);
          assert.equal(
            (
              await query("SELECT block_reason FROM whatsapp_service_actions WHERE id=$1", [
                thanks.id,
              ])
            )[0].block_reason,
            "window_expired_template_unverified",
          );
          await query("UPDATE whatsapp_conversations SET last_inbound_at=$1::timestamptz", [
            due.toISOString(),
          ]);
          await query("UPDATE crm_contacts SET opted_out_whatsapp=true");
          await prepareServiceAction(thanks.id, ports, runtime, due, adapter);
          assert.equal(
            (
              await query("SELECT block_reason FROM whatsapp_service_actions WHERE id=$1", [
                thanks.id,
              ])
            )[0].block_reason,
            "whatsapp_opt_out",
          );
          await query("UPDATE crm_contacts SET opted_out_whatsapp=false");
          await prepareServiceAction(thanks.id, ports, runtime, due, adapter);
          const context = await running(thanks.id);
          await deliverServiceAction(
            thanks.id,
            context,
            ports,
            { ...runtime, enabled: false },
            due,
            adapter,
          );
          assert.equal(sends, 1);
          assert.equal(
            (await query("SELECT state FROM whatsapp_service_actions WHERE id=$1", [thanks.id]))[0]
              .state,
            "suppressed",
          );
        },
      );
      await t.test(
        "AT48 repeated assistance creates one task and protected assignment, acknowledgement waits for confirmation",
        async () => {
          await query(
            "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verification_ref,verified_at,verified_by) VALUES($1,'fixture','manager','folder','node',true,'SYNTHETIC_ONLY',now(),$1)",
            [admin],
          );
          const [i] = await query("SELECT id FROM inquiries");
          const token = "B".repeat(43);
          const survey = randomUUID();
          await query(
            "INSERT INTO whatsapp_service_surveys(id,inquiry_id,instance_version,policy_id,activation_id,state,sent_at,expires_at,token_hash) VALUES($1,$2,2,$3,$4,'sent',$5::timestamptz,$6::timestamptz,$7)",
            [
              survey,
              i.id,
              policy,
              generation,
              now.toISOString(),
              new Date(due.getTime() + 86400000).toISOString(),
              createHash("sha256").update(token).digest("hex"),
            ],
          );
          const answer = await capture("assistance");
          await query(
            "UPDATE whatsapp_messages SET payload=$2::jsonb WHERE id=(SELECT message_id FROM whatsapp_enquiry_events WHERE id=$1)",
            [answer, JSON.stringify({ fixtureAnswer: { token, answer: "assistance" } })],
          );
          const results = await Promise.all(
            Array.from({ length: 5 }, () =>
              processServiceAnswer(answer, ports, runtime, due, adapter),
            ),
          );
          assert.equal(
            results.reduce((n, r) => n + r.answered, 0),
            1,
          );
          assert.equal((await query("SELECT count(*)::int n FROM crm_activities"))[0].n, 1);
          assert.equal(
            (
              await query(
                "SELECT count(*)::int n FROM whatsapp_assignment_requests WHERE reason='service_assistance'",
              )
            )[0].n,
            1,
          );
          const [a] = await query(
            "SELECT * FROM whatsapp_service_actions WHERE purpose='manager_ack'",
          );
          await prepareServiceAction(a.id, ports, runtime, due, adapter);
          assert.equal(
            (
              await query("SELECT block_reason FROM whatsapp_service_actions WHERE id=$1", [a.id])
            )[0].block_reason,
            "manager_assignment_unconfirmed",
          );
        },
      );

      await t.test(
        "AT48 confirmed manager requeues acknowledgement and repeated reconciliation is harmless",
        async () => {
          const [a] = await query(
            "SELECT * FROM whatsapp_assignment_requests WHERE reason='service_assistance'",
          );
          const provider = {
            execute: async () => ({ accepted: true }),
            readAuthoritativeAssignment: async () => ({
              inboxUserId: "manager",
              folderId: "folder",
            }),
          };
          await executeAssignment(a.id, provider, ports);
          assert.equal((await reconcileAssignment(a.id, provider, ports)).confirmed, true);
          assert.equal((await reconcileAssignment(a.id, provider, ports)).confirmed, true);
          assert.equal(
            (
              await query(
                "SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key LIKE 'wa.manager.confirmed:%'",
              )
            )[0].n,
            1,
          );
        },
      );
      await t.test(
        "Policy editor approval and operational health query execute against actual schema",
        async () => {
          const actor = { staffId: admin, roles: ["manager"] };
          const { afterHoursCopy, ...policyRules } = rules;
          const draft = await saveServicePolicyDraft(
            { rules: policyRules, afterHoursCopy, copyVersion: "fixture-v2" },
            actor,
            query,
          );
          assert.equal(draft.status, "draft");
          await approveServicePolicy(
            {
              id: draft.id,
              version: draft.version,
              effectiveAt: "2026-09-11T00:00:00Z",
              decisionEvidenceRef: "SYNTHETIC_ONLY",
            },
            actor,
            ports,
          );
          assert.ok(
            (await listServicePolicies(actor, query)).some(
              (p) => p.id === draft.id && p.status === "approved",
            ),
          );
          const health = await getServiceHealth(actor, query);
          assert.equal(health.schemaAvailable, true);
          assert.equal(health.counts.surveyAnswers, 2);
          await assert.rejects(
            getServiceHealth({ staffId: admin, roles: ["agent"] }, query),
            (e) => e.status === 403,
          );
        },
      );

      await t.test(
        "AT49 expired final-attempt dispatch becomes unknown and is never sent again",
        async () => {
          const [survey] = await query(
            "SELECT id,inquiry_id FROM whatsapp_service_surveys ORDER BY instance_version LIMIT 1",
          );
          const actionId = randomUUID();
          await query(
            "INSERT INTO whatsapp_service_actions(id,inquiry_id,survey_id,purpose,due_at,policy_id,activation_id) VALUES($1,$2,$3,'after_hours_ack',$4::timestamptz,$5,$6)",
            [actionId, survey.inquiry_id, survey.id, due.toISOString(), policy, generation],
          );
          await prepareServiceAction(actionId, ports, runtime, due, adapter);
          const context = await running(actionId);
          await query(
            "UPDATE whatsapp_outbound_intents SET state='dispatching',dispatch_started_at=$2::timestamptz WHERE service_action_id=$1",
            [actionId, due.toISOString()],
          );
          await query("UPDATE whatsapp_service_actions SET state='dispatching' WHERE id=$1", [
            actionId,
          ]);
          await query(
            "UPDATE ops_jobs SET attempt_count=max_attempts,lease_expires_at=now()-interval '1 minute' WHERE id=$1",
            [context.job.jobId],
          );
          await recoverExpiredServiceLeases(query);
          assert.equal(
            (await query("SELECT state FROM whatsapp_service_actions WHERE id=$1", [actionId]))[0]
              .state,
            "unknown",
          );
          assert.equal(
            (await query("SELECT status FROM ops_jobs WHERE id=$1", [context.job.jobId]))[0].status,
            "failed",
          );
          await deliverServiceAction(actionId, context, ports, runtime, due, adapter);
          assert.equal(sends, 1);
        },
      );
      await t.test("AT27/52 disabled service at capture cannot activate later", async () => {
        process.env.EP_WA_SERVICE_AUTOMATION_ENABLED = "false";
        const eid = await capture("service-disabled");
        process.env.EP_WA_SERVICE_AUTOMATION_ENABLED = "true";
        assert.equal(
          (
            await query("SELECT service_eligible FROM whatsapp_enquiry_events WHERE id=$1", [eid])
          )[0].service_eligible,
          false,
        );
        assert.equal((await scheduleServiceForEvent(eid, ports, runtime, now)).scheduled, 0);
        await assert.rejects(
          query("UPDATE whatsapp_enquiry_events SET service_eligible=true WHERE id=$1", [eid]),
          /IMMUTABLE/,
        );
      });
      await t.test(
        "AT50/51 service lane ignores backlog and stale capability worker cannot claim",
        async () => {
          await query("UPDATE ops_jobs SET status='succeeded'");
          await query(
            "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) SELECT 'woztell.history.import',1,'{}','queued',5,now()-interval '1 day','backlog:'||n FROM generate_series(1,1000) n",
          );
          const job = randomUUID();
          await query(
            "INSERT INTO ops_jobs(id,job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) VALUES($1::uuid,'woztell.enquiry.service',1,$2::jsonb,'queued',5,now()-interval '1 second',$1::text)",
            [job, JSON.stringify({ actionId: action.id })],
          );
          assert.equal(
            (await query("UPDATE ops_jobs SET status='running' WHERE id=$1 RETURNING id", [job]))
              .length,
            0,
          );
          const started = Date.now();
          const claims = await Promise.all(
            Array.from({ length: 4 }, (_, n) =>
              claimJobs(
                {
                  workerId: "service-" + n,
                  lane: "service",
                  capabilities: SERVICE_CAPABILITIES,
                  limit: 1,
                },
                query,
              ),
            ),
          );
          assert.equal(claims.flat().length, 1);
          assert.equal(claims.flat()[0].id, job);
          t.diagnostic(
            "Synthetic service claim under 1000 history rows: " + (Date.now() - started) + " ms",
          );
        },
      );
      await t.test(
        "company greeting acknowledges new daytime and overnight enquiries once",
        async (ctx) => {
          const body =
            "你好，我哋係晉誠地產，收到你嘅 WhatsApp 查詢。請問有咩想我哋幫你跟進？另外，我哋負責同事會盡快搵你";
          const app = "fixture-app",
            channel = "fixture";
          const start = new Date(Date.now() - 48 * 3600000);
          const [routing] = await query(
            `INSERT INTO whatsapp_service_policies(version,rules,status,copy_version,approved_by,effective_at)
            VALUES(999,$3::jsonb,'approved','fixture-routing',$1,$2) RETURNING id`,
            [
              admin,
              start,
              JSON.stringify({ ...rules, purpose: "routing_notifications", freshnessSeconds: 300 }),
            ],
          );
          const live = await activateServiceGeneration(routing.id, admin, ports, start);
          const env = {
            ...process.env,
            VERCEL_ENV: "production",
            WOZTELL_ENABLED: "true",
            WOZTELL_APP_ID: app,
            WOZTELL_CHANNEL_ID: channel,
            EP_WA_ACTIVATION_ID: live,
            EP_WA_ENQUIRY_MODE: "active",
            EP_WA_SERVICE_AUTOMATION_ENABLED: "false",
            OPS_WAKE_URL: "",
          };
          const previousEnv = process.env;
          process.env = env;
          ctx.after(() => {
            process.env = previousEnv;
          });
          assert.equal(customerGreetingScope({ ...env, VERCEL_ENV: "preview" }), null);
          await query("INSERT INTO whatsapp_customer_greetings VALUES($1,$2,'85224962283',$3,$4)", [
            app,
            channel,
            body,
            start,
          ]);
          for (const [hour, scenario] of [
            [1, "unknown"],
            [13, "accepted"],
            [2, "optout"],
            [3, "history"],
            [4, "staff"],
          ]) {
            const at = new Date();
            at.setUTCHours((hour + 16) % 24, 0, 0, 0);
            if (at.getTime() > Date.now()) at.setUTCDate(at.getUTCDate() - 1);
            const member = "synthetic-greeting-" + scenario,
              phone = "8529000000" + String(hour % 10);
            const [customer] = await query(
              "INSERT INTO crm_contacts(name,phone,whatsapp_member_id) VALUES('Synthetic',$1,$2) RETURNING id",
              [phone, member],
            );
            const [thread] = await query(
              "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id,last_inbound_at) VALUES($1,$2,$3,$4) RETURNING id",
              [customer.id, channel, member, at],
            );
            if (scenario === "staff")
              await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [admin, phone]);
            async function incoming() {
              const raw = {
                type: "TEXT",
                eventType: "INBOUND",
                messageId: randomUUID(),
                member,
                channel,
                app,
                from: phone,
                timestamp: at.getTime() / 1000,
                data: { text: "synthetic enquiry" },
              };
              const normalized = normalizeWoztellEvent(raw);
              const receipt = await storeInboundReceipt(
                {
                  tenantKey: "woztell:" + app,
                  appId: app,
                  channelId: channel,
                  event: normalized,
                  eventKind: "customer_message",
                  origin: "live_webhook",
                  bodyDigest: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
                  providerOccurredAt: at.toISOString(),
                  receivedAt: at,
                  capture: { mode: "active", activationId: live, effectsEligible: true },
                },
                ports,
              );
              const event = eventForReceiptProjection(
                normalized,
                receipt.receiptId,
                "customer_message",
                receipt.identityKey,
              );
              await query(
                "INSERT INTO whatsapp_messages(conversation_id,contact_id,direction,message_type,text,channel_id,woztell_member_id,external_message_id) VALUES($1,$2,'inbound','TEXT',$3,$4,$5,$6)",
                [thread.id, customer.id, event.text, channel, member, event.externalMessageId],
              );
              const statements = buildLiveEventStatements(event, at, "active");
              await tx(statements);
              const id = statements[0].params[0];
              assert.ok(await observeEpisode(id, query));
              return id;
            }
            const intake = await incoming(),
              followup = await incoming();
            if (scenario === "history")
              await query("UPDATE whatsapp_customer_greetings SET enabled_since=now()");
            await Promise.all([
              queueCustomerGreeting(intake, query),
              queueCustomerGreeting(intake, query),
              queueCustomerGreeting(followup, query),
            ]);
            const actions = await query(
              "SELECT a.* FROM whatsapp_service_actions a JOIN inquiries i ON i.id=a.inquiry_id WHERE i.conversation_id=$1 AND a.purpose='customer_greeting'",
              [thread.id],
            );
            if (scenario === "history")
              await query("UPDATE whatsapp_customer_greetings SET enabled_since=$1", [start]);
            if (scenario === "history" || scenario === "staff") {
              assert.equal(actions.length, 0, scenario);
              continue;
            }
            assert.equal(actions.length, 1, scenario);
            const [action] = actions;
            const job = await running(action.id);
            let calls = 0,
              delivered;
            const send = async (payload) => {
              calls++;
              delivered = payload;
              if (scenario === "unknown") throw Error("simulated provider timeout");
              return { ok: true, body: { messageId: "synthetic-greeting-sent" } };
            };
            if (scenario === "optout")
              await query("UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1", [
                customer.id,
              ]);
            await deliverServiceAction(action.id, job, ports, undefined, new Date(), { send });
            await deliverServiceAction(action.id, job, ports, undefined, new Date(), { send });
            assert.equal(calls, scenario === "optout" ? 0 : 1, scenario);
            if (calls)
              assert.deepEqual(delivered, {
                channelId: channel,
                memberId: member,
                response: [{ type: "TEXT", text: body }],
              });
            const [out] = await query(
              "SELECT state,actor_type FROM whatsapp_outbound_intents WHERE id=$1",
              [action.outbound_intent_id],
            );
            assert.equal(out.actor_type, "service");
            assert.equal(out.state, scenario === "optout" ? "cancelled" : scenario);
          }
        },
      );
    } finally {
      delete process.env.EP_WA_SERVICE_AUTOMATION_ENABLED;
      delete process.env.EP_WA_ACTIVATION_ID;
      delete process.env.EP_WA_COMPANY_CHANNEL_ID;
      try {
        await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await end();
      }
    }
  }, neonRun),
);
