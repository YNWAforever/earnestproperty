import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

// admin-data.server.ts (unlike public-data.server.ts, whose harness this was
// originally modeled on) pulls in a much deeper module graph -- ai/*.server.ts,
// woztell/woztell.server.ts, admin-workflow.ts, command-center.ts, etc -- via
// extensionless relative specifiers that only a bundler (Vite) resolves. A
// data: URL module has no directory of its own, so it can neither walk "../"
// above itself nor resolve bare npm specifiers (both were tried and both throw
// under plain `node --test`). Instead: transpile the whole reachable graph to
// real .mjs files inside a throwaway directory under src/lib/neon/ (so
// node_modules resolution still finds the project's real node_modules by
// walking up), rewriting every relative specifier -- static and dynamic -- to
// point at its sibling's compiled copy. Only db.server.ts is special-cased: a
// stub replaces it everywhere so every real SQL call in the graph is captured,
// with no live Neon connection required. Nothing here changes the exported
// behavior under test -- it only makes admin-data.server.ts's REAL exports
// loadable in isolation.

const root = process.cwd();
const NEON_DIR = join(root, "src/lib/neon");
const DB_SERVER_PATH = join(NEON_DIR, "db.server.ts");
const ENTRY_PATH = join(NEON_DIR, "admin-data.server.ts");
const TMP_DIR = join(NEON_DIR, ".admin-transactions-contract-tmp");

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const SRC_DIR = join(root, "src");

// Resolves both real relative specifiers ("./x", "../x") and the "@/*" -> "./src/*"
// tsconfig path alias (tsconfig.json's compilerOptions.paths) that several files in
// this graph use instead of a relative import (e.g. ai/knowledge.server.ts imports
// db.server via "@/lib/neon/db.server"). A bundler resolves both; plain `node --test`
// resolves neither on its own.
function resolveModuleSpecifier(fromDir, spec) {
  const baseDir = spec.startsWith("@/") ? SRC_DIR : fromDir;
  const specPath = spec.startsWith("@/") ? spec.slice(2) : spec;
  const candidates = EXTS.some((ext) => specPath.endsWith(ext))
    ? [specPath]
    : EXTS.map((ext) => specPath + ext);
  for (const candidate of candidates) {
    const abs = resolve(baseDir, candidate);
    if (existsSync(abs)) return abs;
  }
  return null;
}

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

// db.server.ts's real getSql() opens a live Neon connection; this stub
// reimplements every helper admin-data.server.ts (and anything it pulls in)
// imports from it, but backs getSql()/queryRows() with the test's recorder
// via a global so every real SQL string + param array this module builds is
// observable with no live database.
const DB_SERVER_STUB = `
export function getSql() {
  return { query: (...args) => globalThis.__adminTransactionsContractQuery(...args) };
}
export async function queryRows(statement, params = []) {
  return await getSql().query(statement, params);
}
export async function transactionRows(statements, options = {}) {
  const sql = getSql();
  return sql.transaction(
    (tx) => statements.map(({ statement, params = [] }) => tx.query(statement, params)),
    options,
  );
}
export function addParam(params, value) {
  params.push(value);
  return \`$\${params.length}\`;
}
export function stringOrNull(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}
export function stringOrEmpty(value) {
  return stringOrNull(value) ?? "";
}
export function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
export function booleanOrFalse(value) {
  return value === true;
}
export function dateOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
export function textArrayOrNull(value) {
  if (!Array.isArray(value)) return null;
  return value.map(String);
}
`;

const tempPathFor = (absPath) =>
  join(TMP_DIR, `m_${createHash("sha1").update(absPath).digest("hex").slice(0, 16)}.mjs`);

const processed = new Map(); // absPath -> tempPath, memoized so shared deps are only written once

function rewriteSpecifiers(source, fromDir) {
  const rewriteOne = (whole, spec) => {
    const target = resolveModuleSpecifier(fromDir, spec);
    if (!target) return whole; // best-effort: leave anything we can't resolve untouched
    const targetTemp = ensureProcessed(target);
    const rel = `./${relative(TMP_DIR, targetTemp).replace(/\\/g, "/")}`;
    return whole.replace(spec, rel);
  };
  return source
    .replace(/import\(\s*"(\.\.?\/[^"]+|@\/[^"]+)"\s*\)/g, rewriteOne)
    .replace(/from\s+"(\.\.?\/[^"]+|@\/[^"]+)"/g, rewriteOne);
}

