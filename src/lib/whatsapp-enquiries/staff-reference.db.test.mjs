import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import {
  saveStaffReference,
  retireStaffReference,
  listStaffReferences,
} from "../neon/staff-reference-admin.server.ts";
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
test("Staff reference actual migration and immutable intake", { skip: !url }, async (t) => {
  assert.equal(process.env.ASTRA_TEST_BRANCH_ID, "br-quiet-hat-aoxbj2ue");
  const db = neon(url),
    schema = "staff_ref_" + randomUUID().replaceAll("-", "");
  const transaction = async (statements) =>
    (
      await db.transaction((q) => [
        q.query("SELECT set_config('search_path',$1,true)", [schema]),
        ...statements.map((s) => q.query(s.statement, s.params ?? [])),
      ])
    ).slice(1);
  const query = async (statement, params = []) => (await transaction([{ statement, params }]))[0];
  const ports = { query, transaction };
  const A = randomUUID(),
    B = randomUUID(),
    M = randomUUID(),
    actor = { staffId: M, roles: ["manager"] };
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const statement of [
      "CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean DEFAULT true,name_zh text,name_en text)",
      "CREATE TABLE staff_roles(staff_user_id uuid,role text)",
      "CREATE TABLE audit_logs(id uuid DEFAULT gen_random_uuid(),actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb)",
      "CREATE TABLE inquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text,requested_staff_id uuid,link_open_id uuid,webhook_received_at timestamptz,association_review boolean DEFAULT false)",
      "CREATE TABLE whatsapp_link_opens(id uuid PRIMARY KEY,context_snapshot jsonb)",
      "CREATE TABLE whatsapp_tracking_link_versions(id uuid PRIMARY KEY)",
      "CREATE FUNCTION wa_immutable_attribution() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$",
    ]) {
      await query(statement);
    }
    await query("INSERT INTO staff_users(id) VALUES($1),($2),($3)", [A, B, M]);
    await query("INSERT INTO staff_roles VALUES($1,'agent'),($2,'agent'),($3,'manager')", [
      A,
      B,
      M,
    ]);
    await query("INSERT INTO inquiries(source) VALUES('legacy')");
    const migration = readFileSync(
      "neon/migrations/20260912160000_staff_reference_snapshots.sql",
      "utf8",
    );
    const migrate = () =>
      transaction(splitSqlStatements(migration).map((statement) => ({ statement })));
    await migrate();
    await migrate();
    const first = await saveStaffReference(
      {
        namespace: "source/account1",
        externalReference: "001-A",
        staffId: A,
        verificationRef: "SYNTHETIC",
      },
      actor,
      ports,
    );
    await t.test("NT-02 exact namespace and overlapping active aliases", async () => {
      await saveStaffReference(
        {
          namespace: "source/account2",
          externalReference: "001-A",
          staffId: B,
          verificationRef: "SYNTHETIC",
        },
        actor,
        ports,
      );
      await assert.rejects(
        saveStaffReference(
          {
            namespace: "source/account1",
            externalReference: "001-A",
            staffId: B,
            verificationRef: "SYNTHETIC",
          },
          actor,
          ports,
        ),
        /OVERLAP/,
      );
      assert.equal((await listStaffReferences(actor, query)).length, 2);
    });
    await t.test(
      "NT-01/03 actual intake retains A request and B offering; conflict is review",
      async () => {
        const open = randomUUID();
        await query("INSERT INTO whatsapp_link_opens VALUES($1,$2::jsonb)", [
          open,
          JSON.stringify({
            propertyResponsibleStaffIdAtIntake: B,
            referenceNamespace: "source/account1",
            incomingStaffReference: "001-A",
          }),
        ]);
        const [i] = await query(
          "INSERT INTO inquiries(source,requested_staff_id,link_open_id,webhook_received_at) VALUES('whatsapp',$1,$2,clock_timestamp()) RETURNING *",
          [A, open],
        );
        assert.equal(i.requested_staff_id, A);
        assert.equal(i.property_responsible_staff_id_at_intake, B);
        assert.equal(i.reference_mapping_id, first.id);
        assert.equal(i.association_review, false);
        await assert.rejects(
          query("UPDATE inquiries SET requested_staff_id=$2 WHERE id=$1", [i.id, B]),
          /IMMUTABLE/,
        );
        const [conflict] = await query(
          "INSERT INTO inquiries(source,requested_staff_id,link_open_id,webhook_received_at) VALUES('whatsapp',$1,$2,clock_timestamp()) RETURNING *",
          [B, open],
        );
        assert.equal(conflict.reference_resolution, "reference_conflict");
        assert.equal(conflict.association_review, true);
      },
    );
    await t.test("NT-22 retirement/recycling keeps historical identity", async () => {
      await retireStaffReference({ id: first.id }, actor, query);
      const newer = await saveStaffReference(
        {
          namespace: "source/account1",
          externalReference: "001-A",
          staffId: B,
          verificationRef: "SYNTHETIC_NEW",
        },
        actor,
        ports,
      );
      const [old] = await query("SELECT * FROM staff_external_references WHERE id=$1", [first.id]);
      const [next] = await query("SELECT * FROM staff_external_references WHERE id=$1", [newer.id]);
      assert.equal(old.staff_id, A);
      assert.equal(next.mapping_version, 2);
      assert.equal(next.staff_id, B);
      const pinnedOpen = randomUUID();
      await query("INSERT INTO whatsapp_link_opens VALUES($1,$2::jsonb)", [
        pinnedOpen,
        JSON.stringify({
          referenceNamespace: "source/account1",
          incomingStaffReference: "001-A",
          referenceMappingId: first.id,
          referenceMappingVersion: 1,
          requestedStaffId: A,
        }),
      ]);
      const [replayed] = await query(
        "INSERT INTO inquiries(source,requested_staff_id,link_open_id,webhook_received_at) VALUES('whatsapp',$1,$2,clock_timestamp()) RETURNING *",
        [A, pinnedOpen],
      );
      assert.equal(replayed.requested_staff_id, A);
      assert.equal(
        replayed.association_review,
        true,
        "expired pinned alias must be reviewed, never recycled into B",
      );
      await assert.rejects(
        query("DELETE FROM staff_external_references WHERE id=$1", [first.id]),
        /immutable/,
      );
    });
    await t.test("NT-18 mapping edit denies agent and inactive manager", async () => {
      await assert.rejects(
        listStaffReferences({ staffId: A, roles: ["agent"] }, query),
        (e) => e.status === 403,
      );
      await query("UPDATE staff_users SET active=false WHERE id=$1", [M]);
      await assert.rejects(listStaffReferences(actor, query), (e) => e.status === 403);
    });
    assert.equal(
      (await query("SELECT count(*)::int n FROM inquiries WHERE source='legacy'"))[0].n,
      1,
    );
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
