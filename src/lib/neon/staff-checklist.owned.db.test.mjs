import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

const ACTION = "first_login_checklist.confirmed";

test(
  "the first-login checklist is remembered per account in audit_logs",
  { timeout: 120000 },
  async (t) => {
    await withOwnedPostgres(async ({ query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const { fetchFirstLoginChecklistDoneForStaff, confirmFirstLoginChecklistForStaff } =
        await import("./staff-checklist.server.ts");
      const staff = {};
      for (const role of ["agent", "viewer"]) {
        const [s] = await query(
          "INSERT INTO staff_users(auth_user_id,email) VALUES($1,$2) RETURNING id",
          ["checklist-" + role, "checklist-" + role + "@example.invalid"],
        );
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [s.id, role]);
        staff[role] = { staffId: s.id, authUserId: "checklist-" + role, roles: [role] };
      }
      const rows = (id) =>
        query("SELECT * FROM audit_logs WHERE action = $1 AND actor_id = $2", [ACTION, id]);

      await t.test("confirming twice writes one row and only for the caller", async () => {
        assert.equal(await fetchFirstLoginChecklistDoneForStaff(staff.agent), false);
        assert.deepEqual(await confirmFirstLoginChecklistForStaff(staff.agent), { ok: true });
        assert.deepEqual(await confirmFirstLoginChecklistForStaff(staff.agent), { ok: true });
        const own = await rows(staff.agent.staffId);
        assert.equal(own.length, 1);
        assert.equal(own[0].subject_type, "staff_user");
        assert.equal(own[0].subject_id, staff.agent.staffId);
        const all = await query("SELECT count(*)::int n FROM audit_logs WHERE action = $1", [
          ACTION,
        ]);
        assert.equal(all[0].n, 1);
        assert.equal(await fetchFirstLoginChecklistDoneForStaff(staff.agent), true);
      });

      await t.test("another account still sees the checklist", async () => {
        assert.equal(await fetchFirstLoginChecklistDoneForStaff(staff.viewer), false);
      });

      await t.test("a viewer can confirm", async () => {
        assert.deepEqual(await confirmFirstLoginChecklistForStaff(staff.viewer), { ok: true });
        assert.equal((await rows(staff.viewer.staffId)).length, 1);
        assert.equal(await fetchFirstLoginChecklistDoneForStaff(staff.viewer), true);
        assert.equal((await rows(staff.agent.staffId)).length, 1);
      });
    });
  },
);