function ensureProcessed(absPath) {
  const existing = processed.get(absPath);
  if (existing) return existing;
  const tempPath = tempPathFor(absPath);
  processed.set(absPath, tempPath); // reserve before recursing, in case of import cycles

  let source;
  if (absPath === DB_SERVER_PATH) {
    source = DB_SERVER_STUB;
  } else {
    const raw = readFileSync(absPath, "utf8").replace(
      /import\s+"@tanstack\/react-start\/server-only";?\n?/g,
      "",
    );
    const js = absPath.endsWith(".ts") || absPath.endsWith(".tsx") ? transpile(raw) : raw;
    source = rewriteSpecifiers(js, dirname(absPath));
  }

  writeFileSync(tempPath, source, "utf8");
  return tempPath;
}

after(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

function recorder() {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params: params ?? [] });
    return [];
  };
  return { calls, query };
}

async function loadAdminDataServerWithInjectedQuery(query) {
  globalThis.__adminTransactionsContractQuery = query;
  mkdirSync(TMP_DIR, { recursive: true });
  const entryTempPath = ensureProcessed(ENTRY_PATH);
  return import(pathToFileURL(entryTempPath).href);
}

const AGENT_ACTOR = { staffId: "agent-1", roles: ["agent"] };
const ADMIN_ACTOR = { staffId: "admin-1", roles: ["admin"] };

test("listAdminTransactions scopes an agent to their own rows, admin sees all", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.listAdminTransactions({}, AGENT_ACTOR);
  assert.match(calls[0].text, /t\.agent_id = \$1/);
  assert.deepEqual(calls[0].params, ["agent-1"]);

  await server.listAdminTransactions({}, ADMIN_ACTOR);
  assert.doesNotMatch(calls[1].text, /t\.agent_id = \$1/);
});

test("saveAdminTransaction computes and stores saleable_psf from price/saleable_area", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: "Test Agent",
      source_url: null,
      verified: false,
    },
    AGENT_ACTOR,
  );

  const call = calls[0];
  assert.match(call.text, /INSERT INTO transactions/);
  assert.ok(call.params.includes(20_000), "saleable_psf should be price / saleable_area = 20000");
});

test("saveAdminTransaction rejects invalid numeric and publication inputs before SQL", async () => {
  const base = {
    estate_id: "estate-1",
    deal_type: "sale",
    price: 10_000_000,
    saleable_area: 500,
    deal_date: "2026-08-01",
    unit: null,
    block: null,
    floor_band: null,
    source: null,
    source_url: null,
    verified: false,
  };
  for (const change of [
    { price: 0 },
    { price: -1 },
    { price: Number.POSITIVE_INFINITY },
    { price: Number.NaN },
    { saleable_area: 0 },
    { saleable_area: -1 },
    { saleable_area: 500.5 },
    { saleable_area: Number.NaN },
    { saleable_area: Number.POSITIVE_INFINITY },
    { verified: "false" },
    { verified: 1 },
  ]) {
    const { calls, query } = recorder();
    const server = await loadAdminDataServerWithInjectedQuery(query);
    await assert.rejects(
      server.saveAdminTransaction({ ...base, ...change }, AGENT_ACTOR),
      (error) => error instanceof Response && error.status === 400,
    );
    assert.equal(calls.length, 0, "invalid input reached SQL");
  }
});

test("saveAdminTransaction attributes a new (INSERT) transaction to whoever creates it", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: false,
    },
    AGENT_ACTOR,
  );

  assert.match(calls[0].text, /INSERT INTO transactions/);
  assert.ok(
    calls[0].params.includes("agent-1"),
    "agent_id param should be the acting agent's own id",
  );
});

test("saveAdminTransaction never reassigns agent_id on UPDATE, even when a manager edits an agent's transaction", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      id: "txn-1",
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: false,
    },
    { staffId: "manager-1", roles: ["manager"] },
  );

  assert.match(calls[0].text, /UPDATE transactions/);
  assert.doesNotMatch(
    calls[0].text,
    /agent_id\s*=\s*\$/,
    "agent_id must never appear in the UPDATE SET clause",
  );
  assert.ok(
    !calls[0].params.includes("manager-1"),
    "the editing manager's own id must never be written as agent_id",
  );
});

test("the verified checkbox sets BOTH verification_state='verified' and published=true, never independently", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: true,
    },
    ADMIN_ACTOR,
  );

  const call = calls[0];
  assert.ok(call.params.includes("verified"), "verification_state param should be 'verified'");
  assert.ok(call.params.includes(true), "published param should be true");
});

test("unverified (default) leaves verification_state='unverified' and published=false", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: false,
    },
    ADMIN_ACTOR,
  );

  const call = calls[0];
  assert.ok(call.params.includes("unverified"));
  assert.ok(call.params.includes(false));
});

test("getAdminTransaction adds an agent_id scope predicate for a scoped agent, not for admin/manager", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.getAdminTransaction("txn-1", AGENT_ACTOR);
  assert.match(calls[0].text, /agent_id = \$2/);
  assert.deepEqual(calls[0].params, ["txn-1", "agent-1"]);
});

