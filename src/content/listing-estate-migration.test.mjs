import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { resolveSavedEstate } from "../lib/mls/saved-capture-estates.mjs";
import { listingEstateContent } from "./listing-estate-content.ts";

const migrationUrl = new URL(
  "../../neon/migrations/20261026170000_listing_estate_content.sql",
  import.meta.url,
);
const evidenceUrl = new URL("./fixtures/listing-estate-expansion-20261026.json", import.meta.url);
const ownershipMigrationUrl = new URL(
  "../../neon/migrations/20260907120000_propertyhk_ingestion_v2.sql",
  import.meta.url,
);

test("estate content migration is scoped, preserves authored data and links only unchanged active evidence", async () => {
  assert.ok(existsSync(migrationUrl), "reviewable estate migration must exist");
  const evidence = JSON.parse(readFileSync(evidenceUrl, "utf8"));
  // Fully owned in-memory Postgres: no URL, remote client or production data writes.
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE districts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE);
      INSERT INTO districts(slug) VALUES ('sham-tseng'),('tsing-lung-tau'),('castle-peak-road'),('ting-kau');
      CREATE TABLE estates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE,name_zh text,name_en text,
        district_slug text,district_id uuid,aliases text[],address text,description text,hero_image text,
        seo_title text,seo_description text,published boolean DEFAULT false,updated_at timestamptz DEFAULT now());
      CREATE TABLE properties(listing_no text PRIMARY KEY,title_zh text,address text,source_url text,
        status text,estate_id uuid REFERENCES estates(id),agent_id uuid,
        ingestion_owner text DEFAULT 'legacy',ingestion_identity_policy text DEFAULT 'legacy');`);
    await db.query(`INSERT INTO estates(slug,name_zh,district_slug,aliases,description,hero_image)
      VALUES('napa','NAPA','castle-peak-road',ARRAY['custom alias'],'Authored introduction','https://example.test/authored.jpg'),
      ('lung-chu-island-garden','龍珠島花園','castle-peak-road',ARRAY['龍珠島別墅'],null,null),
      ('unrelated','其他屋苑','elsewhere',null,'Keep unrelated',null)`);
    const reviewed = evidence.estates.flatMap((estate) =>
      estate.listings
        .filter((listing) => listing.needsBackfill)
        .map((listing) => ({ ...listing, slug: estate.slug })),
    );
    assert.ok(reviewed.length > 30, "exercise the reviewed backfill set");
    for (const item of reviewed) {
      await db.query(
        `INSERT INTO properties(listing_no,title_zh,address,source_url,status,estate_id)
        VALUES($1,$2,$3,$4,'active',null)`,
        [item.listingNo, item.titleZh, item.address, item.sourceUrl],
      );
    }
    // Guard cases start from real evidence and change exactly one safety boundary.
    const [explicit, inactive, edited, moved] = reviewed;
    await db.query(
      "UPDATE properties SET estate_id=(SELECT id FROM estates WHERE slug='unrelated') WHERE listing_no=$1",
      [explicit.listingNo],
    );
    await db.query("UPDATE properties SET status='inactive' WHERE listing_no=$1", [
      inactive.listingNo,
    ]);
    await db.query("UPDATE properties SET title_zh='Edited since review' WHERE listing_no=$1", [
      edited.listingNo,
    ]);
    await db.query(
      "UPDATE properties SET source_url='https://example.test/different-source' WHERE listing_no=$1",
      [moved.listingNo],
    );
    await db.query(
      "INSERT INTO properties(listing_no,title_zh,address,source_url,status,estate_id) VALUES('outside','比較 NAPA 及其他屋苑','不在本次名單','https://example.test','active',null)",
    );
    const ingestionOwned = reviewed.find((item) => item.slug === "pearl-garden");
    assert.ok(ingestionOwned, "reviewed ingestion-owned listing must be linkable");
    // Seed ownership before installing the real fence; never grant the v2 writer policy.
    await db.query(
      "UPDATE properties SET ingestion_owner='no-hermes-v2',ingestion_identity_policy='no-hermes-v2' WHERE listing_no=$1",
      [ingestionOwned.listingNo],
    );
    const ownershipFence = readFileSync(ownershipMigrationUrl, "utf8").match(
      /CREATE OR REPLACE FUNCTION mls_ingestion_owner_fence_fn\(\)[\s\S]*?FOR EACH ROW EXECUTE FUNCTION mls_ingestion_owner_fence_fn\(\);/,
    );
    assert.ok(ownershipFence, "install the production ownership fence function and trigger");
    await db.exec(ownershipFence[0]);
    await assert.rejects(
      db.query("UPDATE properties SET estate_id=estate_id WHERE listing_no=$1", [
        ingestionOwned.listingNo,
      ]),
      /MLS_INGESTION_OWNERSHIP_CONFLICT/,
    );
    const sql = readFileSync(migrationUrl, "utf8");
    await db.exec(sql);
    const { rows: estates } = await db.query("SELECT * FROM estates ORDER BY slug");
    assert.equal(estates.length, evidence.estates.length + 1);
    assert.equal(estates.find((row) => row.slug === "unrelated").published, false);
    assert.equal(estates.find((row) => row.slug === "napa").description, "Authored introduction");
    assert.equal(
      estates.find((row) => row.slug === "napa").hero_image,
      "https://example.test/authored.jpg",
    );
    assert.ok(estates.find((row) => row.slug === "napa").aliases.includes("custom alias"));
    assert.ok(
      !estates.find((row) => row.slug === "lung-chu-island-garden").aliases.includes("龍珠島別墅"),
    );
    for (const estate of evidence.estates) {
      const row = estates.find((item) => item.slug === estate.slug);
      assert.ok(row.published && row.description && row.hero_image && row.address, estate.slug);
    }
    for (const [label, slug, district] of [
      ["逸璟龍灣", "l-aquatique", "tsing-lung-tau"],
      ["星岸大廈", "deauville", "ting-kau"],
      ["富安新村", "fiona-garden", "castle-peak-road"],
      ["龍珠島別墅", "pearl-island-bungalow", "castle-peak-road"],
      ["龍珠島花園", "lung-chu-island-garden", "castle-peak-road"],
    ]) {
      assert.equal(
        resolveSavedEstate({ estate: label, district }, {}, estates, [
          { slug: district, name_zh: district },
        ]).slug,
        slug,
        label,
      );
    }
    const { rows: links } = await db.query(
      "SELECT p.*,e.slug FROM properties p LEFT JOIN estates e ON e.id=p.estate_id ORDER BY listing_no",
    );
    const ownedLink = links.find((row) => row.listing_no === ingestionOwned.listingNo);
    assert.equal(ownedLink.slug, "pearl-garden", "admin flag permits the reviewed estate link");
    assert.equal(ownedLink.ingestion_owner, "no-hermes-v2");
    assert.equal(ownedLink.ingestion_identity_policy, "no-hermes-v2");
    await assert.rejects(
      db.query("UPDATE properties SET estate_id=null WHERE listing_no=$1", [
        ingestionOwned.listingNo,
      ]),
      /MLS_INGESTION_OWNERSHIP_CONFLICT/,
      "migration must not leave the admin write flag enabled",
    );
    for (const item of reviewed) {
      const row = links.find((r) => r.listing_no === item.listingNo);
      assert.equal(
        row.slug,
        item === explicit
          ? "unrelated"
          : [inactive, edited, moved].includes(item)
            ? null
            : item.slug,
        item.listingNo,
      );
    }
    assert.equal(links.find((row) => row.listing_no === "outside").estate_id, null);
    await db.exec(sql);
    assert.deepEqual(
      (await db.query("SELECT * FROM estates ORDER BY slug")).rows,
      estates,
      "rerun does not churn estate rows",
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT p.*,e.slug FROM properties p LEFT JOIN estates e ON e.id=p.estate_id ORDER BY listing_no",
        )
      ).rows,
      links,
    );
    // A slug that has drifted to a different published identity is not authority to link.
    const deauville = reviewed.find((item) => item.slug === "deauville");
    await db.query("UPDATE properties SET estate_id=null WHERE listing_no=$1", [
      deauville.listingNo,
    ]);
    await db.query(
      "UPDATE estates SET name_zh='Different estate',district_slug='elsewhere' WHERE slug='deauville'",
    );
    await db.exec(sql);
    assert.equal(
      (
        await db.query("SELECT estate_id FROM properties WHERE listing_no=$1", [
          deauville.listingNo,
        ])
      ).rows[0].estate_id,
      null,
    );
    assert.equal(
      (await db.query("SELECT name_zh FROM estates WHERE slug='deauville'")).rows[0].name_zh,
      "Different estate",
    );
  } finally {
    await db.close();
  }
});

test("editorial refresh upgrades only reviewed estate fields and preserves later author edits", async () => {
  const audit = JSON.parse(
    readFileSync(
      new URL("./fixtures/corridor-estate-quality-20261026.json", import.meta.url),
      "utf8",
    ),
  );
  const sql = readFileSync(
    new URL(
      "../../neon/migrations/20261026210000_corridor_estate_editorial_quality.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE estates(slug text PRIMARY KEY,name_zh text,district_slug text,
      description text,hero_image text,seo_title text,seo_description text,published boolean,
      updated_at timestamptz DEFAULT '2026-10-26T00:00:00Z');`);
    for (const item of audit.estates) {
      const before = item.before;
      await db.query(
        `INSERT INTO estates(slug,name_zh,district_slug,description,hero_image,seo_title,seo_description,published)
        VALUES($1,$2,$3,$4,$5,$6,$7,true)`,
        [
          item.slug,
          item.nameZh,
          item.districtSlug,
          before.description,
          before.heroImage,
          before.seoTitle,
          before.seoDescription,
        ],
      );
    }
    await db.exec(`INSERT INTO estates VALUES('unrelated','其他屋苑','elsewhere','Unrelated prose','custom.jpg','Unrelated title','Unrelated SEO',false,'2026-10-26T00:00:00Z');
      UPDATE estates SET description='Later authored introduction',hero_image='authored.jpg',seo_title='Later authored title',seo_description='Later authored SEO' WHERE slug='napa';
      UPDATE estates SET description='',hero_image=null,seo_title=null,seo_description='' WHERE slug='elegant-villa';
      UPDATE estates SET description='Later authored Palm Cove introduction' WHERE slug='palm-cove';
      UPDATE estates SET name_zh='Different identity' WHERE slug='deauville';
      UPDATE estates SET district_slug='elsewhere' WHERE slug='riviera';
      UPDATE estates SET published=false WHERE slug='peak-castle';`);
    await db.exec(sql);
    const { rows } = await db.query("SELECT * FROM estates ORDER BY slug");
    for (const item of audit.estates) {
      const row = rows.find((row) => row.slug === item.slug);
      const content = listingEstateContent.find((content) => content.slug === item.slug);
      if (item.slug === "napa") {
        assert.equal(row.description, "Later authored introduction");
        assert.equal(row.hero_image, "authored.jpg");
        assert.equal(row.seo_title, "Later authored title");
        assert.equal(row.seo_description, "Later authored SEO");
      } else if (["deauville", "riviera", "peak-castle"].includes(item.slug)) {
        assert.equal(
          row.description,
          item.before.description,
          "identity drift/unpublication is not permission to update",
        );
      } else {
        assert.equal(
          row.description,
          item.slug === "palm-cove"
            ? "Later authored Palm Cove introduction"
            : content.overview.join("\n\n"),
          item.slug,
        );
        assert.equal(row.seo_title, content.seoTitle, item.slug);
        assert.equal(row.seo_description, content.seoDescription, item.slug);
        assert.equal(row.hero_image, item.before.heroImage, item.slug);
        assert.equal(row.published, true, item.slug);
      }
    }
    assert.equal(rows.find((row) => row.slug === "unrelated").description, "Unrelated prose");
    assert.equal(rows.find((row) => row.slug === "unrelated").published, false);
    assert.equal(rows.find((row) => row.slug === "peak-castle").published, false);
    await db.exec(sql);
    assert.deepEqual(
      (await db.query("SELECT * FROM estates ORDER BY slug")).rows,
      rows,
      "rerun does not churn content or timestamps",
    );
  } finally {
    await db.close();
  }
});
