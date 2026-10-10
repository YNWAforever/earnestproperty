import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { readAssignmentContext, readEnquiryQueue } from "./assignment.server.ts";

const admin = "00000000-0000-4000-8000-000000000001";
const manager = "00000000-0000-4000-8000-000000000002";
const agent = "00000000-0000-4000-8000-000000000003";
const outsider = "00000000-0000-4000-8000-000000000004";
const inactive = "00000000-0000-4000-8000-000000000005";
const noRole = "00000000-0000-4000-8000-000000000006";
const viewer = "00000000-0000-4000-8000-000000000007";
const branch = "20000000-0000-4000-8000-000000000001";
const otherBranch = "20000000-0000-4000-8000-000000000002";
const conversation = "10000000-0000-4000-8000-000000000001";
const otherConversation = "10000000-0000-4000-8000-000000000002";

test("assignment context authorizes real staff_role enum and assigned conversation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE staff_role AS ENUM ('admin', 'manager', 'agent', 'viewer');
      CREATE TABLE staff_users(id uuid PRIMARY KEY, active boolean NOT NULL, name_zh text, name_en text, branch_id uuid);
      CREATE TABLE staff_roles(staff_user_id uuid NOT NULL, role staff_role NOT NULL);
      CREATE TABLE whatsapp_conversations(
        id uuid PRIMARY KEY, assignment_version integer NOT NULL DEFAULT 0,
        assignment_lock boolean NOT NULL DEFAULT false, confirmed_staff_id uuid,
        assigned_agent_id uuid, pending_assignment_id uuid, channel_id text
      );
      CREATE TABLE whatsapp_assignment_requests(
        id uuid PRIMARY KEY, desired_staff_id uuid, state text, evidence jsonb
      );
      CREATE TABLE inquiries(
        id uuid PRIMARY KEY, conversation_id uuid, source text, status text,
        public_listing_no text, placement_source text, requested_staff_id uuid,
        property_id uuid, first_human_response_at timestamptz,
        response_due_at timestamptz, association_review boolean,
        created_at timestamptz, enquiry_owner_staff_id uuid, attribution_method text, link_open_id uuid,
        service_state text
      );
      CREATE TABLE properties(id uuid PRIMARY KEY, agent_id uuid, deal_type text);
      CREATE TABLE whatsapp_staff_channels(
        channel_id text, staff_id uuid, eligible boolean, retired_at timestamptz
      );
    `);
    const aclMigration = await readFile(
      new URL(
        "../../../neon/migrations/20260929104000_whatsapp_enquiry_access.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const functionName of ["wa_can_read_enquiry", "wa_can_read_conversation"]) {
      const start = aclMigration.indexOf(`CREATE OR REPLACE FUNCTION ${functionName}(`);
      assert.ok(start >= 0, `missing ${functionName} migration function`);
      const end = aclMigration.indexOf("$$;", start);
      assert.ok(end > start, `incomplete ${functionName} migration function`);
      await db.exec(aclMigration.slice(start, end + 3));
    }
    // FX-06: the current wa_can_read_conversation lets managers read org-wide.
    await db.exec(
      await readFile(
        new URL(
          "../../../neon/migrations/20261007100000_wa_access_unassigned.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const [id, active, role] of [
      [admin, true, "admin"],
      [manager, true, "manager"],
      [agent, true, "agent"],
      [outsider, true, "agent"],
      [inactive, false, "agent"],
      [noRole, true, null],
      [viewer, true, "viewer"],
    ]) {
      await db.query("INSERT INTO staff_users(id, active, branch_id) VALUES($1,$2,$3)", [
        id,
        active,
        id === outsider ? otherBranch : branch,
      ]);
      if (role) await db.query("INSERT INTO staff_roles VALUES($1,$2::staff_role)", [id, role]);
    }
    await db.query(
      "INSERT INTO whatsapp_conversations(id,assigned_agent_id,channel_id) VALUES($1,$2,'fixture'),($3,$4,'fixture')",
      [conversation, agent, otherConversation, outsider],
    );
    const query = async (sql, params = []) =>
      (
        await db.query(
          sql,
          params.map((value) => (Array.isArray(value) ? "{" + value.join(",") + "}" : value)),
        )
      ).rows;
    const ports = {
      query,
      transaction: async () => {
        throw new Error("read must not mutate");
      },
    };
    await assert.rejects(
      query(
        "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role=ANY($2::text[]) LIMIT 1",
        [admin, ["admin", "manager"]],
      ),
      /operator does not exist: staff_role = text/,
      "the audit SQL must fail against the real enum definition",
    );
    for (const [id, role] of [
      [admin, "admin"],
      [manager, "manager"],
      [agent, "agent"],
    ]) {
      const context = await readAssignmentContext(
        conversation,
        { staffId: id, roles: [role] },
        ports,
      );
      assert.equal(context.assignment_version, 0);
      // FX-17a G-11: staff ids are admin-only diagnostics.
      if (role === "admin") assert.equal(context.diagnostics.assignedAgentId, agent);
      else assert.equal(context.diagnostics, null);
    }
    const otherBranchContext = await readAssignmentContext(
      otherConversation,
      { staffId: manager, roles: ["manager"] },
      ports,
    );
    // A manager can read a conversation assigned to another branch (FX-06, org-wide).
    assert.equal(otherBranchContext.assignment_version, 0);
    assert.equal(otherBranchContext.diagnostics, null);
    const otherBranchAdmin = await readAssignmentContext(
      otherConversation,
      { staffId: admin, roles: ["admin"] },
      ports,
    );
    assert.equal(otherBranchAdmin.diagnostics.assignedAgentId, outsider);
    await assert.rejects(
      readAssignmentContext(
        "10000000-0000-4000-8000-000000000099",
        { staffId: admin, roles: ["admin"] },
        ports,
      ),
      (error) => error instanceof Response && error.status === 404,
    );
    await assert.rejects(
      readAssignmentContext(
        "10000000-0000-4000-8000-000000000099",
        { staffId: agent, roles: ["agent"] },
        ports,
      ),
      (error) => error instanceof Response && error.status === 403,
    );
    for (const [id, roles] of [
      [outsider, ["agent"]],
      [inactive, ["agent"]],
      [noRole, ["agent"]],
      [viewer, ["viewer"]],
    ]) {
      await assert.rejects(
        readAssignmentContext(conversation, { staffId: id, roles }, ports),
        (error) => error instanceof Response && error.status === 403,
      );
    }
    // FX-17a fix round 1 (M-1): the Command Center queue says whether an owner is confirmed,
    // never who. No admin screen reads the id, so no role receives it.
    await db.query("UPDATE whatsapp_conversations SET confirmed_staff_id=$1 WHERE id=$2", [
      agent,
      conversation,
    ]);
    await db.query(
      "INSERT INTO inquiries(id,conversation_id,source,status,association_review,created_at,service_state,requested_staff_id,enquiry_owner_staff_id) VALUES($1,$2,'whatsapp','new',false,now(),'active',$3,$3)",
      ["30000000-0000-4000-8000-000000000001", conversation, agent],
    );
    for (const [id, role] of [
      [manager, "manager"],
      [admin, "admin"],
    ]) {
      const queue = await readEnquiryQueue({ staffId: id, roles: [role] }, ports);
      assert.equal(queue.length, 1, role);
      assert.equal(queue[0].confirmed, true, role);
      const payload = JSON.stringify(queue);
      for (const staff of [admin, manager, agent, outsider])
        assert.ok(!payload.includes(staff), `${role} queue carries staff id ${staff}`);
      assert.ok(!payload.includes("confirmed_staff_id"), role);
    }
    await assert.rejects(
      readEnquiryQueue({ staffId: agent, roles: ["agent"] }, ports),
      (error) => error instanceof Response && error.status === 403,
    );
  } finally {
    await db.close();
  }
});