test("saveAdminProperty rejects invalid public listing values before SQL", async () => {
  const base = {
    listing_no: "A-1",
    title_zh: "Test listing",
    title_en: null,
    deal_type: "sale",
    estate_id: null,
    district_slug: "central",
    address: null,
    price: 10_000_000,
    rent: null,
    saleable_area: 500,
    bedrooms: 2,
    bathrooms: 1,
    floor: null,
    description: null,
    features: [],
    status: "active",
    featured: false,
    images: [],
    agent_id: null,
  };
  for (const change of [
    { listing_no: "" },
    { title_zh: " " },
    { district_slug: "" },
    { deal_type: "other" },
    { status: "published" },
    { images: "not-an-array" },
    { features: "not-an-array" },
    { price: -1 },
    { price: Number.POSITIVE_INFINITY },
    { rent: -1 },
    { saleable_area: -1 },
    { saleable_area: 500.5 },
    { bedrooms: -1 },
    { bedrooms: 21 },
    { bathrooms: 21 },
    { featured: "false" },
  ]) {
    const { calls, query } = recorder();
    const server = await loadAdminDataServerWithInjectedQuery(query);
    await assert.rejects(
      server.saveAdminProperty({ ...base, ...change }, ADMIN_ACTOR),
      (error) => error instanceof Response && error.status === 400,
    );
    assert.equal(calls.length, 0, "invalid property input reached SQL");
  }

  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);
  await server.saveAdminProperty(
    { ...base, price: null, rent: 0, saleable_area: 0, bedrooms: 0, bathrooms: 0 },
    ADMIN_ACTOR,
  );
  assert.match(calls[0].text, /INSERT INTO properties/);
});

test("saveAdminCmsVideo rejects invalid title, order and publication flag before SQL", async () => {
  const base = {
    title: "Video tour",
    video_url: "https://youtu.be/dQw4w9WgXcQ",
    description: null,
    sort_order: 0,
    published: false,
    category: null,
  };
  for (const change of [
    { title: "" },
    { title: "  " },
    { sort_order: Number.NaN },
    { sort_order: 1.5 },
    { published: "false" },
  ]) {
    const { calls, query } = recorder();
    const server = await loadAdminDataServerWithInjectedQuery(query);
    await assert.rejects(
      server.saveAdminCmsVideo({ ...base, ...change }, ADMIN_ACTOR),
      (error) => error instanceof Response && error.status === 400,
    );
    assert.equal(calls.length, 0, "invalid CMS video input reached SQL");
  }

  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);
  await server.saveAdminCmsVideo(base, ADMIN_ACTOR);
  assert.match(calls[0].text, /INSERT INTO cms_videos/);
});

test("updateAdminLead rejects invalid budgets before CRM SQL", async () => {
  const base = {
    id: "lead-1",
    stage: "contacted",
    intent: "buyer",
    budget_min: null,
    budget_max: null,
    preferred_estates: [],
    assigned_agent_id: null,
    note: null,
  };
  for (const budget of [
    { budget_min: -1, budget_max: 100 },
    { budget_min: 200, budget_max: 100 },
    { budget_min: 0, budget_max: -1 },
    { budget_min: Number.POSITIVE_INFINITY, budget_max: null },
  ]) {
    const { calls, query } = recorder();
    const server = await loadAdminDataServerWithInjectedQuery(query);
    await assert.rejects(
      server.updateAdminLead({ ...base, ...budget }, ADMIN_ACTOR),
      (error) => error instanceof Response && error.status === 400,
    );
    assert.equal(calls.length, 0);
  }
});

test("updateAdminLead keeps a valid budget in its CRM update", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);
  const result = await server.updateAdminLead(
    {
      id: "lead-1",
      stage: "contacted",
      intent: "buyer",
      budget_min: 0,
      budget_max: 100,
      preferred_estates: [],
      assigned_agent_id: null,
      note: null,
    },
    ADMIN_ACTOR,
  );
  assert.deepEqual(result, { ok: false, error: "Not found" });
  assert.match(calls[0].text, /UPDATE crm_leads SET/);
  assert.equal(calls[0].params[2], 0);
  assert.equal(calls[0].params[3], 100);
});

test("verified performance blocks silent base price, date, deal type or provenance rewrites", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);
  await server.saveAdminTransaction(
    {
      id: "txn-1",
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10000000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: true,
    },
    ADMIN_ACTOR,
  );
  assert.match(calls[0].text, /transaction_performance performance/);
  assert.match(calls[0].text, /transactions\.price IS DISTINCT FROM \$3::numeric/);
  assert.match(calls[0].text, /transactions\.deal_date IS DISTINCT FROM \$6::date/);
  assert.match(calls[0].text, /transactions\.deal_type IS DISTINCT FROM \$2::deal_type/);
});

