import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildWebsiteCoverageQuery } from "../neon/whatsapp-coverage-query.mjs";
import { classifyWebsiteCoverage, summarizeWebsiteCoverage } from "./coverage.mjs";
import { resolveTrackingLinks } from "../neon/whatsapp-enquiries.server.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("coverage uses current public sale/rent offers and only current verified website primary links", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE estates(id uuid PRIMARY KEY);
      CREATE TABLE properties(
        id uuid PRIMARY KEY, listing_no text, deal_type text, status text,
        source_updated_at timestamptz,last_seen_at timestamptz,updated_at timestamptz,created_at timestamptz,
        estate_id uuid,featured boolean DEFAULT false,price integer,rent integer
      );
      CREATE TABLE property_public_members(property_id uuid,public_listing_no text);
      CREATE TABLE whatsapp_tracking_links(id uuid PRIMARY KEY,code text,current_version integer);
      CREATE TABLE whatsapp_tracking_link_versions(
        link_id uuid,version integer,channel_id text,placement_source text,entry_point_type text,
        public_listing_no text,property_id uuid,deal_type text,enabled boolean,placement_verified_at timestamptz
      );
      CREATE TABLE whatsapp_tracking_link_placements(link_id uuid,placement_id text);
    `);
    for (let i = 1; i <= 7; i++) {
      await db.query("INSERT INTO properties VALUES($1,$2,$3,$4,now(),now(),now(),now(),null,false,null,null)", [
        id(i), `L${i}`, i === 2 ? "rent" : "sale", i === 7 ? "inactive" : "active",
      ]);
      await db.query("INSERT INTO property_public_members VALUES($1,$2)", [id(i), i <= 2 ? "A000001" : `A${String(i).padStart(6,"0")}`]);
    }
    // A newer withdrawn scrape suppresses an older active sale.
    await db.query("INSERT INTO properties VALUES($1,'withdrawn','sale','withdrawn',now()+interval '1 day',now(),now(),now(),null,false,null,null)", [id(8)]);
    await db.query("INSERT INTO property_public_members VALUES($1,'A000006')", [id(8)]);
    async function link(n, property, source = "website", placement = "website:primary", verified = true) {
      await db.query("INSERT INTO whatsapp_tracking_links VALUES($1,$2,1)", [id(n), `code-${n}`]);
      await db.query("INSERT INTO whatsapp_tracking_link_versions VALUES($1,1,'company',$2,'sales',$3,$4,$5,true,$6)", [
        id(n), source, property <= 2 ? "A000001" : `A${String(property).padStart(6,"0")}`,
        id(property), property === 2 ? "rent" : "sale", verified ? new Date() : null,
      ]);
      await db.query("INSERT INTO whatsapp_tracking_link_placements VALUES($1,$2)", [id(n), placement]);
    }
    await link(101,1);
    await link(102,2);
    await link(103,3,"28hse","external");
    await link(104,4,"website","website:primary",false);
    await link(105,5);
    await link(106,5);
    const rows = (await db.query(buildWebsiteCoverageQuery(), ["company", null, null, null])).rows.map((row) =>
      classifyWebsiteCoverage({
        propertyId: row.property_id, publicListingNo: row.public_listing_no,
        dealType: row.deal_type, candidateCount: Number(row.candidate_count), code: row.code,
      }),
    );
    assert.deepEqual(summarizeWebsiteCoverage(rows), {
      eligibleOffers: 5, coveredOffers: 2, missingOffers: 2, conflictedOffers: 1,
    });
    assert.equal(rows.some((row) => row.propertyId === id(6)), false);
    assert.equal(rows.some((row) => row.propertyId === id(7)), false);
    assert.equal(rows.find((row) => row.propertyId === id(5)).status, "conflicted");
    const previous = {
      enabled: process.env.EP_WA_TRACKED_LINKS_ENABLED,
      channel: process.env.EP_WA_COMPANY_CHANNEL_ID,
      phone: process.env.EP_WA_COMPANY_PHONE,
    };
    const warn = console.warn;
    try {
      process.env.EP_WA_TRACKED_LINKS_ENABLED = "true";
      process.env.EP_WA_COMPANY_CHANNEL_ID = "company";
      process.env.EP_WA_COMPANY_PHONE = "85291234567";
      console.warn = () => {};
      const offers = [1, 2, 3, 5, 6].map((number) => ({
        propertyId: id(number),
        publicListingNo: number <= 2 ? "A000001" : `A${String(number).padStart(6,"0")}`,
        dealType: number === 2 ? "rent" : "sale",
        title: "Synthetic public offer",
      }));
      const resolved = await resolveTrackingLinks(offers, async (sql, params) => (await db.query(sql, params)).rows);
      assert.equal(resolved.actions[0].mode, "tracked");
      assert.equal(resolved.actions[1].mode, "tracked");
      assert.equal(resolved.actions[2].mode, "untracked");
      assert.equal(resolved.actions[3].mode, "untracked");
      assert.equal(resolved.actions[4].mode, "untracked");
      assert.equal(resolved.links[3].href, null);
    } finally {
      console.warn = warn;
      for (const [key, value] of Object.entries({
        EP_WA_TRACKED_LINKS_ENABLED: previous.enabled,
        EP_WA_COMPANY_CHANNEL_ID: previous.channel,
        EP_WA_COMPANY_PHONE: previous.phone,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } finally {
    await db.close();
  }
});
