import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { withOwnedPostgres } from "../../../scripts/acceptance/owned-postgres-test.mjs";

// Every owned lead-alert test shares ONE container (86 migrations each is a load
// flake). Subtests isolate their data: each scenario has its own channel, staff,
// endpoints and leads, and global counts are compared as deltas.

const migrationSql = readFileSync(
  new URL("../../../neon/migrations/20261006110000_duty_manager.sql", import.meta.url),
  "utf8",
);
const handlerSource = () =>
  readFileSync(new URL("./lead-alert.server.ts", import.meta.url), "utf8");

const approvedTemplate = JSON.stringify({
  name: "staff_lead_alert",
  language: "zh_HK",
  params: ["name", "source", "link"],
});
// Synthetic references only (mirrors staff-test-notification.db.test.mjs:24-41).
const baseEnv = {
  EP_WA_ENQUIRY_MODE: undefined,
  EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
  EP_WA_STAFF_ALERT_TEMPLATE: approvedTemplate,
  VITE_SITE_URL: "https://earnest.example.invalid",
  EP_WA_COMPANY_CHANNEL_ID: "company",
  WOZTELL_CHANNEL_ID: "company",
  EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: "synthetic",
  EP_WA_STAFF_CORRELATION_VERIFICATION_REF: "synthetic",
  EP_WA_STAFF_ASSOCIATION_REVIEW_REF: "synthetic",
  EP_WA_STAFF_REPLY_CONTEXT_PATH: "context.replyTo",
};
function applyEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function seedStaff(query, { duty = false, roles = ["agent"], active = true } = {}) {
  const staffId = randomUUID();
  await query(
    "INSERT INTO staff_users(id,auth_user_id,name_zh,active,is_duty_manager) VALUES($1,$2,'合成同事',$3,$4)",
    [staffId, `lead-alert-${staffId}`, active, duty],
  );
  for (const role of roles)
    await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [staffId, role]);
  return staffId;
}

async function seedMapping(query, staffId, channel) {
  await query(
    "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verification_ref,verified_at) VALUES($1,$2,$3,'folder','node',true,'synthetic',now())",
    [staffId, channel, `inbox-${staffId}`],
  );
}

async function seedEndpoint(query, staffId, channel, destination, { lastInboundAgo = null } = {}) {
  const [row] = await query(
    `INSERT INTO staff_notification_endpoints(staff_id,transport,channel_id,destination_reference,verification_ref,verified_at,enabled,permission_granted,permission_ref,quiet_hours_policy,last_inbound_at)
     VALUES($1,'staff_whatsapp',$2,$3,'synthetic',now(),true,true,'synthetic','{"approved":true,"allowAllHours":true}',CASE WHEN $4::interval IS NULL THEN NULL ELSE now()-$4::interval END)
     RETURNING id,version`,
    [staffId, channel, destination, lastInboundAgo],
  );
  return row;
}

async function seedLead(query, { assigned = null, name = "陳大文" } = {}) {
  const [contact] = await query(
    "INSERT INTO crm_contacts(name,phone,normalized_phone) VALUES($1,'synthetic',$2) RETURNING id",
    [name, `cust-${randomUUID()}`],
  );
  const [lead] = await query(
    "INSERT INTO crm_leads(contact_id,assigned_agent_id,source) VALUES($1,$2,'website') RETURNING id",
    [contact.id, assigned],
  );
  return lead.id;
}

async function leasedJob(query, leadId, workerId = "worker-1", lease = "5 minutes") {
  const [job] = await query(
    "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,attempt_count,run_after,idempotency_key,lease_owner,lease_expires_at) VALUES('lead.staff.alert',1,jsonb_build_object('leadId',$1::text),'running',3,1,now(),'lead-alert:'||$1,$2,now()+$3::interval) RETURNING id",
    [leadId, workerId, lease],
  );
  return job.id;
}

