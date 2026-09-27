import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const counts = await import("./public-inventory-counts.mjs").catch(() => null);

test("overview counts current published property groups and sale/rent offers", async () => {
  assert.ok(counts?.buildPublicInventoryCountsQuery, "public inventory count query is missing");
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE properties (
      id text PRIMARY KEY, listing_no text, deal_type text NOT NULL,
      source_updated_at timestamp, last_seen_at timestamp, updated_at timestamp,
      created_at timestamp NOT NULL, status text NOT NULL, featured boolean NOT NULL DEFAULT false,
      estate_id text, price numeric, rent numeric
    );
    CREATE TABLE property_public_members (property_id text, public_listing_no text);
    CREATE TABLE estates (id text PRIMARY KEY);`);
    await db.query(`INSERT INTO properties(id,listing_no,deal_type,source_updated_at,created_at,status)
      VALUES
      ('p1-old','OLD-S','sale','2026-08-01','2026-08-01','active'),
      ('p1-sale','NEW-S','sale','2026-09-01','2026-09-01','active'),
      ('p1-rent','NEW-R','rent','2026-09-02','2026-09-02','active'),
      ('p2-old','OLD-2','sale','2026-08-01','2026-08-01','active'),
      ('p2-withdrawn','NEW-2','sale','2026-09-01','2026-09-01','withdrawn'),
      ('p3-draft','DRAFT','rent','2026-09-01','2026-09-01','draft'),
      ('unlinked','U1','sale','2026-09-01','2026-09-01','active')`);
    await db.query(`INSERT INTO property_public_members(property_id,public_listing_no)
      VALUES ('p1-old','A1'),('p1-sale','A1'),('p1-rent','A1'),
             ('p2-old','A2'),('p2-withdrawn','A2'),('p3-draft','A3')`);
    const result = await db.query(counts.buildPublicInventoryCountsQuery());
    assert.deepEqual(result.rows[0], { public_properties: 1, public_offers: 2 });
  } finally {
    await db.close();
  }
});

test("overview count query returns zero on empty inventory", async () => {
  assert.ok(counts?.buildPublicInventoryCountsQuery, "public inventory count query is missing");
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE properties (
      id text PRIMARY KEY, listing_no text, deal_type text NOT NULL,
      source_updated_at timestamp, last_seen_at timestamp, updated_at timestamp,
      created_at timestamp NOT NULL, status text NOT NULL, featured boolean NOT NULL DEFAULT false,
      estate_id text, price numeric, rent numeric
    );
    CREATE TABLE property_public_members (property_id text, public_listing_no text);
    CREATE TABLE estates (id text PRIMARY KEY);`);
    const result = await db.query(counts.buildPublicInventoryCountsQuery());
    assert.deepEqual(result.rows[0], { public_properties: 0, public_offers: 0 });
  } finally {
    await db.close();
  }
});
