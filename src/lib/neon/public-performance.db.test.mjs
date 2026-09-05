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
  "isolated PostgreSQL fixture: canonical count and pages keep sale/rent and null identities",
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
        `CREATE TABLE estates(id text PRIMARY KEY,name_zh text,slug text,district_slug text)`,
      );
      await query(`CREATE TABLE properties(id text PRIMARY KEY,listing_no text,canonical_property_no text,title_zh text,
   deal_type deal_type,price numeric,rent numeric,saleable_area numeric,bedrooms integer,bathrooms integer,
   features text[],images text[],video_url text,estate_id text,district_slug text,address text,status text,
   featured boolean,last_seen_at timestamptz,created_at timestamptz,updated_at timestamptz,source_site text)`);
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
      const server = await importPublicDataServerWithInjectedQuery(query);
      const pages = [];
      for (let page = 1; page <= 3; page++)
        pages.push(
          await server.searchListings({ deal: "all", sort: "newest", page, pageSize: 12 }),
        );
      assert.deepEqual(
        pages.map((page) => page.total),
        [33, 33, 33],
      );
      assert.deepEqual(
        pages.map((page) => page.rows.length),
        [12, 12, 9],
      );
      const all = pages.flatMap((page) => page.rows);
      assert.equal(new Set(all.map((row) => row.listing_no)).size, 33);
      assert.equal(all.filter((row) => row.canonical_property_no === "C0").length, 2);
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
      // Opposite deal type remains a different offering even with the same identity.
      assert.equal(
        (await similar("rent")).some((row) => row.canonical_property_no === "C0"),
        true,
      );
      await query(`INSERT INTO properties(id,listing_no,canonical_property_no,deal_type,status,estate_id,featured)
        VALUES ('null-duplicate','N1','','sale','active','fixture-estate',false)`);
      for (const current of ["null1", "null-duplicate"]) {
        const suggestions = await similar(current);
        assert.ok(suggestions.every((row) => row.listing_no !== "N1"));
        assert.ok(suggestions.some((row) => row.listing_no === "N2"));
      }
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  },
);