test("blocked base transaction edit reports a conflict instead of not found", async () => {
  const calls = [];
  const server = await loadAdminDataServerWithInjectedQuery(async (statement, params) => {
    calls.push({ statement, params });
    return /SELECT id FROM transactions WHERE id/.test(statement) ? [{ id: "txn-1" }] : [];
  });
  await assert.rejects(
    server.saveAdminTransaction(
      {
        id: "txn-1",
        estate_id: "estate-1",
        deal_type: "sale",
        price: 10000000,
        saleable_area: 500,
        deal_date: "2026-08-01",
        unit: null,
        block: null,
        floor_band: null,
        source: null,
        source_url: null,
        verified: true,
      },
      ADMIN_ACTOR,
    ),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.equal(calls.length, 2);
});

test("source verification can stay private while public publication remains off", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);
  await server.saveAdminTransaction(
    {
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10000000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: true,
      published: false,
    },
    ADMIN_ACTOR,
  );
  assert.equal(calls[0].params[11], "verified");
  assert.equal(calls[0].params[12], false);
  assert.match(calls[0].text, /CASE WHEN \$12::transaction_verification_state = 'verified'/);
});

test("attribution filters use server actor scope and reject agent request forgery", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);
  await assert.rejects(
    server.listAdminTransactions({ attribution_status: "missing" }, AGENT_ACTOR),
    (error) => error instanceof Response && error.status === 403,
  );
  assert.equal(calls.length, 0);
  await server.listAdminTransactions(
    { attribution_status: "verified_unattributed" },
    { staffId: "manager-1", roles: ["manager"] },
  );
  assert.match(calls[0].text, /finance_manager\.id=\$1::uuid/);
  assert.match(calls[0].text, /perf\.attribution_status = \$2/);
  assert.deepEqual(calls[0].params, ["manager-1", "verified_unattributed"]);
});

test("embedded DB hides cross-branch finance status and filters only visible transactions", async () => {
  const db = new PGlite();
  const branchA = "00000000-0000-4000-8000-000000000011";
  const branchB = "00000000-0000-4000-8000-000000000012";
  const manager = "00000000-0000-4000-8000-000000000013";
  const agentA = "00000000-0000-4000-8000-000000000014";
  const agentB = "00000000-0000-4000-8000-000000000015";
  const txA = "00000000-0000-4000-8000-000000000016";
  const txB = "00000000-0000-4000-8000-000000000017";
  try {
    await db.exec(`CREATE TYPE deal_type AS ENUM ('sale','rent');
      CREATE TYPE transaction_verification_state AS ENUM ('unverified','pending','verified');
      CREATE TABLE staff_users(id uuid PRIMARY KEY,branch_id uuid,name_zh text,name_en text);
      CREATE TABLE estates(id uuid PRIMARY KEY,name_zh text);
      CREATE TABLE transactions(id uuid PRIMARY KEY,estate_id uuid,deal_type deal_type,price numeric,
        saleable_area integer,saleable_psf numeric,deal_date date,unit text,block text,floor_band text,
        source text,source_url text,verification_state transaction_verification_state,
        published boolean,agent_id uuid,created_at timestamptz DEFAULT now());
      CREATE TABLE transaction_performance(transaction_id uuid PRIMARY KEY,attribution_status text);`);
    await db.query(
      "INSERT INTO staff_users(id,branch_id,name_zh) VALUES ($1,$4,'Manager'),($2,$4,'A'),($3,$5,'B')",
      [manager, agentA, agentB, branchA, branchB],
    );
    await db.query(
      "INSERT INTO transactions(id,deal_type,verification_state,published,agent_id) VALUES ($1,'sale','verified',false,$3),($2,'rent','verified',false,$4)",
      [txA, txB, agentA, agentB],
    );
    await db.query(
      "INSERT INTO transaction_performance(transaction_id,attribution_status) VALUES ($1,'verified_attributed'),($2,'verified_unattributed')",
      [txA, txB],
    );
    const server = await loadAdminDataServerWithInjectedQuery(
      async (statement, params = []) => (await db.query(statement, params)).rows,
    );
    const rows = await server.listAdminTransactions({}, { staffId: manager, roles: ["manager"] });
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.id === txA).attribution_status, "verified_attributed");
    assert.equal(rows.find((row) => row.id === txB).attribution_status, null);
    assert.equal(rows.find((row) => row.id === txB).finance_visible, false);
    const filtered = await server.listAdminTransactions(
      { attribution_status: "verified_unattributed" },
      { staffId: manager, roles: ["manager"] },
    );
    assert.equal(filtered.length, 0);
    const agentRows = await server.listAdminTransactions({}, { staffId: agentA, roles: ["agent"] });
    assert.equal(agentRows.length, 1);
    assert.equal(agentRows[0].attribution_status, null);
  } finally {
    await db.close();
  }
});
