import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { neon } from "@neondatabase/serverless";
const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

function inlineRelativeImports(source, dir) {
  return source.replace(/from "\.\/([\w.-]+?)(?:\.js)?"/g, (match, name) => {
    for (const candidate of [`${name}.ts`, `${name}.js`]) {
      const path = join(root, dir, candidate);
      if (!existsSync(path)) continue;
      const code = readFileSync(path, "utf8");
      return `from "${dataUrl(candidate.endsWith(".ts") ? transpile(code) : code)}"`;
    }
    return match;
  });
}

async function importPublicDataServerWithInjectedQuery(query) {
  globalThis.__publicPerformanceDbQuery = query;
  const dbUrl = dataUrl(
    "export const getSql = () => ({ query: (...args) => globalThis.__publicPerformanceDbQuery(...args) });",
  );
  const executable = inlineRelativeImports(
    transpile(read("src/lib/neon/public-data.server.ts"))
      .replace('import "@tanstack/react-start/server-only";', "")
      .replace('from "./db.server"', `from "${dbUrl}"`),
    "src/lib/neon",
  );

  return import(dataUrl(executable));
}

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "isolated PostgreSQL fixture: unified pages preserve current offerings, withdrawals, aliases and independent deal counts",
  { skip: !databaseUrl },
  async () => {
    assert.equal(
      process.env.PUBLIC_TEST_DATABASE_CONFIRMED,
      "true",
      "Explicit approved disposable target required",
    );
    const schema = "task8_" + randomUUID().replaceAll("-", "");
    assert.match(schema, /^task8_[a-f0-9]{32}$/);
    const db = neon(databaseUrl);
    const query = async (statement, params = []) => {
      const results = await db.transaction((tx) => [
        tx.query("SELECT set_config('search_path',$1,true)", [schema + ",pg_catalog"]),
        tx.query(statement, params),
      ]);
      return results[1];
    };
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await query(`CREATE TYPE deal_type AS ENUM ('sale','rent')`);
      await query(
        `CREATE TABLE estates(id text PRIMARY KEY,name_zh text,slug text,district_slug text,year_completed integer,developer text,total_units integer,lat numeric,lng numeric)`,
      );
      await query(`CREATE TABLE properties(id text PRIMARY KEY,listing_no text,canonical_property_no text,title_zh text,
   deal_type deal_type,price numeric,rent numeric,saleable_area numeric,bedrooms integer,bathrooms integer,
   features text[],images text[],video_url text,estate_id text,district_slug text,address text,status text,
   featured boolean,last_seen_at timestamptz,created_at timestamptz,updated_at timestamptz,source_site text,
   title_en text,gross_area numeric,floor text,orientation text,management_fee numeric,description text,
   floorplan_url text,legacy_detail_id text,legacy_property_no text,legacy_url text,source_url text,
   source_updated_at timestamptz,last_scraped_at timestamptz,agent_id text)`);
      await query(
        `CREATE TABLE staff_users(id text PRIMARY KEY,active boolean,name_zh text,name_en text,phone text,whatsapp text,licence_no text,avatar_url text,branch text,bio text)`,
      );
      await query(`CREATE TABLE property_public_groups(public_listing_no text PRIMARY KEY)`);
      await query(
        `CREATE TABLE property_public_members(property_id text PRIMARY KEY REFERENCES properties(id),public_listing_no text REFERENCES property_public_groups(public_listing_no))`,
      );
      const rows = [];
      for (let i = 0; i < 30; i++)
        rows.push({
          id: String(i).padStart(3, "0"),
          listing: "S" + i,
          canonical: "C" + i,
          deal: "sale",
        });
      for (let i = 0; i < 20; i++)
        rows.push({ id: "dup" + i, listing: "D" + i, canonical: "C" + i, deal: "sale" });
      rows.push(
        { id: "rent", listing: "R0", canonical: "C0", deal: "rent" },
        { id: "null1", listing: "N1", canonical: null, deal: "sale" },
        { id: "null2", listing: "N2", canonical: "", deal: "sale" },
      );
      await query(
        `INSERT INTO properties(id,listing_no,canonical_property_no,title_zh,deal_type,status,featured,last_seen_at,created_at)
   SELECT id,listing,canonical,'Synthetic',deal::deal_type,'active',false,'2026-01-01'::timestamptz,'2026-01-01'::timestamptz
   FROM jsonb_to_recordset($1::jsonb) AS x(id text,listing text,canonical text,deal text)`,
        [JSON.stringify(rows)],
      );
      await query(
        `INSERT INTO property_public_groups SELECT DISTINCT COALESCE(NULLIF(canonical_property_no,''),listing_no) FROM properties`,
      );
      await query(
        `INSERT INTO property_public_members SELECT id,COALESCE(NULLIF(canonical_property_no,''),listing_no) FROM properties`,
      );
      await query(
        `UPDATE properties SET district_slug='sham-tseng', legacy_detail_id=listing_no, description=deal_type::text || ' description'`,
      );
      const server = await importPublicDataServerWithInjectedQuery(query);
      const pages = [];
      for (let page = 1; page <= 3; page++)
        pages.push(
          await server.searchListings({ deal: "all", sort: "newest", page, pageSize: 12 }),
        );
      assert.deepEqual(
        pages.map((page) => page.total),
        [32, 32, 32],
      );
      assert.deepEqual(
        pages.map((page) => page.rows.length),
        [12, 12, 8],
      );
      const all = pages.flatMap((page) => page.rows);
      assert.equal(new Set(all.map((row) => row.public_listing_no)).size, 32);
      assert.equal(all.filter((row) => row.canonical_property_no === "C0").length, 1);
      assert.ok(all.some((row) => row.listing_no === "N1"));
      assert.ok(all.some((row) => row.listing_no === "N2"));
      assert.deepEqual(
        (await server.searchListings({ deal: "all", sort: "newest", page: 2, pageSize: 12 })).rows,
        pages[1].rows,
      );
      // Current offering duplicates must never reappear as a similar property.
      await query("UPDATE properties SET estate_id = 'fixture-estate'");
      const similar = (excludeId, dealType = "sale") =>
        server.fetchSimilarListings({
          estateId: "fixture-estate",
          dealType,
          excludeId,
          limit: 100,
        });
      for (const current of ["000", "dup0"]) {
        const suggestions = await similar(current);
        assert.equal(suggestions.length, 31);
        assert.ok(suggestions.every((row) => row.canonical_property_no !== "C0"));
        assert.ok(suggestions.some((row) => row.canonical_property_no === "C1"));
      }
      // Similar results exclude the physical unit even when queried through its other deal.
      assert.equal(
        (await similar("rent")).some((row) => row.public_listing_no === "C0"),
        false,
      );
      const corridorInput = {
        districtSlugs: ["sham-tseng"],
        estateSlugs: [],
        textAliases: [],
        outOfScopeTextAliases: [],
        limit: 24,
      };
      const corridor = await server.fetchCorridorInventory(corridorInput);
      assert.equal(corridor.saleTotal, 32);
      assert.equal(corridor.rentTotal, 1, "dual unit participates in both deal categories");
      assert.equal(corridor.rentRows[0].public_listing_no, "C0");
      const before = await server.fetchPropertyByListingNo({ listingNo: "D0" });
      assert.equal(before.public_listing_no, "C0");
      assert.deepEqual(before.offerings.map((o) => o.deal_type).sort(), ["rent", "sale"]);
      assert.ok(before.listing_aliases.includes("S0") && before.listing_aliases.includes("R0"));
      assert.equal(
        before.offerings.find((o) => o.deal_type === "rent").description,
        "rent description",
      );
      assert.equal(
        "description" in all.find((row) => row.public_listing_no === "C0").offerings[0],
        false,
        "card transport excludes long offering copy",
      );
      await query(`UPDATE properties SET featured=true WHERE id='000'`);
      await query(
        `UPDATE properties SET status='inactive',source_updated_at='2026-02-01' WHERE id='dup0'`,
      );
      const after = await server.fetchPropertyByListingNo({ listingNo: "S0" });
      assert.equal(after.deal_type, "rent");
      assert.deepEqual(
        after.offerings.map((o) => o.id),
        ["rent"],
        "new withdrawal beats an older featured sale",
      );
      assert.equal(
        (await server.searchListings({ deal: "sale", sort: "newest", page: 1, pageSize: 100 }))
          .total,
        31,
      );
      assert.equal((await server.fetchCorridorInventory(corridorInput)).rentTotal, 1);
      await query(`UPDATE properties SET price=2000000 WHERE id='001'`);
      await query(
        `UPDATE properties SET price=9000000,source_updated_at='2026-02-01' WHERE id='dup1'`,
      );
      assert.equal(
        (
          await server.searchListings({
            deal: "sale",
            sort: "newest",
            page: 1,
            pageSize: 100,
            maxPrice: 3000000,
          })
        ).total,
        0,
        "older low price must not pass a current price filter",
      );
      await query(
        `UPDATE properties SET status='inactive',source_updated_at='2026-02-02' WHERE id='dup2'`,
      );
      assert.equal(
        (await server.searchListings({ deal: "all", sort: "newest", page: 1, pageSize: 100 }))
          .total,
        31,
      );
      assert.equal(
        await server.fetchPropertyByLegacyDetailId({ oldId: "S2" }),
        null,
        "old active legacy alias cannot resurrect a withdrawn unit",
      );
      await query(
        `UPDATE properties SET status='sold',source_updated_at='2026-02-02' WHERE id='dup3'`,
      );
      const sold = await server.fetchPropertyByListingNo({ listingNo: "S3" });
      assert.equal(sold.status, "sold");
      assert.deepEqual(sold.offerings, []);
      await query(
        `UPDATE properties SET status='rented',source_updated_at='2026-02-03' WHERE id='rent'`,
      );
      const rented = await server.fetchPropertyByListingNo({ listingNo: "C0" });
      assert.equal(rented.status, "rented");
      assert.deepEqual(rented.offerings, []);
      await query(`UPDATE properties SET floor='中',saleable_area=515 WHERE id='004'`);
      await query(`UPDATE properties SET source_updated_at='2026-02-02' WHERE id='dup4'`);
      const completed = await server.fetchPropertyByListingNo({ listingNo: "C4" });
      assert.equal(completed.floor, "中");
      assert.equal(completed.saleable_area, 515);
      await query(`INSERT INTO properties(id,listing_no,canonical_property_no,deal_type,status,floor,saleable_area,created_at)
        VALUES ('conflict4','conflict4','C4','sale','inactive','高',517,'2025-01-01')`);
      await query(`INSERT INTO property_public_members VALUES ('conflict4','C4')`);
      const disputed = await server.fetchPropertyByListingNo({ listingNo: "C4" });
      assert.equal(disputed.floor, null, "do not invent a fallback from conflicting floors");
      assert.equal(disputed.saleable_area, null, "do not choose the maximum conflicting area");
      await query(`ALTER TABLE estates ADD COLUMN published boolean DEFAULT true, ADD COLUMN avg_saleable_psf numeric, ADD COLUMN hero_image text, ADD COLUMN name_en text, ADD COLUMN aliases text[]`);
      await query(`INSERT INTO estates(id,slug,name_zh,district_slug,avg_saleable_psf) VALUES('market-estate','market-estate','Synthetic','market-district',99999)`);
      await query(`INSERT INTO properties(id,listing_no,canonical_property_no,deal_type,status,estate_id,price,saleable_area,images,source_updated_at)
        VALUES('market-old','market-old','market','sale','active','market-estate',1000000,500,ARRAY['https://example.com/old.jpg'],'2026-01-01'),
        ('market-new','market-new','market','sale','active','market-estate',3000000,500,ARRAY['https://example.com/new.jpg'],'2026-02-01')`);
      await query(`INSERT INTO property_public_groups VALUES('market')`);
      await query(`INSERT INTO property_public_members VALUES('market-old','market'),('market-new','market')`);
      const directory=await server.fetchEstateDirectory();
      const directoryEstate=directory.rows.find(e=>e.slug==='market-estate');
      assert.equal(directoryEstate.total,1);assert.equal(directoryEstate.sale,1);assert.equal(directoryEstate.rent,0);
      await query(`INSERT INTO properties(id,listing_no,canonical_property_no,deal_type,status,estate_id,price,source_updated_at)
        VALUES('market-rent','market-rent','market','rent','active','market-estate',10000,'2026-02-01')`);
      await query(`INSERT INTO property_public_members VALUES('market-rent','market')`);
      const dualDirectory=(await server.fetchEstateDirectory()).rows.find(e=>e.slug==='market-estate');
      assert.equal(dualDirectory.total,1,'dual offering counts as one property');
      assert.equal(dualDirectory.sale,1);assert.equal(dualDirectory.rent,1);
      const market=await server.fetchEstateBySlug({slug:'market-estate'});
      assert.equal(Number(market.avg_saleable_psf),6000,"current asking PSF replaces stale manual value and deduplicates history");
      assert.equal(market.hero_image,'https://example.com/new.jpg');
      await query(`UPDATE properties SET status='inactive' WHERE id='market-new'`);
      const withdrawn=await server.fetchEstateBySlug({slug:'market-estate'});
      assert.equal(withdrawn.avg_saleable_psf,null,"withdrawn current offering cannot resurrect historic price");
      const rentOnly=(await server.fetchEstateDirectory()).rows.find(e=>e.slug==='market-estate');
      assert.equal(rentOnly.total,1);assert.equal(rentOnly.sale,0);assert.equal(rentOnly.rent,1);
      await query(`UPDATE properties SET status='inactive' WHERE id='market-rent'`);
      const emptyEstate=(await server.fetchEstateDirectory()).rows.find(e=>e.slug==='market-estate');
      assert.equal(emptyEstate.total,0,'published empty estate remains discoverable');
      await query(`UPDATE estates SET published=false WHERE id='market-estate'`);
      assert.equal(await server.fetchEstateBySlug({slug:'market-estate'}),null);
      assert.equal((await server.fetchEstateDirectory()).rows.some(e=>e.slug==='market-estate'),false);
      assert.deepEqual(await server.fetchEstates({districtSlug:'market-district'}),[]);

    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  },
);
