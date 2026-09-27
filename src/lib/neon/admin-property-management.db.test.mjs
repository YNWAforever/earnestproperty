import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "./disposable-test-target.mjs";
import { staffReassignStatements } from "./staff-ownership.ts";
const databaseUrl = process.env.ASTRA_TEST_DATABASE_URL;
function splitSql(sql) {
  const out = [];
  let buffer = "",
    quote = false,
    tag = null;
  sql = sql.replace(/^\s*--.*$/gm, "");
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !tag) {
      if (quote && sql[i + 1] === "'") {
        buffer += "''";
        i++;
        continue;
      }
      quote = !quote;
    }
    if (ch === "$" && !quote) {
      const match = sql.slice(i).match(/^\$[\w]*\$/);
      if (match && (!tag || tag === match[0])) {
        tag = tag ? null : match[0];
        buffer += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    if (ch === ";" && !quote && !tag) {
      if (buffer.trim()) out.push(buffer.trim());
      buffer = "";
    } else buffer += ch;
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}
test(
  "atomic management protects scoped offers, imports, history, audit, and concurrent saves",
  { skip: !databaseUrl },
  async () => {
    await assertDisposableNeonTestTarget(databaseUrl);
    const db = neon(databaseUrl);
    const schema = "management_" + randomUUID().replaceAll("-", "");
    const query = async (sql, params = []) =>
      (
        await db.transaction((tx) => [
          tx.query("SELECT set_config('search_path',$1,true)", [schema + ",public,pg_catalog"]),
          tx.query(sql, params),
        ])
      )[1];
    const actor = "10000000-0000-0000-0000-000000000001",
      other = "10000000-0000-0000-0000-000000000002",
      manager = "10000000-0000-0000-0000-000000000003";
    const version = async (no = "P1") =>
      (await query("SELECT admin_property_group_version($1) v", [no]))[0].v;
    const save = (scope, payload, expected, no = "P1", who = manager) =>
      query("SELECT admin_property_manage($1,$2,$3,$4::jsonb,$5::uuid)", [
        no,
        expected,
        scope,
        JSON.stringify(payload),
        who,
      ]);
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await query(
        `CREATE TABLE properties(LIKE public.properties INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
      );
      await query("ALTER TABLE properties ADD PRIMARY KEY(id)");
      await query("CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean NOT NULL)");
      await query("CREATE TABLE staff_roles(staff_user_id uuid,role text)");
      await query(
        "CREATE TABLE audit_logs(actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb)",
      );
      await query("INSERT INTO staff_users VALUES($1,true),($2,true),($3,true)", [
        actor,
        other,
        manager,
      ]);
      await query("INSERT INTO staff_roles VALUES($1,'agent'),($2,'agent'),($3,'manager')", [
        actor,
        other,
        manager,
      ]);
      for (const file of [
        "20260906040000_property_public_identity.sql",
        "20260906090000_canonical_property_identity.sql",
        "20260906120000_admin_property_management.sql",
      ]) {
        await db.transaction((tx) => [
          tx.query("SELECT set_config('search_path',$1,true)", [schema + ",public,pg_catalog"]),
          ...splitSql(readFileSync("neon/migrations/" + file, "utf8")).map((s) => tx.query(s)),
        ]);
      }
      await query(
        `INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,price,rent,status,agent_id,source_updated_at,updated_at)
   VALUES('old-sale','P1','Old','sale','test',500,NULL,'offline',$1,'2026-01-01','2026-01-01'),
   ('sale','P1','Sale','sale','test',700,NULL,'active',$1,'2026-02-01','2026-02-01'),
   ('rent','P1','Rent','rent','test',NULL,18000,'active',$2,'2026-02-01','2026-02-01'),
   ('other','P2','Other','sale','test',800,NULL,'active',$1,'2026-02-01','2026-02-01')`,
        [actor, other],
      );
      let expected = await version();
      await assert.rejects(
        save("shared", { title_zh: "Blocked" }, expected, "P1", actor),
        /FORBIDDEN/,
      );
      await assert.rejects(save("all", { status: "offline" }, expected, "P1", actor), /FORBIDDEN/);
      await assert.rejects(save("sale", { rent: 10 }, expected), /INVALID_PROPERTY_PATCH/);
      await assert.rejects(save("sale", { price: "10" }, expected), /INVALID_PROPERTY_PATCH/);
      await assert.rejects(save("sale", { agentId: other }, expected, "P1", actor), /FORBIDDEN/);
      assert.equal((await query("SELECT count(*)::int n FROM admin_property_overrides"))[0].n, 0);
      await save("rent", { rent: 19000, status: "rented" }, expected, "P1", other);
      assert.deepEqual(
        await query(
          "SELECT listing_no,price::int,rent::int,status::text FROM properties WHERE listing_no IN ('sale','rent','old-sale') ORDER BY listing_no",
        ),
        [
          { listing_no: "old-sale", price: 500, rent: null, status: "offline" },
          { listing_no: "rent", price: null, rent: 19000, status: "rented" },
          { listing_no: "sale", price: 700, rent: null, status: "active" },
        ],
      );
      await assert.rejects(save("sale", { price: 999 }, expected), /ADMIN_PROPERTY_CONFLICT/);
      expected = await version();
      await save("shared", { address: "Managed address" }, expected);
      assert.equal(
        (await query("SELECT address FROM properties WHERE listing_no='old-sale'"))[0].address,
        null,
      );
      await query(
        "UPDATE properties SET rent=100,status='active',address='Imported' WHERE listing_no='rent'",
      );
      assert.deepEqual(
        (
          await query(
            "SELECT rent::int,status::text,address FROM properties WHERE listing_no='rent'",
          )
        )[0],
        { rent: 19000, status: "rented", address: "Managed address" },
      );
      assert.equal(
        (
          await query(
            "SELECT count(*)::int n FROM admin_property_source_snapshots WHERE operation='UPDATE' AND payload->>'rent'='100'",
          )
        )[0].n,
        1,
      );
      await query(
        `INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,rent,status,agent_id,source_updated_at) VALUES('new-rent','P1','New','rent','test',5,'active',$1,'2026-03-01')`,
        [other],
      );
      assert.deepEqual(
        (
          await query(
            "SELECT rent::int,status::text,address FROM properties WHERE listing_no='new-rent'",
          )
        )[0],
        { rent: 19000, status: "rented", address: "Managed address" },
      );
      await query(
        "UPDATE properties SET price=850,title_zh='Source change' WHERE listing_no='other'",
      );
      assert.equal(
        (await query("SELECT price::int FROM properties WHERE listing_no='other'"))[0].price,
        850,
      );
      assert.equal(
        (
          await query(
            "SELECT count(*)::int n FROM admin_property_source_snapshots WHERE property_no='P2'",
          )
        )[0].n,
        0,
      );
      expected = await version();
      const races = await Promise.allSettled([
        save("sale", { price: 710 }, expected),
        save("sale", { price: 720 }, expected),
      ]);
      assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(
        races.find((r) => r.status === "rejected").reason.message,
        /ADMIN_PROPERTY_CONFLICT/,
      );
      const auditBefore = (await query("SELECT count(*)::int n FROM audit_logs"))[0].n;
      await query(
        "ALTER TABLE audit_logs ADD CONSTRAINT reject_write CHECK(action <> 'property.manage') NOT VALID",
      );
      expected = await version();
      await assert.rejects(save("sale", { price: 999 }, expected), /reject_write/);
      assert.equal(
        await version(),
        expected,
        "audit failure rolls back property timestamp and value",
      );
      assert.equal((await query("SELECT count(*)::int n FROM audit_logs"))[0].n, auditBefore);
      await query("ALTER TABLE audit_logs DROP CONSTRAINT reject_write");
      await save("rent", { rent: 12000, status: "active" }, await version("P2"), "P2", actor);
      assert.equal(
        (
          await query(
            "SELECT count(*)::int n FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no='P2' AND p.deal_type='rent'",
          )
        )[0].n,
        1,
      );
      await save("rent", { description: "Rental terms" }, await version());
      await save("shared", { description: "Shared page copy" }, await version());
      assert.equal(
        (await query("SELECT description FROM properties WHERE listing_no='new-rent'"))[0]
          .description,
        "Rental terms",
      );
      assert.equal(
        (
          await query(
            "SELECT shared->>'description' AS description FROM admin_property_overrides WHERE property_no='P1'",
          )
        )[0].description,
        "Shared page copy",
      );
      await query("UPDATE properties SET description='Imported terms' WHERE listing_no='new-rent'");
      assert.equal(
        (await query("SELECT description FROM properties WHERE listing_no='new-rent'"))[0]
          .description,
        "Rental terms",
      );
      await query(
        `INSERT INTO properties(listing_no,title_zh,deal_type,district_slug,agent_id) VALUES('manual-property','Manual','sale','test',$1)`,
        [actor],
      );
      await save(
        "rent",
        { rent: 10000, status: "active" },
        await version("manual-property"),
        "manual-property",
        actor,
      );
      await save(
        "shared",
        { floor: "High" },
        await version("manual-property"),
        "manual-property",
        actor,
      );
      const manualGroup = await query(
        `SELECT p.deal_type::text,p.floor,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE p.listing_no='manual-property' OR p.listing_no IN (SELECT payload->>'listing_no' FROM admin_property_source_snapshots WHERE property_no='manual-property') ORDER BY p.deal_type`,
      );
      assert.equal(manualGroup.length, 2);
      assert.ok(
        manualGroup.every(
          (row) => row.public_listing_no === "manual-property" && row.floor === "High",
        ),
        "shared identity revalidation must retain both manually created deals",
      );
      await query(
        `UPDATE properties SET floor='Low',rent=1 WHERE id IN (SELECT property_id FROM property_public_members WHERE public_listing_no='manual-property')`,
      );
      const protectedManual = await query(
        `SELECT p.deal_type::text,p.floor,p.rent::int,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no='manual-property' ORDER BY p.deal_type`,
      );
      assert.equal(protectedManual.length, 2);
      assert.ok(protectedManual.every((row) => row.floor === "High"));
      assert.equal(protectedManual.find((row) => row.deal_type === "rent").rent, 10000);
      await save("sale", { agentId: actor }, await version());
      const handover = staffReassignStatements(actor, other).find((row) =>
        row.statement.includes("UPDATE properties"),
      );
      await query(handover.statement, handover.params);
      assert.equal(
        (await query("SELECT agent_id FROM properties WHERE listing_no='sale'"))[0].agent_id,
        other,
        "staff handover must supersede manual agent override",
      );
      assert.equal(
        (
          await query(
            "SELECT sale->>'agent_id' AS agent_id FROM admin_property_overrides WHERE property_no='P1'",
          )
        )[0].agent_id,
        other,
      );
      await query("UPDATE properties SET agent_id=$1 WHERE listing_no='sale'", [actor]);
      assert.equal(
        (await query("SELECT agent_id FROM properties WHERE listing_no='sale'"))[0].agent_id,
        other,
        "later source imports cannot restore departed agent",
      );
      await save("all", { status: "offline" }, await version());
      assert.equal(
        (await query("SELECT status::text FROM properties WHERE listing_no='sale'"))[0].status,
        "offline",
      );
      assert.equal(
        (await query("SELECT status::text FROM properties WHERE listing_no='new-rent'"))[0].status,
        "offline",
      );
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  },
);
