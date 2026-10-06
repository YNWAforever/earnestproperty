import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

// FX-09 lead integrity. One owned container for the whole file: Tasks 2, 4 and
// 5 add subtests below. Synthetic data only. Nothing talks to WozTell, Neon
// production or a model: fetch throws and the ops wake is disabled.

const id = (n) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1);
const MANAGER = id(2);
const AGENT_A = id(3);
const AGENT_B = id(4);
const AGENT_C = id(5);
const VIEWER = id(6);
const CONTACT = id(10);
const L1 = id(20);
const L3 = id(23);
const L4 = id(24);
const MEMBER = "synthetic-fx09-member-1";

const actor = (staffId, role) => ({
  staffId,
  authUserId: "synthetic-fx09-" + staffId,
  roles: [role],
});
const admin = actor(ADMIN, "admin");
const manager = actor(MANAGER, "manager");
const agentB = actor(AGENT_B, "agent");

function draftFrom(detail, overrides = {}) {
  return {
    id: detail.id,
    stage: detail.stage,
    intent: detail.intent,
    budget_min: detail.budget_min,
    budget_max: detail.budget_max,
    preferred_estates: detail.preferred_estates,
    assigned_agent_id: detail.assigned_agent_id,
    note: detail.note,
    expected_version: detail.version,
    ...overrides,
  };
}

async function rejectsWith(promise, status, body) {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Response, "expected a thrown Response, got " + String(error));
  assert.equal(error.status, status);
  if (body !== undefined) assert.equal(await error.text(), body);
}

