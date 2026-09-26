import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { neon } from "@neondatabase/serverless";

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

const databaseUrl = process.env.ASTRA_TEST_DATABASE_URL;
test(
  "disposable PostgreSQL keeps offerings, groups every canonical number despite conflicting source facts",
  { skip: !databaseUrl },
  async () => {
    assert.equal(
      process.env.ASTRA_TEST_BRANCH_ID,
      "br-quiet-hat-aoxbj2ue",
      "Approved disposable Neon branch required",
    );
    const db = neon(databaseUrl);
    const schema = `identity_${randomUUID().replaceAll("-", "")}`;
    const migration = readFileSync(
      "neon/migrations/20260906040000_property_public_identity.sql",
      "utf8",
    );
    const inSchema = async (statement, params = []) => {
      const results = await db.transaction((tx) => [
        tx.query("SELECT set_config('search_path',$1,true)", [`${schema},public,pg_catalog`]),
        tx.query(statement, params),
      ]);
      return results[1];
    };
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await inSchema(`CREATE TABLE properties(
      id uuid PRIMARY KEY, listing_no text NOT NULL UNIQUE, canonical_property_no text,
      deal_type text NOT NULL, estate_id uuid, district_slug text, saleable_area int,
      gross_area int, bedrooms int, floor text, created_at timestamptz DEFAULT now()
    )`);
      await inSchema(`INSERT INTO properties(id,listing_no,canonical_property_no,deal_type,district_slug,saleable_area,gross_area,bedrooms,floor,created_at)
      VALUES
      ('00000000-0000-0000-0000-000000000001','B054645-old-S','B054645','sale','sham-tseng',515,650,2,'中','2026-01-01'),
      ('00000000-0000-0000-0000-000000000002','B054645-new-R','B054645','rent','sham-tseng',515,650,2,'中','2026-01-02'),
      ('00000000-0000-0000-0000-000000000003','B054645-null-S','B054645','sale','sham-tseng',515,NULL,2,NULL,'2026-01-03'),
      ('00000000-0000-0000-0000-000000000004','B054645-high-S','B054645','sale','sham-tseng',515,650,2,'高','2026-01-04')`);
      const statements = splitSqlStatements(
        migration +
          "\n" +
          readFileSync("neon/migrations/20260906090000_canonical_property_identity.sql", "utf8"),
      );
      await db.transaction((tx) => [
        tx.query("SELECT set_config('search_path',$1,true)", [`${schema},public,pg_catalog`]),
        ...statements.map((statement) => tx.query(statement)),
      ]);

      const members = await inSchema(`SELECT p.listing_no,m.public_listing_no,g.review_required
      FROM properties p JOIN property_public_members m ON m.property_id=p.id
      JOIN property_public_groups g USING(public_listing_no) ORDER BY p.listing_no`);
      assert.equal(members.length, 4, "migration never deletes source offerings");
      assert.deepEqual(
        members.map((row) => row.public_listing_no),
        ["B054645", "B054645", "B054645", "B054645"],
      );
      assert.equal(
        members.find((row) => row.listing_no === "B054645-high-S").public_listing_no,
        "B054645",
      );
      assert.ok(members.every((row) => row.review_required));

      await inSchema(`INSERT INTO properties(id,listing_no,canonical_property_no,deal_type,district_slug,saleable_area,gross_area,bedrooms,floor)
      VALUES ('00000000-0000-0000-0000-000000000005','B054645-future-R','B054645','rent','sham-tseng',515,650,2,'中')`);
      assert.equal(
        (
          await inSchema(
            `SELECT public_listing_no FROM property_public_members WHERE property_id='00000000-0000-0000-0000-000000000005'`,
          )
        )[0].public_listing_no,
        "B054645",
      );

      await inSchema(
        `UPDATE properties SET floor='低' WHERE id='00000000-0000-0000-0000-000000000005'`,
      );
      assert.equal(
        (
          await inSchema(
            `SELECT public_listing_no FROM property_public_members WHERE property_id='00000000-0000-0000-0000-000000000005'`,
          )
        )[0].public_listing_no,
        "B054645",
      );

      await inSchema(`INSERT INTO properties(id,listing_no,canonical_property_no,deal_type,district_slug,saleable_area)
      VALUES ('00000000-0000-0000-0000-000000000006','A-stable','A','sale','sham-tseng',400)`);
      await inSchema(
        `UPDATE properties SET canonical_property_no='B' WHERE id='00000000-0000-0000-0000-000000000006'`,
      );
      assert.equal(
        (
          await inSchema(
            `SELECT public_listing_no FROM property_public_members WHERE property_id='00000000-0000-0000-0000-000000000006'`,
          )
        )[0].public_listing_no,
        "A",
      );
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  },
);
