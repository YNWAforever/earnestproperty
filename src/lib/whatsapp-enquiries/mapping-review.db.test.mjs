import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = new URL(
  "../../../neon/migrations/20260927110000_staff_mapping_review_versions.sql",
  import.meta.url,
);
const actorId = "10000000-0000-4000-8000-000000000001";
const staffId = "10000000-0000-4000-8000-000000000002";
const otherStaffId = "10000000-0000-4000-8000-000000000003";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE staff_users(id uuid PRIMARY KEY, active boolean NOT NULL);
    CREATE TABLE staff_roles(staff_user_id uuid NOT NULL, role text NOT NULL);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, action text, subject_type text,
      subject_id uuid, metadata jsonb);
    CREATE TABLE whatsapp_staff_channels (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid NOT NULL REFERENCES staff_users(id),
      channel_id text NOT NULL, inbox_user_id text NOT NULL,
      folder_id text NOT NULL, routing_node_id text NOT NULL,
      branch_id text, eligible boolean NOT NULL DEFAULT false,
      verification_ref text, verified_at timestamptz,
      verified_by uuid REFERENCES staff_users(id), retired_at timestamptz,
      UNIQUE(channel_id,inbox_user_id), UNIQUE(channel_id,staff_id)
    );
  `);
  await db.query("INSERT INTO staff_users(id,active) VALUES ($1,true),($2,true)", [
    actorId,
    staffId,
  ]);
  await db.query("INSERT INTO staff_users(id,active) VALUES ($1,true)", [otherStaffId]);
  await db.query("INSERT INTO staff_roles(staff_user_id,role) VALUES ($1,'admin')", [actorId]);
  return db;
}

test("migration retains legacy manual evidence without elevating it", async () => {
  assert.ok(existsSync(migrationPath), "staff mapping review migration is missing");
  const db = await fixture();
  try {
    await db.query(
      `INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,
        routing_node_id,eligible,verification_ref,verified_at,verified_by)
       VALUES ($1,'fixture-channel','inbox-1','folder-1','',true,'manual-ticket',now(),$2)`,
      [staffId, actorId],
    );
    await db.exec(readFileSync(migrationPath, "utf8"));
    const { rows } = await db.query(
      "SELECT version,review_basis,review_enforced,review_evidence_id FROM whatsapp_staff_channels",
    );
    assert.deepEqual(rows[0], {
      version: 1,
      review_basis: "legacy_manual",
      review_enforced: false,
      review_evidence_id: null,
    });
  } finally {
    await db.close();
  }
});

test("two updates from mapping version 1 cannot both succeed", async () => {
  assert.ok(existsSync(migrationPath), "staff mapping review migration is missing");
  const db = await fixture();
  const oldChannel = process.env.EP_WA_COMPANY_CHANNEL_ID;
  process.env.EP_WA_COMPANY_CHANNEL_ID = "fixture-channel";
  try {
    await db.exec(readFileSync(migrationPath, "utf8"));
    const { saveStaffChannel } = await import("./assignment.server.ts");
    const ports = {
      query: async (sql, params = []) => (await db.query(sql, params)).rows,
      transaction: async () => {
        throw new Error("unexpected transaction");
      },
    };
    const actor = { staffId: actorId, roles: ["admin"] };
    const input = (expectedVersion, inboxUserId) => ({
      staffId,
      inboxUserId,
      folderId: "folder-1",
      routingNodeId: "",
      branchId: null,
      verificationRef: "manual-ticket",
      eligible: false,
      expectedVersion,
    });
    const created = await saveStaffChannel(input(null, "inbox-1"), actor, ports);
    assert.equal(created.version, 1);
    const attempts = await Promise.allSettled([
      saveStaffChannel(input(1, "inbox-2"), actor, ports),
      saveStaffChannel(input(1, "inbox-3"), actor, ports),
    ]);
    const successes = attempts.filter((result) => result.status === "fulfilled");
    const conflicts = attempts.filter((result) => result.status === "rejected");
    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].reason.status, 409);
    const { rows } = await db.query(
      "SELECT version,inbox_user_id,review_basis FROM whatsapp_staff_channels",
    );
    assert.equal(rows[0].version, 2);
    assert.equal(rows[0].review_basis, "legacy_manual");
    assert.ok(["inbox-2", "inbox-3"].includes(rows[0].inbox_user_id));
  } finally {
    if (oldChannel === undefined) delete process.env.EP_WA_COMPANY_CHANNEL_ID;
    else process.env.EP_WA_COMPANY_CHANNEL_ID = oldChannel;
    await db.close();
  }
});

test("reviewed save consumes scoped evidence and retirement defeats stale saves", async () => {
  const db = await fixture();
  const previous = {
    channel: process.env.EP_WA_COMPANY_CHANNEL_ID,
    scope: process.env.EP_WA_INBOX_INTEGRATION_ID,
  };
  process.env.EP_WA_COMPANY_CHANNEL_ID = "fixture-channel";
  process.env.EP_WA_INBOX_INTEGRATION_ID = "fixture-integration";
  try {
    await db.exec(readFileSync(migrationPath, "utf8"));
    const { saveReviewedStaffChannel, retireStaffChannel } =
      await import("../neon/staff-mapping-review.server.ts");
    const ports = { query: async (sql, params = []) => (await db.query(sql, params)).rows };
    const actor = { staffId: actorId, roles: ["admin"] };
    async function evidence(overrides = {}) {
      const data = {
        staffId,
        channelId: "fixture-channel",
        providerScope: "fixture-integration",
        inboxUserId: "inbox-1",
        folderId: "folder-1",
        actorId,
        mappingVersion: null,
        basis: "provider_verified",
        result: "verified",
        checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        ...overrides,
      };
      const { rows } = await db.query(
        "INSERT INTO whatsapp_staff_mapping_reviews(staff_id,channel_id,provider_scope," +
          "inbox_user_id,folder_id,basis,result,checked_at,expires_at,actor_id,mapping_version)" +
          " VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10,$11) RETURNING id",
        [
          data.staffId,
          data.channelId,
          data.providerScope,
          data.inboxUserId,
          data.folderId,
          data.basis,
          data.result,
          data.checkedAt,
          data.expiresAt,
          data.actorId,
          data.mappingVersion,
        ],
      );
      return rows[0].id;
    }
    for (const mismatch of [
      { staffId: otherStaffId },
      { channelId: "other-channel" },
      { actorId: otherStaffId },
      { providerScope: "other-integration" },
      { basis: "manual_review" },
      { result: "unknown" },
      { checkedAt: "2025-12-31T00:00:00.000Z", expiresAt: "2026-01-01T00:00:00.000Z" },
    ]) {
      const evidenceId = await evidence(mismatch);
      await assert.rejects(
        saveReviewedStaffChannel(
          { staffId, expectedVersion: null, evidenceId, eligible: true },
          actor,
          ports,
        ),
        (error) => error.status === 409,
      );
    }
    const evidenceId = await evidence();
    const saved = await saveReviewedStaffChannel(
      { staffId, expectedVersion: null, evidenceId, eligible: true },
      actor,
      ports,
    );
    assert.equal(saved.version, 1);
    const { rows: created } = await db.query(
      "SELECT version,review_basis,review_enforced,review_evidence_id,eligible FROM whatsapp_staff_channels",
    );
    assert.equal(created[0].review_basis, "provider_verified");
    assert.equal(created[0].review_enforced, true);
    assert.equal(created[0].review_evidence_id, evidenceId);
    assert.equal(created[0].eligible, true);
    await assert.rejects(
      db.query("UPDATE whatsapp_staff_mapping_reviews SET result='denied' WHERE id=$1", [
        evidenceId,
      ]),
      /MAPPING_REVIEW_APPEND_ONLY/,
    );
    const duplicateIdentityEvidence = await evidence({ staffId: otherStaffId });
    await assert.rejects(
      saveReviewedStaffChannel(
        {
          staffId: otherStaffId,
          expectedVersion: null,
          evidenceId: duplicateIdentityEvidence,
          eligible: true,
        },
        actor,
        ports,
      ),
      (error) => error.status === 409,
    );
    const wrongVersionEvidence = await evidence({ mappingVersion: 99 });
    await assert.rejects(
      saveReviewedStaffChannel(
        { staffId, expectedVersion: 1, evidenceId: wrongVersionEvidence, eligible: true },
        actor,
        ports,
      ),
      (error) => error.status === 409,
    );
    const nextEvidence = await evidence({ mappingVersion: 1 });
    const updated = await saveReviewedStaffChannel(
      { staffId, expectedVersion: 1, evidenceId: nextEvidence, eligible: true },
      actor,
      ports,
    );
    assert.equal(updated.version, 2);

    const { saveStaffChannel } = await import("./assignment.server.ts");
    await assert.rejects(
      saveStaffChannel(
        {
          staffId,
          inboxUserId: "inbox-2",
          folderId: "folder-1",
          routingNodeId: "",
          branchId: null,
          verificationRef: "manual",
          eligible: true,
          expectedVersion: 2,
        },
        actor,
        { ...ports, transaction: async () => [] },
      ),
      (error) => error.status === 409,
    );
    const retired = await retireStaffChannel(
      { mappingId: saved.mappingId, expectedVersion: 2, reason: "staff offboarded" },
      actor,
      ports,
    );
    assert.equal(retired.version, 3);
    const { rows: after } = await db.query(
      "SELECT eligible,retired_at,version FROM whatsapp_staff_channels WHERE id=$1",
      [saved.mappingId],
    );
    assert.equal(after[0].eligible, false);
    assert.ok(after[0].retired_at);
    await assert.rejects(
      saveReviewedStaffChannel(
        { staffId, expectedVersion: 1, evidenceId, eligible: true },
        actor,
        ports,
      ),
      (error) => error.status === 409,
    );
    const { rows: audits } = await db.query("SELECT action FROM audit_logs ORDER BY action");
    assert.deepEqual(
      audits.map((row) => row.action),
      ["whatsapp.mapping.retire", "whatsapp.mapping.review", "whatsapp.mapping.review"],
    );
  } finally {
    for (const [key, value] of [
      ["EP_WA_COMPANY_CHANNEL_ID", previous.channel],
      ["EP_WA_INBOX_INTEGRATION_ID", previous.scope],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.close();
  }
});