test("FX-09 lead integrity on owned Postgres", { timeout: 300000 }, async (t) => {
  delete process.env.OPS_EVENT_WAKE_ENABLED;
  const network = mock.method(globalThis, "fetch", () => {
    throw new Error("FX-09 owned test: network is disabled");
  });
  try {
    await withOwnedPostgres(async ({ query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const server = await import("./admin-data.server.ts");
      const { staffReassignStatements } = await import("./staff-ownership.ts");
      const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");

      for (const [staffId, role, active] of [
        [ADMIN, "admin", true],
        [MANAGER, "manager", true],
        [AGENT_A, "agent", true],
        [AGENT_B, "agent", true],
        [AGENT_C, "agent", false],
        [VIEWER, "viewer", true],
      ]) {
        await query(
          "INSERT INTO staff_users(id,auth_user_id,email,name_zh,active) VALUES($1,$2,$3,$4,$5)",
          [
            staffId,
            "synthetic-fx09-" + staffId,
            "fx09-" + staffId.slice(-2) + "@example.invalid",
            "測試同事" + staffId.slice(-1),
            active,
          ],
        );
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [staffId, role]);
      }
      await query(
        "INSERT INTO crm_contacts(id,name,whatsapp_member_id,source) VALUES($1,'Synthetic FX09 客戶',$2,'whatsapp')",
        [CONTACT, MEMBER],
      );
      await query(
        "INSERT INTO crm_leads(id,contact_id,assigned_agent_id,stage,intent) VALUES($1,$2,$3,'contacted','buyer')",
        [L1, CONTACT, AGENT_A],
      );

      // Test setup, not a hand-built token: every test starts from a known row
      // whose updated_at has non-zero microseconds. The token itself is only
      // ever read back through fetchAdminLead.
      const resetL1 = async () => {
        await query(
          `UPDATE crm_leads SET stage='contacted',intent='buyer',budget_min=NULL,budget_max=NULL,
             preferred_estates='{}',assigned_agent_id=$2,note=NULL,
             updated_at='2026-10-06 01:02:03.123456+00' WHERE id=$1`,
          [L1, AGENT_A],
        );
      };
      const leadRow = async (leadId) =>
        (
          await query(
            "SELECT stage::text,assigned_agent_id::text,note,updated_at::text FROM crm_leads WHERE id=$1",
            [leadId],
          )
        )[0];
      const auditCount = async (leadId) =>
        (
          await query(
            "SELECT count(*)::int AS n FROM audit_logs WHERE action='lead.update' AND subject_id=$1",
            [leadId],
          )
        )[0].n;
      const read = async (leadId, who = admin) => {
        const detail = await server.fetchAdminLead(leadId, who);
        assert.ok(detail, "lead must be readable");
        return detail;
      };

      await t.test("stale expected_updated_at → 409", async () => {
        await resetL1();
        const before = await auditCount(L1);
        const managerView = await read(L1, manager);
        const adminView = await read(L1, admin);
        assert.equal(managerView.version, adminView.version);

        const saved = await server.updateAdminLead(
          draftFrom(adminView, { assigned_agent_id: AGENT_B }),
          admin,
        );
        assert.equal(saved.ok, true);
        assert.notEqual(saved.version, adminView.version);

        await rejectsWith(
          server.updateAdminLead(draftFrom(managerView, { stage: "viewing" }), manager),
          409,
          "LEAD_CHANGED",
        );
        const row = await leadRow(L1);
        assert.equal(row.assigned_agent_id, AGENT_B);
        assert.equal(row.stage, "contacted");
        assert.equal((await auditCount(L1)) - before, 1);
      });

      await t.test("own consecutive saves succeed", async () => {
        await resetL1();
        const detail = await read(L1, manager);
        const v1 = detail.version;
        const first = await server.updateAdminLead(draftFrom(detail, { note: "一" }), manager);
        assert.equal(first.ok, true);
        const v2 = first.version;
        const second = await server.updateAdminLead(
          draftFrom(detail, { note: "二", expected_version: v2 }),
          manager,
        );
        assert.equal(second.ok, true);
        const v3 = second.version;
        assert.equal((await read(L1, manager)).version, v3);
        assert.ok(v1 < v2 && v2 < v3, `versions must advance: ${v1} ${v2} ${v3}`);
      });

      await t.test(
        "a version read through fetchAdminLead with non-zero microseconds saves twice in a row, and a no-op save keeps the version",
        async () => {
          await resetL1();
          const detail = await read(L1, manager);
          const v1 = detail.version;
          assert.match(v1, /\.123456Z$/);
          const draft = draftFrom(detail, { note: "三" });
          const first = await server.updateAdminLead(draft, manager);
          assert.equal(first.ok, true);
          const audits = await auditCount(L1);

          const again = await server.updateAdminLead(
            { ...draft, expected_version: first.version },
            manager,
          );
          assert.deepEqual(again, { ok: true, version: first.version, changed: [] });
          assert.equal(await auditCount(L1), audits);

          await rejectsWith(
            server.updateAdminLead({ ...draft, expected_version: v1 }, manager),
            409,
            "LEAD_CHANGED",
          );
          assert.equal(await auditCount(L1), audits);
        },
      );

      await t.test("audit has before/after assigned_agent_id", async () => {
        await resetL1();
        const detail = await read(L1, manager);
        const v1 = detail.version;
        const saved = await server.updateAdminLead(
          draftFrom(detail, { assigned_agent_id: AGENT_B }),
          manager,
        );
        assert.equal(saved.ok, true);
        assert.deepEqual(saved.changed, ["assigned_agent_id"]);
        const v2 = saved.version;
        const [audit] = await query(
          "SELECT actor_id::text,subject_id::text,metadata FROM audit_logs WHERE action='lead.update' AND metadata->>'version'=$1",
          [v2],
        );
        assert.ok(audit, "the save must write its audit row in the same statement");
        assert.equal(audit.actor_id, MANAGER);
        assert.equal(audit.subject_id, L1);
        assert.deepEqual(audit.metadata.changed, ["assigned_agent_id"]);
        assert.equal(audit.metadata.before.assigned_agent_id, AGENT_A);
        assert.equal(audit.metadata.after.assigned_agent_id, AGENT_B);
        assert.equal(audit.metadata.expectedVersion, v1);
        assert.equal(audit.metadata.version, v2);
        assert.equal("stage" in audit.metadata.before, false);

        const next = await server.updateAdminLead(
          draftFrom(detail, {
            assigned_agent_id: AGENT_B,
            stage: "viewing",
            note: "睇樓",
            expected_version: v2,
          }),
          manager,
        );
        assert.deepEqual(next.changed, ["note", "stage"]);
        const [second] = await query(
          "SELECT metadata FROM audit_logs WHERE action='lead.update' AND metadata->>'version'=$1",
          [next.version],
        );
        assert.deepEqual(second.metadata.changed, ["note", "stage"]);
        assert.deepEqual(second.metadata.before, { note: null, stage: "contacted" });
        assert.deepEqual(second.metadata.after, { note: "睇樓", stage: "viewing" });
      });

      await t.test(
        "writers that change a lead bump its version, writers that do not leave it alone",
        async () => {
          await resetL1();
          const v = (await read(L1, manager)).version;

          await server.createAdminLeadActivity(
            {
              lead_id: L1,
              contact_id: CONTACT,
              activity_type: "note",
              body: "合成跟進筆記",
              due_at: null,
              completed_at: null,
            },
            manager,
          );
          assert.equal((await read(L1, manager)).version, v, "a note must not bump the lead");

          await query("SELECT * FROM wa_update_lead_contact($1,$2,$3,$4)", [
            MANAGER,
            L1,
            "陳太",
            null,
          ]);
          assert.equal(
            (await read(L1, manager)).version,
            v,
            "a contact edit must not bump the lead",
          );

          const [{ n: leadsBefore }] = await query(
            "SELECT count(*)::int AS n FROM crm_leads WHERE contact_id=$1",
            [CONTACT],
          );
          const now = new Date().toISOString();
          const outcome = await ingestWoztellEvent(
            {
              direction: "inbound",
              externalMessageId: "synthetic-fx09-message-1",
              legacyExternalMessageId: null,
              fromPhone: null,
              toPhone: null,
              timestamp: now,
              messageType: "TEXT",
              text: "想再睇下個盤",
              woztellMemberId: MEMBER,
              channelId: "synthetic-fx09-channel",
              appId: "synthetic-fx09-app",
              memberName: "Synthetic FX09 Profile",
              payload: { type: "TEXT", eventType: "INBOUND", data: { text: "想再睇下個盤" } },
            },
            "live_webhook",
            transaction,
            { mode: "off" },
          );
          assert.equal(outcome.messageInserted, true);
          assert.equal(outcome.contactId, CONTACT);
          assert.equal(
            (await read(L1, manager)).version,
            v,
            "an inbound message on an open lead must not bump it",
          );
          const [{ n: leadsAfter }] = await query(
            "SELECT count(*)::int AS n FROM crm_leads WHERE contact_id=$1",
            [CONTACT],
          );
          assert.equal(leadsAfter, leadsBefore);

          const detail = await read(L1, manager);
          const saved = await server.updateAdminLead(
            draftFrom(detail, { assigned_agent_id: AGENT_B, expected_version: v }),
            manager,
          );
          assert.equal(saved.ok, true);
          const vPrime = saved.version;

          await transaction(staffReassignStatements(AGENT_B, AGENT_A));
          const handedOver = await read(L1, manager);
          assert.equal(handedOver.assigned_agent_id, AGENT_A);
          assert.notEqual(handedOver.version, vPrime, "staff handover must bump the lead version");
          await rejectsWith(
            server.updateAdminLead(
              draftFrom(detail, {
                assigned_agent_id: AGENT_B,
                stage: "viewing",
                expected_version: vPrime,
              }),
              manager,
            ),
            409,
            "LEAD_CHANGED",
          );
          assert.equal((await leadRow(L1)).assigned_agent_id, AGENT_A);
        },
      );

      await t.test(
        "a lead owned by a deactivated agent can still be re-staged, and only a new assignment to inactive staff is refused",
        async () => {
          const L2 = id(21);
          await query(
            "INSERT INTO crm_leads(id,contact_id,assigned_agent_id,stage,intent) VALUES($1,$2,$3,'new','buyer')",
            [L2, CONTACT, AGENT_A],
          );
          await query("UPDATE staff_users SET active=false WHERE id=$1", [AGENT_A]);
          try {
            const staged = await server.updateAdminLead(
              draftFrom(await read(L2, manager), { stage: "contacted" }),
              manager,
            );
            assert.equal(staged.ok, true);
            assert.deepEqual(staged.changed, ["stage"]);

            const beforeRow = await leadRow(L2);
            const beforeAudits = await auditCount(L2);
            await rejectsWith(
              server.updateAdminLead(
                draftFrom(await read(L2, manager), { assigned_agent_id: AGENT_C }),
                manager,
              ),
              400,
              "ASSIGNEE_INACTIVE",
            );
            assert.deepEqual(await leadRow(L2), beforeRow);
            assert.equal(await auditCount(L2), beforeAudits);

            const unassigned = await server.updateAdminLead(
              draftFrom(await read(L2, manager), { assigned_agent_id: null }),
              manager,
            );
            assert.equal(unassigned.ok, true);
            assert.equal((await leadRow(L2)).assigned_agent_id, null);

            const toB = await server.updateAdminLead(
              draftFrom(await read(L2, manager), { assigned_agent_id: AGENT_B }),
              manager,
            );
            assert.equal(toB.ok, true);
            assert.equal((await leadRow(L2)).assigned_agent_id, AGENT_B);
          } finally {
            await query("UPDATE staff_users SET active=true WHERE id=$1", [AGENT_A]);
          }
        },
      );

      await t.test(
        "a save without a valid version is refused with 400 and writes nothing",
        async () => {
          await resetL1();
          const detail = await read(L1, manager);
          const beforeRow = await leadRow(L1);
          const beforeAudits = await auditCount(L1);
          for (const expected_version of [
            undefined,
            "",
            null,
            "2026-10-06T01:02:03.123Z",
            1696561445123,
          ]) {
            await rejectsWith(
              server.updateAdminLead(
                draftFrom(detail, { stage: "viewing", expected_version }),
                manager,
              ),
              400,
              "LEAD_VERSION_REQUIRED",
            );
          }
          assert.deepEqual(await leadRow(L1), beforeRow);
          assert.equal((await read(L1, manager)).version, detail.version);
          assert.equal(await auditCount(L1), beforeAudits);
        },
      );

      const bulkAudits = async () =>
        (
          await query("SELECT count(*)::int AS n FROM audit_logs WHERE action='lead.bulk_update'")
        )[0].n;
      const resetBulk = async () => {
        for (const leadId of [L3, L4]) {
          await query(
            `INSERT INTO crm_leads(id,contact_id,assigned_agent_id,stage,intent,updated_at)
             VALUES($1,$2,$3,'contacted','buyer','2026-10-06 02:03:04.234567+00')
             ON CONFLICT (id) DO UPDATE SET stage='contacted',assigned_agent_id=$3,
               updated_at='2026-10-06 02:03:04.234567+00'`,
            [leadId, CONTACT, AGENT_A],
          );
        }
      };

      await t.test("bulk assign to inactive staff → 400", async () => {
        await resetBulk();
        const v3 = (await read(L3)).version;
        const v4 = (await read(L4)).version;
        const audits = await bulkAudits();
        await rejectsWith(
          server.bulkUpdateAdminLeads(
            { ids: [L3, L4], assignAgent: true, assigned_agent_id: AGENT_C },
            manager,
          ),
          400,
          "ASSIGNEE_INACTIVE",
        );
        for (const [leadId, v] of [
          [L3, v3],
          [L4, v4],
        ]) {
          const lead = await read(leadId);
          assert.equal(lead.version, v);
          assert.equal(lead.assigned_agent_id, AGENT_A);
        }
        assert.equal(await bulkAudits(), audits);
      });

      await t.test(
        "bulk re-stage and bulk unassign still work when the owner is inactive",
        async () => {
          await resetBulk();
          await query("UPDATE staff_users SET active=false WHERE id=$1", [AGENT_A]);
          try {
            let v = (await read(L3)).version;
            const step = async (input) => {
              const res = await server.bulkUpdateAdminLeads({ ids: [L3, L4], ...input }, manager);
              assert.deepEqual(res, { ok: true, updated: 2, requested: 2 });
              const next = (await read(L3)).version;
              assert.notEqual(next, v, "a real change must bump the version");
              v = next;
            };
            await step({ stage: "viewing" });
            await step({ assignAgent: true, assigned_agent_id: null });
            await step({ assignAgent: true, assigned_agent_id: AGENT_B });
          } finally {
            await query("UPDATE staff_users SET active=true WHERE id=$1", [AGENT_A]);
          }
        },
      );

      await t.test("bulk update bumps the version so an open editor gets 409", async () => {
        await resetBulk();
        const open = await read(L3);
        await server.bulkUpdateAdminLeads({ ids: [L3], stage: "viewing" }, manager);
        await rejectsWith(
          server.updateAdminLead(draftFrom(open, { note: "x" }), admin),
          409,
          "LEAD_CHANGED",
        );
      });

      await t.test("bulk re-stage to the same value does not bump the version", async () => {
        await resetBulk();
        const v3 = (await read(L3)).version;
        const v4 = (await read(L4)).version;
        const res = await server.bulkUpdateAdminLeads(
          { ids: [L3, L4], stage: "contacted", assignAgent: true, assigned_agent_id: AGENT_A },
          manager,
        );
        assert.equal(res.ok, true);
        assert.equal((await read(L3)).version, v3);
        assert.equal((await read(L4)).version, v4);
        // One lead changes, the other does not: only the changed one bumps.
        await query("UPDATE crm_leads SET stage='viewing' WHERE id=$1", [L4]);
        const v4b = (await read(L4)).version;
        await server.bulkUpdateAdminLeads({ ids: [L3, L4], stage: "viewing" }, manager);
        assert.notEqual((await read(L3)).version, v3);
        assert.equal((await read(L4)).version, v4b);
      });

      await t.test("agent scope is unchanged", async () => {
        await resetL1();
        const detail = await read(L1, admin);
        assert.equal(await server.fetchAdminLead(L1, agentB), null);
        await rejectsWith(
          server.updateAdminLead(draftFrom(detail, { stage: "viewing" }), agentB),
          403,
        );
        assert.equal((await leadRow(L1)).stage, "contacted");
        const missing = await server.updateAdminLead(
          draftFrom(detail, { id: id(99), stage: "viewing" }),
          admin,
        );
        assert.deepEqual(missing, { ok: false, error: "Not found" });
      });
    });
  } finally {
    network.mock.restore();
  }
});