function fakeProvider({ messageId = () => `op-${randomUUID()}`, refuse = false } = {}) {
  const calls = [];
  const send = async (input) => {
    calls.push(input);
    return refuse
      ? { ok: true, body: { ok: 0, err_code: 131, err: "synthetic refusal" } }
      : { ok: true, body: { ok: 1, messageId: messageId() } };
  };
  return { calls, send };
}

test("lead alert on owned Postgres", { timeout: 600000 }, async (t) => {
  const savedEnv = Object.fromEntries(Object.keys(baseEnv).map((k) => [k, process.env[k]]));
  applyEnv(baseEnv);
  try {
    await withOwnedPostgres(async ({ query, pool, transaction }) => {
      // ---------------------------------------------------------------- Task 1
      // Intent rows hang off a deep enquiry chain irrelevant here; bypass FKs on
      // one dedicated connection that is DISCARDED afterwards (release(true)), so
      // session_replication_role=replica can never leak back into the pool.
      async function seedIntent(staffId) {
        const intentId = randomUUID();
        const client = await pool.connect();
        let discard = true;
        try {
          await client.query("SET session_replication_role = replica");
          await client.query(
            "INSERT INTO staff_notification_intents(id,ready_event_id,cause_event_id,inquiry_id,conversation_id,assignment_version,activation_generation,recipient_staff_id,purpose,acknowledgement_required,logical_dedupe_key) VALUES($1,$2,$3,$4,$5,0,$6,$7,'fyi',false,$8)",
            [
              intentId,
              randomUUID(),
              randomUUID(),
              randomUUID(),
              randomUUID(),
              randomUUID(),
              staffId,
              `k-${intentId}`,
            ],
          );
        } finally {
          try {
            await client.query("SET session_replication_role = DEFAULT");
          } finally {
            client.release(discard);
          }
        }
        return intentId;
      }

      await t.test(
        "duty manager column defaults false and the migration is re-runnable",
        async () => {
          await pool.query(migrationSql);
          await pool.query(migrationSql);
          const staffId = await seedStaff(query, { roles: [] });
          const [row] = await query("SELECT is_duty_manager FROM staff_users WHERE id=$1", [
            staffId,
          ]);
          assert.equal(row.is_duty_manager, false);
          const [constraints] = await query(
            "SELECT count(*)::int n FROM pg_constraint WHERE conname='staff_attempt_one_subject'",
          );
          assert.equal(constraints.n, 1);
        },
      );

      await t.test("an attempt needs exactly one subject", async () => {
        const staffId = await seedStaff(query);
        const endpoint = await seedEndpoint(query, staffId, "owned-channel", "owned-destination");
        const leadId = await seedLead(query);
        const intentId = await seedIntent(staffId);
        const insert = (notificationId, lead, key) =>
          query(
            "INSERT INTO staff_notification_attempts(notification_id,lead_id,transport,endpoint_id,attempt_key) VALUES($1,$2,'staff_whatsapp',$3,$4) RETURNING id,destination_reference_snapshot,channel_id_snapshot",
            [notificationId, lead, endpoint.id, key],
          );
        await assert.rejects(insert(null, null, "none"), /staff_attempt_one_subject/);
        await assert.rejects(insert(intentId, leadId, "both"), /staff_attempt_one_subject/);
        const [ok] = await insert(null, leadId, "lead-only");
        assert.equal(ok.destination_reference_snapshot, "owned-destination");
        assert.equal(ok.channel_id_snapshot, "owned-channel");
        // The replica session never leaked: FKs are enforced on pooled connections.
        await assert.rejects(
          query(
            "INSERT INTO staff_notification_attempts(lead_id,transport,attempt_key) VALUES($1,'staff_whatsapp','fk-probe')",
            [randomUUID()],
          ),
          /foreign key/,
        );
      });

      await t.test("existing enquiry attempts are unaffected", async () => {
        const staffId = await seedStaff(query);
        const endpoint = await seedEndpoint(query, staffId, "owned-channel-2", "owned-dest-2");
        const intentId = await seedIntent(staffId);
        const [ok] = await query(
          "INSERT INTO staff_notification_attempts(notification_id,transport,endpoint_id,attempt_key) VALUES($1,'staff_whatsapp',$2,'enq') RETURNING lead_id",
          [intentId, endpoint.id],
        );
        assert.equal(ok.lead_id, null);
      });

      // ---------------------------------------------------------------- Task 3
      const { handleLeadStaffAlert, reconcileLeadStaffAlert, LEAD_ALERT_JOB } =
        await import("./lead-alert.server.ts");
      const { createStaffWhatsAppTransport } =
        await import("../woztell/staff-whatsapp-transport.server.ts");
      const { getStaffNotificationHealth } = await import("./staff-notifications.server.ts");
      const { isolateSignedStaffEvent } = await import("./staff-event-isolation.server.ts");
      assert.equal(LEAD_ALERT_JOB, "lead.staff.alert");

      const managerId = await seedStaff(query, { roles: ["manager"] });
      const health = async () =>
        (await getStaffNotificationHealth({ staffId: managerId, roles: ["manager"] }, query))
          .counts;

      const leadIdSnapshot = async () =>
        new Map(
          (
            await query(
              "SELECT id,lead_id FROM staff_notification_attempts WHERE lead_id IS NOT NULL",
            )
          ).map((r) => [r.id, r.lead_id]),
        );
      // Every handler run is bracketed by a lead_id snapshot: the handler may add
      // rows but must never rewrite an existing row's subject.
      async function assertLeadIdsKept(before, label) {
        const after = await leadIdSnapshot();
        for (const [id, leadId] of before) assert.equal(after.get(id), leadId, label);
      }

      let scenarioCount = 0;
      function scenario() {
        const channel = `channel-${++scenarioCount}`;
        process.env.EP_WA_COMPANY_CHANNEL_ID = channel;
        process.env.WOZTELL_CHANNEL_ID = channel;
        return channel;
      }
      async function run(leadId, jobId, provider, { workerId = "worker-1", ...deps } = {}) {
        const before = await leadIdSnapshot();
        try {
          return await handleLeadStaffAlert(
            { leadId },
            { jobId, workerId, checkpoint: async () => {} },
            {
              query,
              transaction,
              transport: () => createStaffWhatsAppTransport(provider.send),
              ...deps,
            },
          );
        } finally {
          await assertLeadIdsKept(before, `run ${leadId}`);
        }
      }
      const attempts = (leadId) =>
        query(
          "SELECT id,lead_id,endpoint_id,endpoint_version,destination_reference_snapshot,channel_id_snapshot,dispatch_state,safe_error,provider_operation_id,claim_id,job_id FROM staff_notification_attempts WHERE lead_id=$1 ORDER BY destination_reference_snapshot NULLS FIRST",
          [leadId],
        );
      async function staffWithEndpoint(channel, options = {}) {
        const staffId = await seedStaff(query, options);
        await seedMapping(query, staffId, channel);
        const destination = options.destination ?? `staff-dev-${randomUUID().slice(0, 8)}`;
        const endpoint = await seedEndpoint(query, staffId, channel, destination, options);
        return { staffId, destination, endpoint };
      }

      await t.test("unassigned lead → duty manager destination", async () => {
        const channel = scenario();
        const dutyA = await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        const dutyB = await staffWithEndpoint(channel, { duty: true, roles: ["agent"] });
        const dutyNoEndpoint = await seedStaff(query, { duty: true, roles: ["manager"] });
        await seedMapping(query, dutyNoEndpoint, channel);
        await staffWithEndpoint(channel, { duty: false, roles: ["manager"] });
        const leadId = await seedLead(query);
        const jobId = await leasedJob(query, leadId);
        const provider = fakeProvider();
        const result = await run(leadId, jobId, provider);
        assert.deepEqual(result, { summary: { accepted: 2, unknown: 0, blocked: 0 } });
        assert.deepEqual(
          provider.calls.map((c) => c.memberId).sort(),
          [dutyA.destination, dutyB.destination].sort(),
        );
        const rows = await attempts(leadId);
        assert.equal(rows.length, 2);
        for (const row of rows) {
          const owner = row.destination_reference_snapshot === dutyA.destination ? dutyA : dutyB;
          assert.equal(row.lead_id, leadId);
          assert.equal(row.endpoint_id, owner.endpoint.id);
          assert.equal(row.endpoint_version, owner.endpoint.version);
          assert.equal(row.channel_id_snapshot, channel);
          assert.equal(row.dispatch_state, "accepted");
          assert.equal(row.job_id, jobId);
          assert.ok(row.provider_operation_id);
        }
        // Each claim queued its own lease-expiry reconcile in the general lane.
        const reconcileJobs = await query(
          "SELECT job_type,payload,run_after>now() AS later FROM ops_jobs WHERE idempotency_key = ANY($1::text[])",
          [rows.map((r) => `lead-alert.reconcile:${r.id}`)],
        );
        assert.equal(reconcileJobs.length, 2);
        for (const job of reconcileJobs) {
          assert.equal(job.job_type, "lead.staff.alert.reconcile");
          assert.deepEqual(job.payload, { leadId });
          assert.equal(job.later, true);
        }
      });

      await t.test("assigned agent with a verified mapping is the only destination", async () => {
        const channel = scenario();
        await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        const agent = await staffWithEndpoint(channel, { roles: ["agent"] });
        const leadId = await seedLead(query, { assigned: agent.staffId });
        const provider = fakeProvider();
        await run(leadId, await leasedJob(query, leadId), provider);
        assert.deepEqual(
          provider.calls.map((c) => c.memberId),
          [agent.destination],
        );
        assert.equal((await attempts(leadId)).length, 1);
      });

      await t.test("assigned agent without a mapping falls back to duty managers", async () => {
        const channel = scenario();
        const duty = await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        // An endpoint but no staff-channel mapping: not eligible.
        const agent = await seedStaff(query, { roles: ["agent"] });
        await seedEndpoint(query, agent, channel, `staff-dev-${randomUUID().slice(0, 8)}`);
        const leadId = await seedLead(query, { assigned: agent });
        const provider = fakeProvider();
        await run(leadId, await leasedJob(query, leadId), provider);
        assert.deepEqual(
          provider.calls.map((c) => c.memberId),
          [duty.destination],
        );
      });

      await t.test("no duty manager → visible outcome", async () => {
        scenario();
        const before = (await health()).lead_alerts_blocked;
        const leadId = await seedLead(query);
        const provider = fakeProvider();
        const result = await run(leadId, await leasedJob(query, leadId), provider);
        assert.deepEqual(result, { summary: { accepted: 0, unknown: 0, blocked: 1 } });
        assert.equal(provider.calls.length, 0);
        const rows = await attempts(leadId);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].dispatch_state, "suppressed");
        assert.equal(rows[0].safe_error, "no_destination");
        assert.equal(rows[0].endpoint_id, null);
        assert.equal((await health()).lead_alerts_blocked, before + 1);
      });

      await t.test("destination equal to a customer member id is refused", async (st) => {
        await st.test("(a) at plan time, against a WhatsApp conversation", async () => {
          const channel = scenario();
          const duty = await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
          await query(
            "INSERT INTO whatsapp_conversations(channel_id,woztell_member_id) VALUES($1,$2)",
            [channel, duty.destination],
          );
          const leadId = await seedLead(query);
          const provider = fakeProvider();
          await run(leadId, await leasedJob(query, leadId), provider);
          assert.equal(provider.calls.length, 0);
          assert.deepEqual(
            (await attempts(leadId)).map((r) => [r.dispatch_state, r.safe_error]),
            [["suppressed", "destination_is_customer"]],
          );
        });
        await st.test("(a') at plan time, against a CRM contact phone", async () => {
          const channel = scenario();
          const duty = await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
          await query("INSERT INTO crm_contacts(name,normalized_phone) VALUES('合成客戶',$1)", [
            duty.destination,
          ]);
          const leadId = await seedLead(query);
          const provider = fakeProvider();
          await run(leadId, await leasedJob(query, leadId), provider);
          assert.equal(provider.calls.length, 0);
          assert.equal((await attempts(leadId))[0].safe_error, "destination_is_customer");
        });
        await st.test("(b) at send time, inside beforeSend", async () => {
          const channel = scenario();
          const duty = await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
          const leadId = await seedLead(query);
          const provider = fakeProvider();
          const transport = () => {
            const real = createStaffWhatsAppTransport(provider.send);
            return {
              ...real,
              async sendStaffWhatsApp(scope) {
                // The destination becomes a customer between the claim and the send.
                await query(
                  "INSERT INTO whatsapp_conversations(channel_id,woztell_member_id) VALUES($1,$2)",
                  [channel, duty.destination],
                );
                return real.sendStaffWhatsApp(scope);
              },
            };
          };
          const result = await run(leadId, await leasedJob(query, leadId), provider, {
            transport,
          });
          assert.equal(provider.calls.length, 0);
          assert.deepEqual(result, { summary: { accepted: 0, unknown: 0, blocked: 1 } });
          const [row] = await attempts(leadId);
          assert.equal(row.dispatch_state, "suppressed");
        });
      });

      await t.test("the D-11 guard also runs inside the claim", async () => {
        const channel = scenario();
        const duty = await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        const leadId = await seedLead(query);
        // First run plans but cannot claim (expired lease): the row stays queued.
        const jobId = await leasedJob(query, leadId, "worker-1", "-1 second");
        const provider = fakeProvider();
        await run(leadId, jobId, provider);
        assert.deepEqual(
          (await attempts(leadId)).map((r) => r.dispatch_state),
          ["queued"],
        );
        // The destination becomes a customer contact before the retry claims it.
        await query("INSERT INTO crm_contacts(name,whatsapp_member_id) VALUES('合成客戶',$1)", [
          duty.destination,
        ]);
        await query("UPDATE ops_jobs SET lease_expires_at=now()+interval '5 minutes' WHERE id=$1", [
          jobId,
        ]);
        await run(leadId, jobId, provider);
        assert.equal(provider.calls.length, 0);
        const [row] = await attempts(leadId);
        assert.deepEqual(
          [row.dispatch_state, row.safe_error, row.claim_id],
          ["suppressed", "dispatch_eligibility_changed", null],
        );
        assert.equal(
          (
            await query("SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key=$1", [
              `lead-alert.reconcile:${row.id}`,
            ])
          )[0].n,
          0,
        );
      });

      const expectedTemplate = (leadId, name = "陳大文") => ({
        type: "TEMPLATE",
        elementName: "staff_lead_alert",
        languageCode: "zh_HK",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: name },
              { type: "text", text: "網站查詢" },
              {
                type: "text",
                text: `https://earnest.example.invalid/admin/leads?lead=${leadId}`,
              },
            ],
          },
        ],
      });

      await t.test("outside 24h → template payload", async () => {
        const channel = scenario();
        await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        // Customer-typed text is reduced to one line before it reaches the template.
        const leadId = await seedLead(query, { name: "陳大文\n\t" });
        const provider = fakeProvider();
        await run(leadId, await leasedJob(query, leadId), provider);
        assert.equal(provider.calls.length, 1);
        assert.deepEqual(provider.calls[0].response, [expectedTemplate(leadId)]);
        const serialized = JSON.stringify(provider.calls[0]);
        assert.doesNotMatch(serialized, /"TEXT"/);
        assert.doesNotMatch(serialized, /cust-/);
      });

      await t.test("inside 24h still sends the template, never text", async () => {
        const channel = scenario();
        await staffWithEndpoint(channel, {
          duty: true,
          roles: ["manager"],
          lastInboundAgo: "1 hour",
        });
        const leadId = await seedLead(query);
        const provider = fakeProvider();
        await run(leadId, await leasedJob(query, leadId), provider);
        assert.equal(provider.calls.length, 1);
        assert.deepEqual(provider.calls[0].response, [expectedTemplate(leadId)]);
      });

      for (const [name, env, reason] of [
        [
          "template not configured → visible state, no send",
          { EP_WA_STAFF_ALERT_TEMPLATE: undefined },
          "template_not_configured",
        ],
        [
          "switch off → notifications_disabled, no send",
          { EP_WA_STAFF_NOTIFICATIONS_ENABLED: "false" },
          "notifications_disabled",
        ],
      ]) {
        await t.test(name, async () => {
          const channel = scenario();
          await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
          const leadId = await seedLead(query);
          const jobId = await leasedJob(query, leadId);
          const provider = fakeProvider();
          applyEnv(env);
          try {
            const result = await run(leadId, jobId, provider);
            assert.deepEqual(result, { summary: { accepted: 0, unknown: 0, blocked: 1 } });
            await run(leadId, jobId, provider);
          } finally {
            applyEnv({
              EP_WA_STAFF_ALERT_TEMPLATE: approvedTemplate,
              EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
            });
          }
          assert.equal(provider.calls.length, 0);
          const rows = await attempts(leadId);
          assert.deepEqual(
            rows.map((r) => [r.dispatch_state, r.safe_error, r.endpoint_id]),
            [["suppressed", reason, null]],
          );
        });
      }

      await t.test("retry after lease expiry does not send twice", async () => {
        const channel = scenario();
        await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });

        // A worker whose lease already expired can never claim.
        const staleLead = await seedLead(query);
        const staleJob = await leasedJob(query, staleLead, "worker-1", "-1 second");
        const staleProvider = fakeProvider();
        await run(staleLead, staleJob, staleProvider);
        assert.equal(staleProvider.calls.length, 0);
        assert.deepEqual(
          (await attempts(staleLead)).map((r) => r.dispatch_state),
          ["queued"],
        );
        // Nor can a worker that does not own the live lease.
        await query("UPDATE ops_jobs SET lease_expires_at=now()+interval '5 minutes' WHERE id=$1", [
          staleJob,
        ]);
        await run(staleLead, staleJob, staleProvider, { workerId: "intruder" });
        assert.equal(staleProvider.calls.length, 0);
        assert.deepEqual(
          (await attempts(staleLead)).map((r) => r.dispatch_state),
          ["queued"],
        );

        const leadId = await seedLead(query);
        const jobId = await leasedJob(query, leadId);
        const provider = fakeProvider();
        // The worker dies after the provider call, before the outcome is written.
        const crashing = async (statement, params) => {
          if (statement.includes("provider_acceptance_source"))
            throw new Error("synthetic worker crash");
          return query(statement, params);
        };
        await assert.rejects(run(leadId, jobId, provider, { query: crashing }), /crash/);
        assert.equal(provider.calls.length, 1);
        assert.deepEqual(
          (await attempts(leadId)).map((r) => r.dispatch_state),
          ["dispatching"],
        );
        // Lease expires; the runner requeues and another worker leases the same job.
        await query(
          "UPDATE ops_jobs SET status='queued',lease_owner=NULL,lease_expires_at=NULL WHERE id=$1",
          [jobId],
        );
        await query(
          "UPDATE ops_jobs SET status='running',lease_owner='worker-2',lease_expires_at=now()+interval '5 minutes',attempt_count=attempt_count+1 WHERE id=$1",
          [jobId],
        );
        const second = await run(leadId, jobId, provider, { workerId: "worker-2" });
        assert.deepEqual(second, { summary: { accepted: 0, unknown: 1, blocked: 0 } });
        assert.equal(provider.calls.length, 1);
        assert.deepEqual(
          (await attempts(leadId)).map((r) => [r.dispatch_state, r.safe_error]),
          [["unknown", "lease_expired_after_dispatch"]],
        );
        await run(leadId, jobId, provider, { workerId: "worker-2" });
        assert.equal(provider.calls.length, 1);
        // A later receipt proves acceptance; a third run still sends nothing.
        await query(
          "UPDATE staff_notification_attempts SET dispatch_state='accepted' WHERE lead_id=$1",
          [leadId],
        );
        await run(leadId, jobId, provider, { workerId: "worker-2" });
        assert.equal(provider.calls.length, 1);
      });

      await t.test("a provider timeout after beforeSend is unknown and never resent", async () => {
        const channel = scenario();
        await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        const leadId = await seedLead(query);
        const jobId = await leasedJob(query, leadId);
        const calls = [];
        const provider = {
          calls,
          send: async (input) => {
            calls.push(input);
            throw new Error("synthetic provider timeout");
          },
        };
        // The job still succeeds: no retry storm after a possibly-sent request.
        const result = await run(leadId, jobId, provider);
        assert.deepEqual(result, { summary: { accepted: 0, unknown: 1, blocked: 0 } });
        assert.deepEqual(
          (await attempts(leadId)).map((r) => [r.dispatch_state, r.safe_error]),
          [["unknown", "provider_outcome_unknown"]],
        );
        await run(leadId, jobId, provider);
        assert.equal(calls.length, 1);
      });

      await t.test("concurrent runs claim each destination once", async () => {
        const channel = scenario();
        await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        await staffWithEndpoint(channel, { duty: true, roles: ["agent"] });
        const leadId = await seedLead(query);
        const jobId = await leasedJob(query, leadId);
        const provider = fakeProvider();
        await Promise.all(Array.from({ length: 4 }, () => run(leadId, jobId, provider)));
        assert.equal(provider.calls.length, 2);
        assert.equal(new Set(provider.calls.map((c) => c.memberId)).size, 2);
        assert.equal((await attempts(leadId)).length, 2);
      });

      await t.test("the reconcile job turns an orphaned dispatch into unknown", async () => {
        const channel = scenario();
        await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        const leadId = await seedLead(query);
        const jobId = await leasedJob(query, leadId);
        const provider = fakeProvider();
        const crashing = async (statement, params) => {
          if (statement.includes("provider_acceptance_source")) throw new Error("crash");
          return query(statement, params);
        };
        await assert.rejects(run(leadId, jobId, provider, { query: crashing }));
        // While the dispatching job still holds a live lease, nothing changes.
        assert.deepEqual(await reconcileLeadStaffAlert(leadId, query), { unknown: 0 });
        await query("UPDATE ops_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [
          jobId,
        ]);
        assert.deepEqual(await reconcileLeadStaffAlert(leadId, query), { unknown: 1 });
        assert.equal((await attempts(leadId))[0].dispatch_state, "unknown");
        assert.equal(provider.calls.length, 1);
      });

      await t.test("provider refusal is recorded as failed and not retried", async () => {
        const channel = scenario();
        await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        const leadId = await seedLead(query);
        const jobId = await leasedJob(query, leadId);
        const provider = fakeProvider({ refuse: true });
        const result = await run(leadId, jobId, provider);
        assert.deepEqual(result, { summary: { accepted: 0, unknown: 0, blocked: 1 } });
        assert.equal(provider.calls.length, 1);
        assert.deepEqual(
          (await attempts(leadId)).map((r) => [r.dispatch_state, r.safe_error]),
          [["failed", "provider_refused"]],
        );
        await run(leadId, jobId, provider);
        assert.equal(provider.calls.length, 1);
      });

      await t.test(
        "destinations are frozen at first run and deduplicated by member id",
        async () => {
          const channel = scenario();
          const shared = `staff-dev-${randomUUID().slice(0, 8)}`;
          await staffWithEndpoint(channel, { duty: true, roles: ["manager"], destination: shared });
          await staffWithEndpoint(channel, { duty: true, roles: ["agent"], destination: shared });
          const leadId = await seedLead(query);
          const jobId = await leasedJob(query, leadId);
          const provider = fakeProvider();
          await run(leadId, jobId, provider);
          assert.equal(provider.calls.length, 1);
          assert.equal((await attempts(leadId)).length, 1);
          // A duty manager toggled on before the retry is not added to this lead.
          await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
          await run(leadId, jobId, provider);
          assert.equal(provider.calls.length, 1);
          assert.equal((await attempts(leadId)).length, 1);

          // The assigned agent who is also a duty manager is contacted once.
          const both = await staffWithEndpoint(channel, { duty: true, roles: ["agent"] });
          const assignedLead = await seedLead(query, { assigned: both.staffId });
          const second = fakeProvider();
          await run(assignedLead, await leasedJob(query, assignedLead), second);
          assert.deepEqual(
            second.calls.map((c) => c.memberId),
            [both.destination],
          );
        },
      );

      await t.test(
        "staff reply to a lead alert is isolated and opens that endpoint's window",
        async () => {
          const channel = scenario();
          const duty = await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
          const leadId = await seedLead(query);
          const provider = fakeProvider({ messageId: () => "op-1" });
          await run(leadId, await leasedJob(query, leadId), provider);
          const [attempt] = await attempts(leadId);
          assert.equal(attempt.dispatch_state, "accepted");
          assert.equal(attempt.provider_operation_id, "op-1");
          const contactsBefore = (await query("SELECT count(*)::int n FROM crm_contacts"))[0].n;
          const reply = {
            appId: "synthetic",
            channelId: channel,
            woztellMemberId: duty.destination,
            legacyExternalMessageId: null,
            externalMessageId: "staff-reply-1",
            messageType: "TEXT",
            payload: {
              type: "TEXT",
              timestamp: Math.floor(Date.now() / 1000) - 5,
              context: { replyTo: "op-1" },
            },
            text: "收到",
          };
          assert.equal(await isolateSignedStaffEvent(reply, transaction), true);
          const events = await query(
            "SELECT association_state,notification_attempt_id FROM staff_notification_internal_events WHERE member_id=$1",
            [duty.destination],
          );
          assert.deepEqual(events, [
            { association_state: "correlated", notification_attempt_id: attempt.id },
          ]);
          const [endpoint] = await query(
            "SELECT last_inbound_at FROM staff_notification_endpoints WHERE id=$1",
            [duty.endpoint.id],
          );
          assert.ok(endpoint.last_inbound_at);
          assert.equal(
            (await query("SELECT count(*)::int n FROM crm_contacts"))[0].n,
            contactsBefore,
          );
        },
      );

      await t.test("attempt lead_id is never rewritten by the handler", async () => {
        // Phase snapshots: plan, claim/send/finish, reconcile and a rerun each keep
        // every row's subject (the immutability trigger does not cover lead_id).
        const channel = scenario();
        await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        await staffWithEndpoint(channel, { duty: true, roles: ["agent"] });
        const leadId = await seedLead(query);
        const jobId = await leasedJob(query, leadId);
        const provider = fakeProvider();
        const phases = [];
        const tracking = async (statement, params) => {
          const before = await leadIdSnapshot();
          const rows = await query(statement, params);
          await assertLeadIdsKept(before, statement.slice(0, 60));
          phases.push(statement.slice(0, 20));
          return rows;
        };
        const trackingTx = async (statements) => {
          const before = await leadIdSnapshot();
          const rows = await transaction(statements);
          await assertLeadIdsKept(before, "transaction");
          phases.push("tx");
          return rows;
        };
        await run(leadId, jobId, provider, { query: tracking, transaction: trackingTx });
        await reconcileLeadStaffAlert(leadId, tracking);
        await run(leadId, jobId, provider, { query: tracking, transaction: trackingTx });
        assert.ok(phases.length > 5);
        assert.equal(provider.calls.length, 2);
        for (const row of await attempts(leadId)) assert.equal(row.lead_id, leadId);
        // No statement in the handler assigns lead_id.
        assert.doesNotMatch(
          handlerSource(),
          /\bSET\s+(?:(?!\bWHERE\b|\bFROM\b)[^;`])*\blead_id\s*=/i,
        );
      });
    });
  } finally {
    applyEnv(savedEnv);
  }
});
