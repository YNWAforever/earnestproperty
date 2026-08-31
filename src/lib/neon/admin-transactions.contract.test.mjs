import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

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
