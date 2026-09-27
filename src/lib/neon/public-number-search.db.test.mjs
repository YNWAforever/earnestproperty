import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

function inlineRelativeImports(source) {
  return source.replace(/from "\.\/([\w.-]+?)(?:\.js)?"/g, (match, name) => {
    for (const ext of [".ts", ".js"]) {
      const path = join(root, "src/lib/neon", name + ext);
      if (existsSync(path)) {
        const code = readFileSync(path, "utf8");
        return `from "${dataUrl(ext === ".ts" ? transpile(code) : code)}"`;
      }
    }
    return match;
  });
}

async function loadSearch(query) {
  globalThis.__syntheticPublicSearchQuery = query;
  const dbUrl = dataUrl(
    "export const getSql = () => ({ query: (...args) => globalThis.__syntheticPublicSearchQuery(...args) });",
  );
  const source = inlineRelativeImports(
    transpile(readFileSync(join(root, "src/lib/neon/public-data.server.ts"), "utf8"))
      .replace('import "@tanstack/react-start/server-only";', "")
      .replace('from "./db.server"', `from "${dbUrl}"`),
  );
  return import(dataUrl(source));
}

test("public number and old alias find only the current active offering", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE deal_type AS ENUM ('sale', 'rent');
      CREATE TABLE estates (id text PRIMARY KEY, slug text, name_zh text, name_en text);
      CREATE TABLE properties (
        id text PRIMARY KEY, listing_no text, deal_type deal_type, status text,
        source_updated_at timestamptz, last_seen_at timestamptz, updated_at timestamptz,
        created_at timestamptz, estate_id text, title_zh text, title_en text, address text,
        district_slug text, video_url text, price numeric, rent numeric, saleable_area numeric,
        bedrooms int, agent_id text
      );
      CREATE TABLE property_public_members (property_id text PRIMARY KEY, public_listing_no text);
      INSERT INTO properties (id, listing_no, deal_type, status, source_updated_at, created_at, title_zh)
      VALUES
        ('old-sale', 'OLD-714', 'sale', 'active', '2026-01-01', '2026-01-01', '舊售盤'),
        ('new-sale', 'SYNC-new-sale', 'sale', 'withdrawn', '2026-02-01', '2026-02-01', '已下架售盤'),
        ('rent', 'SYNC-rent', 'rent', 'active', '2026-03-01', '2026-03-01', '現有租盤'),
        ('other', 'SYNC-other', 'sale', 'active', '2026-04-01', '2026-04-01', '其他樓盤');
      INSERT INTO property_public_members VALUES
        ('old-sale', 'A074714'), ('new-sale', 'A074714'),
        ('rent', 'A074714'), ('other', 'B000001');
    `);
    const statements = [];
    const server = await loadSearch(async (sql, params = []) => {
      statements.push({ sql, params });
      if (!/SELECT count\(\*\)::int AS total/.test(sql)) return [];
      return (await db.query(sql, params)).rows;
    });
    for (const keyword of ["A074714", "a074714", " A074714 ", "OLD-714"]) {
      const result = await server.searchListings({ deal: "all", keyword, page: 1, pageSize: 12 });
      assert.equal(result.total, 1, `${keyword} must find the one current public group`);
    }
    const sale = await server.searchListings({
      deal: "sale",
      keyword: "A074714",
      page: 1,
      pageSize: 12,
    });
    assert.equal(sale.total, 0, "a newer withdrawn sale must suppress an older active sale");
    const rent = await server.searchListings({
      deal: "rent",
      keyword: "A074714",
      page: 1,
      pageSize: 12,
    });
    assert.equal(rent.total, 1, "the active rental remains searchable");
    assert.ok(
      statements.every(({ sql }) => !sql.includes("A074714")),
      "values remain bound",
    );
  } finally {
    await db.close();
    delete globalThis.__syntheticPublicSearchQuery;
  }
});
