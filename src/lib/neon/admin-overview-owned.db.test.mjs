import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test(
  "overview counts match the same scoped open lists and cannot expose another agent counts",
  { timeout: 120000 },
  async (t) => {
    await withOwnedPostgres(async ({ query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const { getAdminOverview } = await import("./admin-data.server.ts");
      const { readAdminPage } = await import("./admin-pagination.server.ts");
      const staff = [];
      for (const role of ["agent", "agent", "manager"]) {
        const [s] = await query(
          "INSERT INTO staff_users(auth_user_id,email) VALUES($1,$2) RETURNING id",
          ["overview-" + staff.length, "overview-" + staff.length + "@example.invalid"],
        );
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [s.id, role]);
        staff.push({ staffId: s.id, authUserId: "overview-" + staff.length, roles: [role] });
      }
      for (const [actorIndex, stage] of [
        [0, "new"],
        [0, "closed_won"],
        [1, "new"],
        [1, "contacted"],
      ]) {
        const [contact] = await query(
          "INSERT INTO crm_contacts(name) VALUES('Synthetic overview contact') RETURNING id",
        );
        await query("INSERT INTO crm_leads(contact_id,assigned_agent_id,stage) VALUES($1,$2,$3)", [
          contact.id,
          staff[actorIndex].staffId,
          stage,
        ]);
        await query(
          "INSERT INTO whatsapp_conversations(contact_id,assigned_agent_id,status) VALUES($1,$2,$3)",
          [contact.id, staff[actorIndex].staffId, stage === "closed_won" ? "closed" : "open"],
        );
      }
      await t.test("agent sees one open lead and conversation, not all-company three", async () => {
        const result = await getAdminOverview(staff[0]);
        assert.equal(result.openLeads, 1);
        assert.equal(result.openConversations, 1);
        assert.equal(result.scope, "own");
        assert.ok(Date.parse(result.checkedAt));
      });
      for (const actor of [staff[0], staff[2]])
        await t.test(actor.roles[0] + " card/list/independent SQL equality", async () => {
          const overview = await getAdminOverview(actor);
          const leads = await readAdminPage({ resource: "leads", stage: "open", limit: 10 }, actor);
          const conversations = await readAdminPage(
            { resource: "conversations", status: "open", limit: 10 },
            actor,
          );
          const [{ n }] = await query(
            "SELECT count(*)::int n FROM crm_leads WHERE stage NOT IN('closed_won','closed_lost') AND ($1::uuid IS NULL OR assigned_agent_id=$1::uuid)",
            [actor.roles.includes("manager") ? null : actor.staffId],
          );
          assert.equal(overview.openLeads, n);
          assert.equal(leads.total, n);
          assert.equal(overview.openConversations, conversations.total);
        });
    });
  },
);
