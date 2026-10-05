import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
  repoRoot,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

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
          // Destroy the connection rather than return a replica session to the pool.
          client.release(true);
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

      await t.test(
        "assigned destination refused as a customer keeps the refusal and alerts duty managers",
        async () => {
          const channel = scenario();
          const dutyA = await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
          const dutyB = await staffWithEndpoint(channel, { duty: true, roles: ["agent"] });
          const agent = await staffWithEndpoint(channel, { roles: ["agent"] });
          await query(
            "INSERT INTO whatsapp_conversations(channel_id,woztell_member_id) VALUES($1,$2)",
            [channel, agent.destination],
          );
          const before = (await health()).lead_alerts_blocked;
          const leadId = await seedLead(query, { assigned: agent.staffId });
          const provider = fakeProvider();
          const result = await run(leadId, await leasedJob(query, leadId), provider);
          assert.deepEqual(result, { summary: { accepted: 2, unknown: 0, blocked: 1 } });
          assert.deepEqual(
            provider.calls.map((c) => c.memberId).sort(),
            [dutyA.destination, dutyB.destination].sort(),
          );
          const rows = await attempts(leadId);
          assert.deepEqual(
            rows
              .map((r) => [r.destination_reference_snapshot, r.dispatch_state, r.safe_error])
              .sort(),
            [
              [agent.destination, "suppressed", "destination_is_customer"],
              [dutyA.destination, "accepted", null],
              [dutyB.destination, "accepted", null],
            ].sort(),
          );
          assert.equal((await health()).lead_alerts_blocked, before + 1);
        },
      );

      await t.test(
        "assigned destination ineligible keeps a visible row and alerts duty managers",
        async () => {
          const channel = scenario();
          const duty = await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
          const agent = await staffWithEndpoint(channel, { roles: ["agent"] });
          await query("UPDATE staff_notification_endpoints SET enabled=false WHERE id=$1", [
            agent.endpoint.id,
          ]);
          const before = (await health()).lead_alerts_blocked;
          const leadId = await seedLead(query, { assigned: agent.staffId });
          const provider = fakeProvider();
          const jobId = await leasedJob(query, leadId);
          await run(leadId, jobId, provider);
          assert.deepEqual(
            provider.calls.map((c) => c.memberId),
            [duty.destination],
          );
          const rows = await attempts(leadId);
          const refused = rows.filter((r) => r.dispatch_state === "suppressed");
          assert.deepEqual(
            refused.map((r) => [r.endpoint_id, r.safe_error]),
            [[agent.endpoint.id, "assigned_destination_unavailable"]],
          );
          assert.equal(rows.length, 2);
          assert.equal((await health()).lead_alerts_blocked, before + 1);
          // Frozen: a rerun adds nothing and sends nothing.
          await run(leadId, jobId, provider);
          assert.equal((await attempts(leadId)).length, 2);
          assert.equal(provider.calls.length, 1);
        },
      );

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
        for (const customerPhone of ["85291234567", "91234567"]) {
          await st.test(
            `(a'') typed "+852 9123 4567" matches customer phone ${customerPhone} by digits`,
            async () => {
              const channel = scenario();
              await query("DELETE FROM crm_contacts WHERE normalized_phone IN ($1,$2)", [
                "85291234567",
                "91234567",
              ]);
              await staffWithEndpoint(channel, {
                duty: true,
                roles: ["manager"],
                destination: "+852 9123 4567",
              });
              await query("INSERT INTO crm_contacts(name,normalized_phone) VALUES('合成客戶',$1)", [
                customerPhone,
              ]);
              const leadId = await seedLead(query);
              const provider = fakeProvider();
              await run(leadId, await leasedJob(query, leadId), provider);
              assert.equal(provider.calls.length, 0);
              assert.deepEqual(
                (await attempts(leadId)).map((r) => [r.dispatch_state, r.safe_error]),
                [["suppressed", "destination_is_customer"]],
              );
            },
          );
        }
        await st.test(
          "(a''') a digits-only match also stops the claim and beforeSend",
          async () => {
            for (const phase of ["claim", "beforeSend"]) {
              const channel = scenario();
              const duty = await staffWithEndpoint(channel, {
                duty: true,
                roles: ["manager"],
                destination: `+852 6${String(scenarioCount).padStart(3, "0")} 4321`,
              });
              const digits = duty.destination.replace(/\D/g, "");
              const leadId = await seedLead(query);
              const provider = fakeProvider();
              const addCustomer = () =>
                query("INSERT INTO crm_contacts(name,normalized_phone) VALUES('合成客戶',$1)", [
                  digits.slice(-8),
                ]);
              if (phase === "claim") {
                // Plan with an expired lease (row stays queued), then the customer appears.
                const jobId = await leasedJob(query, leadId, "worker-1", "-1 second");
                await run(leadId, jobId, provider);
                await addCustomer();
                await query(
                  "UPDATE ops_jobs SET lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
                  [jobId],
                );
                await run(leadId, jobId, provider);
              } else {
                const transport = () => {
                  const real = createStaffWhatsAppTransport(provider.send);
                  return {
                    ...real,
                    async sendStaffWhatsApp(scope) {
                      await addCustomer();
                      return real.sendStaffWhatsApp(scope);
                    },
                  };
                };
                await run(leadId, await leasedJob(query, leadId), provider, { transport });
              }
              assert.equal(provider.calls.length, 0, phase);
              assert.deepEqual(
                (await attempts(leadId)).map((r) => r.dispatch_state),
                ["suppressed"],
                phase,
              );
            }
          },
        );
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
        // Deterministic contention: each run's FIRST claim transaction waits at a
        // barrier until all four runs have planned and listed the same queued rows,
        // so all four race for the same row at once (no timing dependence).
        const runs = 4;
        let arrived = 0;
        let release;
        const barrier = new Promise((resolve) => (release = resolve));
        const racing = () => {
          let first = true;
          return async (statements) => {
            if (first && statements.some((s) => s.statement.includes("'dispatching'"))) {
              first = false;
              if (++arrived === runs) release();
              await barrier;
            }
            return transaction(statements);
          };
        };
        await Promise.all(
          Array.from({ length: runs }, () =>
            run(leadId, jobId, provider, { transaction: racing() }),
          ),
        );
        assert.equal(arrived, runs);
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
        // A worker without the live lease cannot treat the dispatch as its own stale one.
        await run(leadId, jobId, provider, { workerId: "intruder" });
        assert.deepEqual(
          (await attempts(leadId)).map((r) => r.dispatch_state),
          ["dispatching"],
        );
        // While the dispatching job still holds a live lease, nothing changes.
        assert.deepEqual(await reconcileLeadStaffAlert(leadId, query), { unknown: 0 });
        await query("UPDATE ops_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [
          jobId,
        ]);
        assert.deepEqual(await reconcileLeadStaffAlert(leadId, query), { unknown: 1 });
        assert.equal((await attempts(leadId))[0].dispatch_state, "unknown");
        assert.equal(provider.calls.length, 1);
      });

      await t.test("a claim-transaction failure is retryable and never sends twice", async () => {
        const channel = scenario();
        await staffWithEndpoint(channel, { duty: true, roles: ["manager"] });
        const leadId = await seedLead(query);
        const jobId = await leasedJob(query, leadId);
        const provider = fakeProvider();
        // The claim commits but its reply is lost (worst case for a resend).
        const lossy = async (statements) => {
          const rows = await transaction(statements);
          if (statements.some((s) => s.statement.includes("'dispatching'")))
            throw new Error("synthetic connection reset");
          return rows;
        };
        await assert.rejects(run(leadId, jobId, provider, { transaction: lossy }), (error) => {
          assert.equal(error.code, "LEAD_ALERT_CLAIM_FAILED");
          assert.equal(error.retryable, true);
          return true;
        });
        assert.equal(provider.calls.length, 0);
        assert.deepEqual(
          (await attempts(leadId)).map((r) => r.dispatch_state),
          ["dispatching"],
        );
        // The runner retries the same job under a new lease.
        await query(
          "UPDATE ops_jobs SET lease_owner='worker-2',lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
          [jobId],
        );
        await run(leadId, jobId, provider, { workerId: "worker-2" });
        assert.equal(provider.calls.length, 0);
        assert.deepEqual(
          (await attempts(leadId)).map((r) => [r.dispatch_state, r.safe_error]),
          [["unknown", "lease_expired_after_dispatch"]],
        );
        await run(leadId, jobId, provider, { workerId: "worker-2" });
        assert.equal(provider.calls.length, 0);
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
          // Sanity only (isolation itself never writes contacts): a true return is what
          // keeps the inbound customer pipeline from creating a contact/lead for staff.
          assert.equal(
            (await query("SELECT count(*)::int n FROM crm_contacts"))[0].n,
            contactsBefore,
          );

          // Ambiguous path: a fresh staff message with no reply context and no
          // correlated operation id is still held back as staff (review), because
          // that member has a live lead-alert attempt.
          const fresh = {
            ...reply,
            externalMessageId: "staff-fresh-1",
            payload: { type: "TEXT", timestamp: Math.floor(Date.now() / 1000) - 5 },
            text: "我而家跟進",
          };
          assert.equal(await isolateSignedStaffEvent(fresh, transaction), true);
          const review = await query(
            "SELECT association_state,notification_attempt_id FROM staff_notification_internal_events WHERE member_id=$1 AND association_state='review'",
            [duty.destination],
          );
          assert.deepEqual(review, [
            { association_state: "review", notification_attempt_id: null },
          ]);
        },
      );

      await t.test("lead_missing is logged with ids only", async (st) => {
        scenario();
        const warn = st.mock.method(console, "warn", () => {});
        const leadId = randomUUID();
        const jobId = await leasedJob(query, leadId);
        const result = await run(leadId, jobId, fakeProvider());
        assert.deepEqual(result, { summary: { accepted: 0, unknown: 0, blocked: 1 } });
        assert.deepEqual(
          warn.mock.calls.map((c) => c.arguments),
          [["[lead-alert] lead_missing", { leadId, jobId }]],
        );
      });

      await t.test(
        "the reconcile job type is spelled once, beside the alert job type",
        async () => {
          const enqueue = await import("../neon/lead-alert-enqueue.js");
          const { LEAD_ALERT_RECONCILE_JOB } = await import("./lead-alert.server.ts");
          assert.equal(enqueue.LEAD_ALERT_RECONCILE_JOB_TYPE, "lead.staff.alert.reconcile");
          assert.equal(LEAD_ALERT_RECONCILE_JOB, enqueue.LEAD_ALERT_RECONCILE_JOB_TYPE);
          assert.doesNotMatch(handlerSource(), /"lead\.staff\.alert(\.reconcile)?"/);
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

      // ---------------------------------------------------------------- Task 4
      const { persistWebsiteInquiry } = await import("../neon/website-inquiry.js");
      const { persistValuationLead } = await import("../neon/valuation-leads.js");
      const { persistListingAlert } = await import("../neon/listing-alerts.js");
      const alertJobs = (leadId) =>
        query(
          "SELECT job_type,payload_version,payload,status,max_attempts,idempotency_key FROM ops_jobs WHERE job_type='lead.staff.alert' AND payload->>'leadId'=$1",
          [leadId],
        );
      const alertJobCount = async () =>
        Number(
          (await query("SELECT count(*) AS n FROM ops_jobs WHERE job_type='lead.staff.alert'"))[0]
            .n,
        );
      const leadCount = async () =>
        Number((await query("SELECT count(*) AS n FROM crm_leads"))[0].n);
      const intake = (overrides = {}) => ({
        name: "陳先生",
        phone: "9123 4567",
        normalizedPhone: `852${Math.floor(10000000 + Math.random() * 89999999)}`,
        email: null,
        message: "想睇樓",
        listingNo: null,
        propertyId: null,
        consentWhatsapp: false,
        ...overrides,
      });
      const leadFor = async (inquiryId) =>
        (
          await query(
            "SELECT l.id, l.assigned_agent_id FROM inquiries i JOIN crm_leads l ON l.id=i.crm_lead_id OR (i.crm_lead_id IS NULL AND l.contact_id=i.crm_contact_id) WHERE i.id=$1",
            [inquiryId],
          )
        )[0];
      const expectOneAlert = async (leadId) => {
        const jobs = await alertJobs(leadId);
        assert.equal(jobs.length, 1, "exactly one alert job per lead");
        assert.equal(jobs[0].idempotency_key, `lead-alert:${leadId}`);
        assert.deepEqual(jobs[0].payload, { leadId });
        assert.equal(jobs[0].max_attempts, 3);
        assert.equal(jobs[0].payload_version, 1);
        assert.equal(jobs[0].status, "queued");
        // The general lane: laneForJob is pure string logic, read it from source.
        const wakeSource = readFileSync(
          new URL("../control-plane/job-wake.server.ts", import.meta.url),
          "utf8",
        );
        assert.match(wakeSource, /woztell\.enquiry\./);
        assert.doesNotMatch(
          wakeSource,
          /lead\.staff\.alert/,
          "the alert job stays on the general lane",
        );
      };

      await t.test("each source path enqueues exactly one alert job", async () => {
        const jobsBefore = await alertJobCount();
        // Contact form: no listing.
        const contact = await persistWebsiteInquiry(query, intake({ submissionId: randomUUID() }));
        assert.equal(contact.leadAlertQueued, true);
        await expectOneAlert((await leadFor(contact.id)).id);

        // Property enquiry: active listing with an active agent.
        const agentId = await seedStaff(query, { roles: ["agent"] });
        const listingNo = `FX05B-${randomUUID().slice(0, 8)}`;
        const [property] = await query(
          "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,price,agent_id) VALUES($1,$1,'提醒測試盤','sale','sham-tseng','active',10000000,$2) RETURNING id",
          [listingNo, agentId],
        );
        const enquiry = await persistWebsiteInquiry(
          query,
          intake({ submissionId: randomUUID(), listingNo, propertyId: property.id }),
        );
        assert.equal(enquiry.leadAlertQueued, true);
        const enquiryLead = await leadFor(enquiry.id);
        assert.equal(enquiryLead.assigned_agent_id, agentId);
        await expectOneAlert(enquiryLead.id);

        // The same submissionId replayed: still one lead, one job, not queued again.
        const replayInput = intake({ submissionId: randomUUID() });
        const first = await persistWebsiteInquiry(query, replayInput);
        const leadsAfterFirst = await leadCount();
        const jobsAfterFirst = await alertJobCount();
        const replay = await persistWebsiteInquiry(query, replayInput);
        assert.equal(replay.id, first.id);
        assert.equal(replay.leadAlertQueued, false);
        assert.equal(await leadCount(), leadsAfterFirst);
        assert.equal(await alertJobCount(), jobsAfterFirst);
        await expectOneAlert((await leadFor(first.id)).id);

        // Legacy path with no submissionId: one job per lead.
        const legacyA = await persistWebsiteInquiry(query, intake());
        const legacyB = await persistWebsiteInquiry(query, intake());
        assert.equal(legacyA.leadAlertQueued, true);
        assert.equal(legacyB.leadAlertQueued, true);
        await expectOneAlert((await leadFor(legacyA.id)).id);
        await expectOneAlert((await leadFor(legacyB.id)).id);

        assert.equal(await alertJobCount(), jobsBefore + 5);
      });

      await t.test(
        "sources not yet creating leads enqueue none (FX-02 / FX-05c / FX-09 hooks)",
        async (st) => {
          // These flip when the named batch makes the source create a lead and enqueue.
          await st.test(
            "valuation request and listing alert create no lead or job (FX-05c / FX-09)",
            async () => {
              const leads = await leadCount();
              const jobs = await alertJobCount();
              await persistValuationLead(query, {
                name: "估價客戶",
                phone: "91234567",
                email: null,
                propertyAddress: "測試大廈",
                estateId: null,
                notes: null,
                consentText: "synthetic",
                consentVersion: "1",
                consentedAt: new Date().toISOString(),
                utm: {},
              });
              await persistListingAlert(query, {
                name: "提醒客戶",
                phone: "91234568",
                email: null,
                filters: {},
                consentText: "synthetic",
                consentVersion: "1",
                consentedAt: new Date().toISOString(),
                utm: {},
              });
              assert.equal(
                await leadCount(),
                leads,
                "valuation/listing-alert now create leads: FX-05c / FX-09 must flip this assertion deliberately",
              );
              assert.equal(
                await alertJobCount(),
                jobs,
                "valuation/listing-alert now enqueue alerts: FX-05c / FX-09 must flip this assertion deliberately",
              );
            },
          );
          await st.test(
            "a WhatsApp inbound message creates a lead through the trigger but no job (FX-02)",
            async () => {
              const jobs = await alertJobCount();
              const leads = await leadCount();
              const [contact] = await query(
                "INSERT INTO crm_contacts(name,phone,normalized_phone) VALUES('入站客戶','synthetic',$1) RETURNING id",
                [`wa-${randomUUID()}`],
              );
              await query(
                "INSERT INTO whatsapp_messages(contact_id,direction,message_type,text,external_message_id) VALUES($1,'inbound','text','hello',$2)",
                [contact.id, `ext-${randomUUID()}`],
              );
              assert.equal(await leadCount(), leads + 1);
              assert.equal(
                await alertJobCount(),
                jobs,
                "WhatsApp inbound leads now enqueue alerts: FX-02 must flip this assertion deliberately",
              );
            },
          );
        },
      );

      await t.test("backfilled lead enqueues none", async () => {
        const jobs = await alertJobCount();
        // The shape the FX-02 backfill and migration reconciles use.
        const leadId = await seedLead(query);
        assert.equal((await alertJobs(leadId)).length, 0);
        // Re-run the history INSERT ... SELECT from 20260906100000_whatsapp_inbound_leads.sql:26-31.
        // The ensure_whatsapp_inbound_lead trigger already made this contact's lead; drop it so
        // the history statement has a contact to reconcile.
        const [contact] = await query(
          "INSERT INTO crm_contacts(name,phone,normalized_phone) VALUES('歷史客戶','synthetic',$1) RETURNING id",
          [`hist-${randomUUID()}`],
        );
        await query(
          "INSERT INTO whatsapp_messages(contact_id,direction,message_type,text,external_message_id) VALUES($1,'inbound','text','old',$2)",
          [contact.id, `hist-${randomUUID()}`],
        );
        await query("DELETE FROM crm_leads WHERE contact_id=$1", [contact.id]);
        const backfilled = await query(
          `INSERT INTO crm_leads(contact_id,assigned_agent_id,stage,intent,source,note,created_at,updated_at)
           SELECT c.id,c.assigned_agent_id,'new','unknown','whatsapp',
             'WhatsApp 入站查詢；詳情見對話紀錄。',min(m.created_at),max(m.created_at)
           FROM whatsapp_messages m JOIN crm_contacts c ON c.id=m.contact_id
           WHERE m.direction::text='inbound'
             AND NOT EXISTS (SELECT 1 FROM crm_leads l WHERE l.contact_id=c.id)
           GROUP BY c.id,c.assigned_agent_id
           RETURNING id`,
        );
        assert.ok(backfilled.length >= 1, "the history statement inserted a lead");
        assert.equal(await alertJobCount(), jobs);
        const triggers = await query(
          `SELECT t.tgname, pg_get_functiondef(p.oid) AS body
           FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
           WHERE t.tgrelid='crm_leads'::regclass AND NOT t.tgisinternal`,
        );
        for (const trigger of triggers)
          assert.doesNotMatch(
            trigger.body,
            /ops_jobs/,
            `trigger ${trigger.tgname} must not enqueue`,
          );
      });

      await t.test(
        "website enquiry wakes the general lane once, and a replay wakes nothing",
        async () => {
          const wakes = [];
          let wakeImpl = (lane) => wakes.push(lane);
          await mockOwnedServerDb(mock, query, transaction);
          mock.module(new URL("src/lib/control-plane/job-wake.server.ts", repoRoot).href, {
            exports: {
              wakeAfterCommit: (lane) => wakeImpl(lane),
              laneForJob: () => "general",
            },
          });
          const { createWebsiteInquiry } = await import("../neon/admin-data.server.ts");
          const input = {
            submissionId: randomUUID(),
            name: "陳先生",
            phone: "9123 4567",
            message: "想睇樓",
            consentWhatsapp: false,
          };
          const first = await createWebsiteInquiry(input);
          assert.deepEqual(wakes, ["general"]);
          const replay = await createWebsiteInquiry(input);
          assert.equal(replay.id, first.id);
          assert.deepEqual(wakes, ["general"], "a replay must not wake the lane");

          // A wake that throws must never fail an already-committed enquiry.
          const warn = mock.method(console, "warn", () => {});
          wakeImpl = () => {
            throw new Error("synthetic wake failure");
          };
          try {
            const committed = await createWebsiteInquiry({ ...input, submissionId: randomUUID() });
            assert.ok(committed.id, "the committed enquiry id is still returned");
            assert.equal(committed.leadAlertQueued, true);
            assert.equal((await alertJobs((await leadFor(committed.id)).id)).length, 1);
            assert.equal(warn.mock.calls.length, 1);
            assert.equal(
              warn.mock.calls[0].arguments[0],
              "[website-inquiry] lead_alert_wake_failed",
            );
            assert.doesNotMatch(
              JSON.stringify(warn.mock.calls[0].arguments),
              /synthetic|陳先生|9123/,
            );
          } finally {
            warn.mock.restore();
          }
        },
      );

      await t.test(
        "toggling duty manager is audited and immediately changes the alert destination for the next lead",
        async (st) => {
          const { createStaffLifecycleService } = await import("../neon/staff-lifecycle.server.ts");
          const channel = scenario();
          const admin = await seedStaff(query, { roles: ["admin"] });
          const actor = {
            staffId: admin,
            authUserId: `lead-alert-${admin}`,
            email: null,
            name: "Admin",
            roles: ["admin"],
            bootstrap: false,
            matchedProfileOnly: false,
          };
          const service = createStaffLifecycleService({
            organizationId: "synthetic",
            provider: {},
            queryRows: (statement, params) => query(statement, params),
            updateStaffRoles: async () => assert.fail("not used"),
            setStaffActive: async () => assert.fail("not used"),
            writeAudit: async () => assert.fail("duty manager audit is in-statement"),
          });
          const request = new Request("https://earnest.example.invalid/admin/team");
          const target = await staffWithEndpoint(channel, { duty: false, roles: ["agent"] });
          const version = async (id) =>
            new Date(
              (await query("SELECT updated_at FROM staff_users WHERE id=$1", [id]))[0].updated_at,
            ).toISOString();
          const auditRows = (id) =>
            query(
              "SELECT actor_staff_id,permission,action,resource_type,outcome,request_id,metadata FROM ops_audit_logs WHERE resource_id=$1 AND action='staff.duty_manager_changed' ORDER BY created_at, id",
              [id],
            );
          const alertTo = async () => {
            const leadId = await seedLead(query);
            const provider = fakeProvider();
            await run(leadId, await leasedJob(query, leadId), provider);
            return provider.calls.map((c) => c.memberId);
          };

          // Before: nobody is on duty for this channel -> nothing is sent.
          assert.deepEqual(await alertTo(), []);

          await st.test(
            "marking sends the next lead to the member, with one audit row",
            async () => {
              const result = await service.changeStaffDutyManager(
                {
                  staffId: target.staffId,
                  isDutyManager: true,
                  expectedVersion: await version(target.staffId),
                },
                actor,
                request,
              );
              assert.equal(result.isDutyManager, true);
              assert.deepEqual(await alertTo(), [target.destination]);
              const audit = await auditRows(target.staffId);
              assert.equal(audit.length, 1);
              assert.equal(audit[0].actor_staff_id, admin);
              assert.equal(audit[0].permission, "staff.manage");
              assert.equal(audit[0].resource_type, "staff_user");
              assert.equal(audit[0].outcome, "success");
              assert.equal(audit[0].request_id, result.requestId);
              assert.deepEqual(audit[0].metadata, { before: false, after: true });
            },
          );

          await st.test("a stale version is 409, writes nothing, and changes nothing", async () => {
            const stale = await version(target.staffId);
            await query(
              "UPDATE staff_users SET updated_at = updated_at + interval '1 second' WHERE id=$1",
              [target.staffId],
            );
            const failure = await service
              .changeStaffDutyManager(
                { staffId: target.staffId, isDutyManager: false, expectedVersion: stale },
                actor,
                request,
              )
              .catch((e) => e);
            assert.ok(failure instanceof Response);
            assert.equal(failure.status, 409);
            assert.equal(await failure.text(), "STAFF_CHANGED");
            assert.equal((await auditRows(target.staffId)).length, 1);
            assert.equal(
              (
                await query("SELECT is_duty_manager FROM staff_users WHERE id=$1", [target.staffId])
              )[0].is_duty_manager,
              true,
            );
          });

          await st.test("unmarking stops the next lead and is audited", async () => {
            const result = await service.changeStaffDutyManager(
              {
                staffId: target.staffId,
                isDutyManager: false,
                expectedVersion: await version(target.staffId),
              },
              actor,
              request,
            );
            assert.equal(result.isDutyManager, false);
            assert.deepEqual(await alertTo(), []);
            const audit = await auditRows(target.staffId);
            assert.equal(audit.length, 2);
            assert.deepEqual(audit[1].metadata, { before: true, after: false });
          });

          await st.test("a suspended member cannot be marked and nothing is audited", async () => {
            const suspended = await seedStaff(query, { active: false });
            const failure = await service
              .changeStaffDutyManager(
                {
                  staffId: suspended,
                  isDutyManager: true,
                  expectedVersion: await version(suspended),
                },
                actor,
                request,
              )
              .catch((e) => e);
            assert.equal(failure.status, 409);
            assert.equal((await auditRows(suspended)).length, 0);
          });
        },
      );
    });
  } finally {
    applyEnv(savedEnv);
  }
});
