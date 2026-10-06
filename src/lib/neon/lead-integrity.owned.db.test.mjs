import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
  repoRoot,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS, pendingMigrations } from "../control-plane/migration-versions.js";
import { formatDriftReport } from "../../../scripts/neon/check-migration-drift.mjs";

const PROFILE_NAME_MIGRATION = "20261009100000_contact_profile_name.sql";

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
    await withOwnedPostgres(async ({ pool, query, transaction }) => {
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

      // Task 4 / D-06: the WhatsApp profile name never overwrites the CRM name.
      const { normalizeWoztellEvent } = await import("../woztell/woztell.server.ts");
      const K = id(30);
      const LK = id(31);
      const MEMBER_K = "synthetic-fx09-member-k";
      let clock = 1791000000;
      const inbound = (memberId, memberName, text) =>
        normalizeWoztellEvent({
          timestamp: String(++clock),
          type: "TEXT",
          data: { text },
          member: memberId,
          channel: "synthetic-fx09-channel",
          app: "synthetic-fx09-app",
          ...(memberName === null ? {} : { memberExtra: { name: memberName } }),
        });
      const ingest = (event, origin) =>
        ingestWoztellEvent(event, origin, undefined, { mode: "off", signedEvent: true });
      const names = async (contactId) =>
        (
          await query("SELECT name,whatsapp_profile_name FROM crm_contacts WHERE id=$1", [
            contactId,
          ])
        )[0];
      const contactText = async (contactId) =>
        (await query("SELECT c::text AS row FROM crm_contacts c WHERE id=$1", [contactId]))[0].row;

      await t.test("migration A is additive and re-runnable", async () => {
        const [column] = await query(
          `SELECT data_type,is_nullable FROM information_schema.columns
           WHERE table_name='crm_contacts' AND column_name='whatsapp_profile_name'`,
        );
        assert.deepEqual(column, { data_type: "text", is_nullable: "YES" });
        assert.ok(MIGRATION_VERSIONS.includes(PROFILE_NAME_MIGRATION));

        const digest = async () =>
          (
            await query(
              "SELECT md5(string_agg(c::text, '|' ORDER BY c.id)) AS d, count(*)::int AS n FROM crm_contacts c",
            )
          )[0];
        const before = await digest();
        assert.ok(before.n > 0, "the digest must cover existing rows");
        const sql = readFileSync(
          new URL("../../../neon/migrations/" + PROFILE_NAME_MIGRATION, import.meta.url),
          "utf8",
        );
        await transaction([{ statement: sql }]);
        assert.deepEqual(await digest(), before);
      });

      await t.test("inbound message keeps staff-edited name, stores profile name", async () => {
        await query(
          "INSERT INTO crm_contacts(id,name,whatsapp_member_id,source) VALUES($1,NULL,$2,'whatsapp')",
          [K, MEMBER_K],
        );
        await query(
          "INSERT INTO crm_leads(id,contact_id,assigned_agent_id,stage,intent) VALUES($1,$2,$3,'contacted','buyer')",
          [LK, K, AGENT_A],
        );

        const first = await ingest(inbound(MEMBER_K, "Chan T", "你好"), "live_webhook");
        assert.equal(first.contactId, K);
        assert.deepEqual(await names(K), { name: "Chan T", whatsapp_profile_name: "Chan T" });

        await query("SELECT * FROM wa_update_lead_contact($1,$2,$3,$4)", [
          MANAGER,
          LK,
          "陳太",
          null,
        ]);
        assert.deepEqual(await names(K), { name: "陳太", whatsapp_profile_name: "Chan T" });

        const second = await ingest(inbound(MEMBER_K, "Chan Tai", "想睇樓"), "live_webhook");
        assert.equal(second.contactId, K);
        assert.equal(second.messageInserted, true);
        assert.deepEqual(await names(K), { name: "陳太", whatsapp_profile_name: "Chan Tai" });
      });

      await t.test(
        "history import never replays an old profile name or overwrites the CRM name",
        async () => {
          const old = await ingest(inbound(MEMBER_K, "Old Name", "舊訊息"), "history_import");
          assert.equal(old.contactId, K);
          assert.deepEqual(await names(K), { name: "陳太", whatsapp_profile_name: "Chan Tai" });

          const fresh = await ingest(
            inbound("synthetic-fx09-member-history", "Old Name", "歷史訊息"),
            "history_import",
          );
          assert.ok(fresh.contactId);
          assert.notEqual(fresh.contactId, K);
          assert.deepEqual(await names(fresh.contactId), {
            name: "Old Name",
            whatsapp_profile_name: "Old Name",
          });

          for (const origin of ["history_import", "live_webhook"]) {
            const nameless = await ingest(inbound(MEMBER_K, null, "冇名 " + origin), origin);
            assert.equal(nameless.contactId, K);
            assert.deepEqual(await names(K), { name: "陳太", whatsapp_profile_name: "Chan Tai" });
          }
        },
      );

      await t.test(
        "a staff-cleared name is refilled from the profile name on the next message",
        async () => {
          await query("SELECT * FROM wa_update_lead_contact($1,$2,$3,$4)", [MANAGER, LK, "", null]);
          assert.deepEqual(await names(K), { name: null, whatsapp_profile_name: "Chan Tai" });
          await ingest(inbound(MEMBER_K, "Chan Tai", "再問下"), "live_webhook");
          assert.deepEqual(await names(K), { name: "Chan Tai", whatsapp_profile_name: "Chan Tai" });
        },
      );

      await t.test("wrong recipient: a profile name never lands on another contact", async () => {
        const C1 = id(40);
        const C2 = id(41);
        await query(
          `INSERT INTO crm_contacts(id,name,whatsapp_member_id,source,whatsapp_profile_name)
           VALUES($1,'客一','synthetic-fx09-member-r1','whatsapp',NULL),
                 ($2,'客二','synthetic-fx09-member-r2','whatsapp','Second Profile')`,
          [C1, C2],
        );
        const other = await contactText(C2);
        const res = await ingest(
          inbound("synthetic-fx09-member-r1", "First Profile", "第一位"),
          "live_webhook",
        );
        assert.equal(res.contactId, C1);
        assert.deepEqual(await names(C1), { name: "客一", whatsapp_profile_name: "First Profile" });
        assert.equal(await contactText(C2), other);
      });

      // Task 5 / C-10: a customer whose leads are all closed gets a new lead when
      // they message again, and a closed conversation reopens. Every message goes
      // through real ingest. Message times follow the database clock so that a
      // live message is always newer than the staff close before it.
      let lastAt = 0;
      const nextAt = async () => {
        const [{ ms }] = await query(
          "SELECT (extract(epoch FROM clock_timestamp())*1000)::float8 AS ms",
        );
        lastAt = Math.max(lastAt + 1, Math.ceil(Number(ms)) + 1);
        return new Date(lastAt).toISOString();
      };
      const pastAt = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
      let messageSeq = 0;
      const message = (memberId, at, text) =>
        normalizeWoztellEvent({
          messageId: "synthetic-fx09-reopen-" + ++messageSeq,
          timestamp: at,
          type: "TEXT",
          data: { text },
          member: memberId,
          channel: "synthetic-fx09-channel",
          app: "synthetic-fx09-app",
        });
      const leadsOf = async (contactId) =>
        query(
          `SELECT id::text,stage::text,intent::text,source::text,assigned_agent_id::text,
             created_at,updated_at FROM crm_leads WHERE contact_id=$1 ORDER BY created_at,id`,
          [contactId],
        );
      const conversationOf = async (conversationId) =>
        (
          await query("SELECT status,last_inbound_at FROM whatsapp_conversations WHERE id=$1", [
            conversationId,
          ])
        )[0];
      const opsJobs = async () => (await query("SELECT count(*)::int AS n FROM ops_jobs"))[0].n;
      const setStage = async (leadId, stage) => {
        const saved = await server.updateAdminLead(
          draftFrom(await read(leadId, manager), { stage }),
          manager,
        );
        assert.equal(saved.ok, true);
        return saved.version;
      };
      const setConversation = async (conversationId, status) => {
        const [current] = await query(
          "SELECT assigned_agent_id::text FROM whatsapp_conversations WHERE id=$1",
          [conversationId],
        );
        const res = await server.updateAdminConversation(
          { id: conversationId, status, assigned_agent_id: current.assigned_agent_id ?? null },
          admin,
        );
        assert.equal(res.ok, true);
        assert.equal((await conversationOf(conversationId)).status, status);
      };
      // Member sends once live, then a manager closes the only lead.
      const closedCustomer = async (memberId, stage = "closed_won", closeConversation = true) => {
        const first = await ingest(message(memberId, pastAt(3600), "第一次查詢"), "live_webhook");
        assert.equal(first.messageInserted, true);
        const [lead] = await leadsOf(first.contactId);
        assert.equal(lead.stage, "new");
        await setStage(lead.id, stage);
        if (closeConversation) await setConversation(first.conversationId, "closed");
        return {
          contactId: first.contactId,
          conversationId: first.conversationId,
          leadId: lead.id,
        };
      };
      const FORWARD = "20261009110000_inbound_lead_reopen.sql";
      const REVERT_PATH = "neon/reverts/20261009110000_inbound_lead_reopen_revert.sql";
      const fileText = (path) =>
        readFileSync(new URL(path, repoRoot), "utf8").replace(/\r\n/g, "\n");
      const applyByHand = async (sql) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      };

      await t.test("closed lead + new inbound → new lead and reopened conversation", async () => {
        const member = "synthetic-fx09-member-reopen-1";
        const c = await closedCustomer(member);
        const closedVersion = (await read(c.leadId, manager)).version;
        const jobs = await opsJobs();

        const t2 = await nextAt();
        const second = await ingest(message(member, t2, "又想睇樓"), "live_webhook");
        assert.equal(second.messageInserted, true);
        assert.equal(second.contactId, c.contactId);
        assert.equal(second.conversationId, c.conversationId);

        const leads = await leadsOf(c.contactId);
        assert.equal(leads.length, 2);
        const old = leads.find((lead) => lead.id === c.leadId);
        assert.equal(old.stage, "closed_won");
        assert.equal((await read(c.leadId, manager)).version, closedVersion);
        const fresh = leads.find((lead) => lead.id !== c.leadId);
        assert.equal(fresh.stage, "new");
        assert.equal(fresh.intent, "unknown");
        assert.equal(fresh.source, "whatsapp");
        assert.equal(fresh.created_at.toISOString(), t2);
        const conversation = await conversationOf(c.conversationId);
        assert.equal(conversation.status, "open");
        assert.equal(conversation.last_inbound_at.toISOString(), t2);
        assert.equal(await opsJobs(), jobs, "no job is queued for the new lead");

        const third = await ingest(message(member, await nextAt(), "仲有問題"), "live_webhook");
        assert.equal(third.messageInserted, true);
        assert.equal((await leadsOf(c.contactId)).length, 2, "an open lead blocks a third");
        assert.equal(await opsJobs(), jobs);
      });

      await t.test("closed_lost behaves the same, and an open lead blocks a new one", async () => {
        const member = "synthetic-fx09-member-reopen-2";
        const c = await closedCustomer(member, "closed_lost");
        await ingest(message(member, await nextAt(), "再問"), "live_webhook");
        let leads = await leadsOf(c.contactId);
        assert.deepEqual(
          leads.map((lead) => lead.stage),
          ["closed_lost", "new"],
        );
        assert.equal((await conversationOf(c.conversationId)).status, "open");

        await setStage(leads[1].id, "contacted");
        await setConversation(c.conversationId, "closed");
        await ingest(message(member, await nextAt(), "跟進"), "live_webhook");
        leads = await leadsOf(c.contactId);
        assert.deepEqual(
          leads.map((lead) => lead.stage),
          ["closed_lost", "contacted"],
        );
        assert.equal((await conversationOf(c.conversationId)).status, "open");
      });

      await t.test(
        "history import and identity merges never create a lead or reopen a conversation for old messages",
        async () => {
          const member = "synthetic-fx09-member-reopen-3";
          const c = await closedCustomer(member);

          const old = await ingest(message(member, pastAt(7200), "舊訊息"), "history_import");
          assert.equal(old.messageInserted, true);
          assert.equal(old.contactId, c.contactId);
          assert.equal((await leadsOf(c.contactId)).length, 1);
          assert.equal((await conversationOf(c.conversationId)).status, "closed");

          // A contact with no lead still gets its first lead from history import.
          // Its message is newer than the close above, then moves to the closed
          // contact through the UPDATE path, which must create and reopen nothing.
          const other = await ingest(
            message("synthetic-fx09-member-reopen-3b", await nextAt(), "另一位"),
            "history_import",
          );
          assert.notEqual(other.contactId, c.contactId);
          const otherLeads = await leadsOf(other.contactId);
          assert.equal(otherLeads.length, 1);
          assert.equal(otherLeads[0].stage, "new");
          const otherStatus = (await conversationOf(other.conversationId)).status;
          await query("UPDATE whatsapp_messages SET contact_id=$1 WHERE external_message_id=$2", [
            c.contactId,
            "synthetic-fx09-reopen-" + messageSeq,
          ]);
          assert.equal((await leadsOf(c.contactId)).length, 1);
          assert.equal((await conversationOf(c.conversationId)).status, "closed");
          assert.equal((await conversationOf(other.conversationId)).status, otherStatus);

          // Test setup: a later inbound is already recorded on the conversation.
          // A history message newer than the close but older than that inbound
          // must not reopen it.
          const between = await nextAt();
          await query("UPDATE whatsapp_conversations SET last_inbound_at=$2 WHERE id=$1", [
            c.conversationId,
            new Date(Date.parse(between) + 60000).toISOString(),
          ]);
          await ingest(message(member, between, "較新但未最新"), "history_import");
          assert.equal((await conversationOf(c.conversationId)).status, "closed");
          // That message is newer than the close, so by the rule it does open a
          // lead. Only messages older than the close never do.
          assert.equal((await leadsOf(c.contactId)).length, 2);
        },
      );

      await t.test("a new lead keeps the contact owner only while active", async () => {
        const member = "synthetic-fx09-member-reopen-4";
        const c = await closedCustomer(member, "closed_won", false);
        await query("UPDATE crm_contacts SET assigned_agent_id=$2 WHERE id=$1", [
          c.contactId,
          AGENT_B,
        ]);
        try {
          await ingest(message(member, await nextAt(), "再搵你"), "live_webhook");
          let leads = await leadsOf(c.contactId);
          assert.equal(leads.length, 2);
          assert.equal(leads[1].assigned_agent_id, AGENT_B);

          await query("UPDATE staff_users SET active=false WHERE id=$1", [AGENT_B]);
          await setStage(leads[1].id, "closed_lost");
          await ingest(message(member, await nextAt(), "第三次"), "live_webhook");
          leads = await leadsOf(c.contactId);
          assert.equal(leads.length, 3);
          assert.equal(leads[2].stage, "new");
          assert.equal(leads[2].assigned_agent_id, null);
        } finally {
          await query("UPDATE staff_users SET active=true WHERE id=$1", [AGENT_B]);
        }
      });

      await t.test("pending conversations are not touched", async () => {
        const member = "synthetic-fx09-member-reopen-5";
        const c = await closedCustomer(member, "closed_won", false);
        await setConversation(c.conversationId, "pending");
        await ingest(message(member, await nextAt(), "等緊"), "live_webhook");
        assert.equal((await leadsOf(c.contactId)).length, 2);
        assert.equal((await conversationOf(c.conversationId)).status, "pending");
      });

      await t.test(
        "concurrent inbound messages after closure create exactly one new lead",
        async () => {
          const member = "synthetic-fx09-member-reopen-6";
          const c = await closedCustomer(member);
          const [a, b] = [await nextAt(), await nextAt()];
          const results = await Promise.all([
            ingest(message(member, a, "同時一"), "live_webhook"),
            ingest(message(member, b, "同時二"), "live_webhook"),
          ]);
          assert.deepEqual(
            results.map((r) => r.messageInserted),
            [true, true],
          );
          const leads = await leadsOf(c.contactId);
          assert.deepEqual(
            leads.map((lead) => lead.stage),
            ["closed_won", "new"],
          );
          assert.equal((await conversationOf(c.conversationId)).status, "open");
        },
      );

      await t.test(
        "migration B is idempotent, contains no job enqueue, and the revert restores the old rule",
        async () => {
          const forward = fileText("neon/migrations/" + FORWARD);
          await applyByHand(forward);
          const [{ def }] = await query(
            "SELECT pg_get_functiondef('ensure_whatsapp_inbound_lead_fn'::regproc) AS def",
          );
          assert.match(def, /closed_won/);
          assert.doesNotMatch(def, /ops_jobs/);
          assert.doesNotMatch(forward, /ops_jobs/);
          assert.doesNotMatch(
            forward,
            /INSERT INTO crm_leads\(contact_id,assigned_agent_id,stage,intent,source,note,created_at,updated_at\)\nSELECT/,
          );
          assert.doesNotMatch(forward, /\b(DROP|CREATE TRIGGER|LOCK TABLE)\b/);
          assert.match(
            forward.split("\n").find((line) => !line.startsWith("--")),
            /^SET LOCAL lock_timeout/,
          );
          assert.ok(MIGRATION_VERSIONS.includes(FORWARD));

          const member = "synthetic-fx09-member-reopen-7";
          const c = await closedCustomer(member);
          try {
            await applyByHand(fileText(REVERT_PATH));
            const [{ def: oldDef }] = await query(
              "SELECT pg_get_functiondef('ensure_whatsapp_inbound_lead_fn'::regproc) AS def",
            );
            assert.doesNotMatch(oldDef, /closed_won/);
            await ingest(message(member, await nextAt(), "舊規則"), "live_webhook");
            assert.equal((await leadsOf(c.contactId)).length, 1, "the old rule adds no lead");
            assert.equal((await conversationOf(c.conversationId)).status, "closed");
          } finally {
            await applyByHand(forward);
          }
          await ingest(message(member, await nextAt(), "新規則"), "live_webhook");
          assert.equal((await leadsOf(c.contactId)).length, 2, "the new rule is back");
          assert.equal((await conversationOf(c.conversationId)).status, "open");
        },
      );

      await t.test("the revert body equals the previous function verbatim", () => {
        const block = (sql) => {
          const start = sql.indexOf("CREATE OR REPLACE FUNCTION ensure_whatsapp_inbound_lead_fn(");
          assert.ok(start >= 0);
          const end = sql.indexOf("$$;", start);
          assert.ok(end > start);
          return sql.slice(start, end + 3);
        };
        const previous = fileText("neon/migrations/20260906100000_whatsapp_inbound_leads.sql");
        const revert = fileText(REVERT_PATH);
        assert.equal(block(revert), block(previous));
        const revertCode = revert.replace(/^--.*$/gm, "");
        assert.doesNotMatch(revertCode, /\b(LOCK TABLE|DROP|CREATE TRIGGER|ops_jobs)\b/);
        assert.equal((revertCode.match(/INSERT INTO crm_leads/g) ?? []).length, 1);
        assert.equal((revertCode.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 1);
        for (const [file, sql] of [
          [FORWARD, fileText("neon/migrations/" + FORWARD)],
          [REVERT_PATH, revert],
        ]) {
          for (const line of sql.split("\n").filter((l) => l.trimStart().startsWith("--")))
            assert.doesNotMatch(line, /[;']/, file + ": " + line);
        }
      });

      await t.test("revert file is ignored by the migration runner and drift check", async () => {
        // The runner applies only `.sql` files directly inside neon/migrations
        // (non-recursive readdirSync), and the drift check reads MIGRATION_VERSIONS.
        const runner = fileText("scripts/neon/apply-migrations.mjs");
        assert.match(runner, /const migrationsDir = "neon\/migrations";/);
        assert.match(runner, /readdirSync\(migrationsDir\)/);
        assert.doesNotMatch(runner, /recursive|neon\/reverts/);
        const drift = fileText("scripts/neon/check-migration-drift.mjs");
        assert.match(drift, /MIGRATION_VERSIONS,\s*pendingMigrations,/);
        assert.doesNotMatch(drift, /readdirSync|neon\/reverts/);

        const revertName = REVERT_PATH.split("/").pop();
        const runnerFiles = readdirSync(new URL("neon/migrations/", repoRoot))
          .filter((file) => file.endsWith(".sql"))
          .sort();
        assert.ok(runnerFiles.includes(FORWARD));
        assert.ok(!runnerFiles.includes(revertName));
        assert.ok(MIGRATION_VERSIONS.includes(FORWARD));
        assert.ok(!MIGRATION_VERSIONS.some((version) => version.includes("revert")));
        assert.deepEqual(pendingMigrations(MIGRATION_VERSIONS), []);

        const applied = (await query("SELECT version FROM app_migrations ORDER BY version")).map(
          (row) => row.version,
        );
        assert.ok(applied.includes(FORWARD));
        assert.ok(!applied.some((version) => version.includes("revert")));
        const report = formatDriftReport(pendingMigrations(applied));
        assert.equal(report.ok, true);
        assert.doesNotMatch(report.message, /revert/);
      });

      await t.test("the migration and revert never mention the alert job type", () => {
        // Built at runtime so this file never carries the literal job type.
        const alertJobType = ["lead", "staff", "alert"].join(".");
        for (const path of ["neon/migrations/" + FORWARD, REVERT_PATH])
          assert.ok(!fileText(path).includes(alertJobType), path);
      });
    });
  } finally {
    network.mock.restore();
  }
});
