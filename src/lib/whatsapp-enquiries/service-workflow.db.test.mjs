import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import {
  activateServiceGeneration,
  scheduleServiceForEvent,
  prepareServiceAction,
  deliverServiceAction,
  processServiceAnswer,
} from "./service-workflow.server.ts";
import { buildLiveEventStatements } from "./workflow.server.ts";
import { normalizeWoztellEvent } from "../woztell/woztell.server.ts";
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
function splitSqlStatements(query) {
  const statements = [];
  let current = "",
    single = false,
    double = false,
    dollar = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index],
      next = query[index + 1];
    if (!single && !double && !dollar && char === "-" && next === "-") {
      const end = query.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end;
      continue;
    }
    if (!double && !dollar && char === "'" && query[index - 1] !== "\\") single = !single;
    if (!single && !dollar && char === '"') double = !double;
    if (!single && !double && char === "$") {
      const match = query.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        dollar = dollar ? (dollar === tag ? null : dollar) : tag;
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (!single && !double && !dollar && char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const url = process.env.ASTRA_TEST_DATABASE_URL;
test("Phase4 isolated service transactions and capability lane", { skip: !url }, async (t) => {
  assert.equal(process.env.ASTRA_TEST_BRANCH_ID, "br-quiet-hat-aoxbj2ue");
  const db = neon(url),
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
      "INSERT INTO whatsapp_messages(id,conversation_id,contact_id,direction,text,channel_id,woztell_member_id,external_message_id) VALUES($1,$2,$3,'inbound','synthetic','fixture','synthetic',$4)",
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
    for (const statement of [
      `CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb)`,
      `CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean DEFAULT true,name_zh text,name_en text)`,
      `CREATE TABLE staff_roles(staff_user_id uuid,role text)`,
      `CREATE TABLE properties(id uuid PRIMARY KEY,agent_id uuid,deal_type text)`,
      `CREATE TABLE crm_contacts(id uuid PRIMARY KEY,name text,opted_out_whatsapp boolean DEFAULT false,whatsapp_member_id text)`,
      `CREATE TABLE crm_leads(id uuid PRIMARY KEY)`,
      `CREATE TABLE crm_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,contact_id uuid,staff_user_id uuid,activity_type text,body text,due_at timestamptz)`,
      `CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,contact_id uuid,assigned_agent_id uuid,channel_id text,woztell_member_id text,last_inbound_at timestamptz,last_message_at timestamptz,updated_at timestamptz DEFAULT now())`,
      `CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,conversation_id uuid,contact_id uuid,direction text,message_type text,text text,channel_id text,woztell_member_id text,external_message_id text UNIQUE,sent_by uuid,status text,payload jsonb,error text)`,
      `CREATE TABLE inquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text DEFAULT 'website',name text NOT NULL,crm_contact_id uuid,property_id uuid,status text DEFAULT 'new',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`,
      `CREATE TABLE ops_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_type text,payload_version integer,payload jsonb,status text,attempt_count integer DEFAULT 0,max_attempts integer,run_after timestamptz,lease_owner text,lease_expires_at timestamptz,last_error_code text,last_error_summary text,idempotency_key text UNIQUE,actor_staff_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`,
    ])
      await query(statement);
    for (const file of [
      "20260905130000_outbound_intents.sql",
      "20260912120000_whatsapp_enquiry_events.sql",
      "20260912130000_whatsapp_enquiry_episodes.sql",
      "20260912140000_whatsapp_assignment_evidence.sql",
      "20260912150000_whatsapp_service_workflow.sql",
    ]) {
      let sql = readFileSync("neon/migrations/" + file, "utf8");
      if (file.includes("outbound_intents"))
        sql = sql.slice(0, sql.indexOf("-- Existing duplicates"));
      await tx(splitSqlStatements(sql).map((statement) => ({ statement })));
    }
    await tx(
      splitSqlStatements(
        readFileSync("neon/migrations/20260912150000_whatsapp_service_workflow.sql", "utf8"),
      ).map((statement) => ({ statement })),
    );
    await query("INSERT INTO staff_users(id) VALUES($1)", [admin]);
    await query("INSERT INTO staff_roles VALUES($1,'manager')", [admin]);
    await query("INSERT INTO crm_contacts(id) VALUES($1)", [contact]);
    await query(
      "INSERT INTO whatsapp_conversations(id,contact_id,channel_id,woztell_member_id,last_inbound_at) VALUES($1,$2,'fixture','synthetic',$3::timestamptz)",
      [conv, contact, now.toISOString()],
    );
    await query("INSERT INTO whatsapp_service_policies(id,version,rules) VALUES($1,1,$2::jsonb)", [
      policy,
      JSON.stringify(rules),
    ]);
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
        assert.equal((await query("SELECT count(*)::int n FROM whatsapp_service_surveys"))[0].n, 1);
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
        assert.equal((await query("SELECT state FROM whatsapp_service_surveys"))[0].state, "sent");
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
        assert.equal((await query("SELECT state FROM whatsapp_service_surveys"))[0].state, "sent");
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

    await t.test("AT47/49 replay after answer preserves closed survey and sent time", async () => {
      const [before] = await query(
        "SELECT state,sent_at FROM whatsapp_service_surveys WHERE id=$1",
        [action.survey_id],
      );
      assert.equal(before.state, "closed");
      await deliverServiceAction(action.id, await running(action.id), ports, runtime, due, adapter);
      const [after] = await query(
        "SELECT state,sent_at FROM whatsapp_service_surveys WHERE id=$1",
        [action.survey_id],
      );
      assert.deepEqual(after, before);
      assert.equal(sends, 1);
    });
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
          (await query("SELECT block_reason FROM whatsapp_service_actions WHERE id=$1", [a.id]))[0]
            .block_reason,
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
          readAuthoritativeAssignment: async () => ({ inboxUserId: "manager", folderId: "folder" }),
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
        (await query("SELECT service_eligible FROM whatsapp_enquiry_events WHERE id=$1", [eid]))[0]
          .service_eligible,
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
  } finally {
    delete process.env.EP_WA_SERVICE_AUTOMATION_ENABLED;
    delete process.env.EP_WA_ACTIVATION_ID;
    delete process.env.EP_WA_COMPANY_CHANNEL_ID;
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
