import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolveLinkImportContext } from "../neon/whatsapp-link-import.server.ts";

const ids = {
  oldSale: "10000000-0000-4000-8000-000000000001",
  withdrawnSale: "10000000-0000-4000-8000-000000000002",
  rent: "10000000-0000-4000-8000-000000000003",
  activeSale: "10000000-0000-4000-8000-000000000004",
  staff: "10000000-0000-4000-8000-000000000005",
  ref: "10000000-0000-4000-8000-000000000006",
};
test("bulk import lookup uses canonical current offers and exact source-scoped references", async () => {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`
      CREATE TABLE properties(
        id uuid PRIMARY KEY, listing_no text, deal_type text, status text,
        source_updated_at timestamptz, last_seen_at timestamptz,
        updated_at timestamptz, created_at timestamptz,
        featured boolean DEFAULT false, estate_id uuid,
        title_zh text, price numeric, rent numeric, agent_id uuid
      );
      CREATE TABLE property_public_members(property_id uuid,public_listing_no text);
      CREATE TABLE estates(id uuid PRIMARY KEY);
      CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean,name_zh text,name_en text);
      CREATE TABLE staff_external_references(
        id uuid PRIMARY KEY,namespace text,external_reference text,staff_id uuid,
        valid_from timestamptz,valid_until timestamptz,verified_at timestamptz
      );
      CREATE TABLE whatsapp_tracking_link_versions(
        id uuid PRIMARY KEY,placement_source text,reference_mapping_id uuid
      );
    `);
    await query(
      `INSERT INTO properties(id,listing_no,deal_type,status,source_updated_at,created_at,title_zh)
      VALUES($1,'OLD-S','sale','active','2026-08-01','2026-08-01','old sale'),
            ($2,'NEW-S','sale','withdrawn','2026-09-01','2026-09-01','withdrawn sale'),
            ($3,'RENT','rent','active','2026-09-01','2026-09-01','rent'),
            ($4,'SALE','sale','active','2026-09-01','2026-09-01','sale')`,
      [ids.oldSale, ids.withdrawnSale, ids.rent, ids.activeSale],
    );
    await query(
      `INSERT INTO property_public_members VALUES
      ($1,'A1'),($2,'A1'),($3,'A1'),($4,'A2')`,
      [ids.oldSale, ids.withdrawnSale, ids.rent, ids.activeSale],
    );
    await query("INSERT INTO staff_users VALUES($1,true,'同事',null)", [ids.staff]);
    await query(
      `INSERT INTO staff_external_references
      VALUES($1,'28hse/account540','001-A',$2,now()-interval '1 day',null,now()-interval '1 day')`,
      [ids.ref, ids.staff],
    );
    const result = await resolveLinkImportContext(
      {
        offers: [
          { publicListingNo: "a1", dealType: "sale" },
          { publicListingNo: "a1", dealType: "rent" },
          { publicListingNo: "A2", dealType: "sale" },
        ],
        references: [
          {
            source: "28hse",
            namespace: "28hse/account540",
            externalReference: "001-A",
          },
        ],
      },
      query,
    );
    assert.deepEqual(
      result.offers.map((item) => [item.publicListingNo, item.dealType]),
      [
        ["A1", "rent"],
        ["A2", "sale"],
      ],
    );
    assert.equal(result.references[0].id, ids.ref);
    assert.equal(result.references[0].staffId, ids.staff);
    await db.exec(
      readFileSync("neon/migrations/20260927140000_whatsapp_link_reference_scope.sql", "utf8"),
    );
    await assert.rejects(
      query("INSERT INTO whatsapp_tracking_link_versions VALUES($1,'youtube',$2)", [
        "10000000-0000-4000-8000-000000000007",
        ids.ref,
      ]),
      /STAFF_REFERENCE_SOURCE_MISMATCH/,
    );
    await query("INSERT INTO whatsapp_tracking_link_versions VALUES($1,'28hse',$2)", [
      "10000000-0000-4000-8000-000000000008",
      ids.ref,
    ]);
    await assert.rejects(
      resolveLinkImportContext(
        {
          offers: [],
          references: [
            {
              source: "youtube",
              namespace: "28hse/account540",
              externalReference: "001-A",
            },
          ],
        },
        query,
      ),
      (error) => error instanceof Response && error.status === 400,
    );
  } finally {
    await db.close();
  }
});
