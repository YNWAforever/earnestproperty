import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

// Same harness as listing-search.contract.test.mjs: public-data.server.ts is
// loaded as a data: URL module with getSql() stubbed to a recorder, so these
// tests exercise the REAL exported transaction query functions -- and
// therefore the real SQL string and param array each one builds -- without a
// live Neon connection or exporting the WHERE-builders themselves as new
// public surface.

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
  globalThis.__transactionSearchContractQuery = query;
  const dbUrl = dataUrl(
    "export const getSql = () => ({ query: (...args) => globalThis.__transactionSearchContractQuery(...args) });",
  );
  const executable = inlineRelativeImports(
    transpile(read("src/lib/neon/public-data.server.ts"))
      .replace('import "@tanstack/react-start/server-only";', "")
      .replace('from "./db.server"', `from "${dbUrl}"`),
    "src/lib/neon",
  );

  return import(dataUrl(executable));
}

/** Records every statement issued; returns shapes the mapper accepts. */
function recorder() {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params: params ?? [] });
    return [];
  };
  return { calls, query };
}

async function runRecent(input) {
  const { calls, query } = recorder();
  const server = await importPublicDataServerWithInjectedQuery(query);
  await server.fetchRecentTransactions(input);
  assert.equal(calls.length, 1, "fetchRecentTransactions issues exactly one query");
  return calls[0];
}

// --- fetchRecentTransactions (the /transactions route's own query) --------

test("fetchRecentTransactions always filters on published=true AND verification_state='verified'", async () => {
  const call = await runRecent({ limit: 24 });
  assert.match(call.text, /t\.published = true/);
  assert.match(call.text, /t\.verification_state = 'verified'/);
});

test("the published/verified predicates are unconditional -- present even with every optional filter unset", async () => {
  const call = await runRecent({ limit: 24 });
  assert.match(call.text, /WHERE t\.published = true AND t\.verification_state = 'verified'/);
  assert.deepEqual(call.params, [24]);
});

test("districtSlug and estateSlug become bound predicates, not interpolated literals", async () => {
  const call = await runRecent({
    districtSlug: "sham-tseng",
    estateSlug: "bellagio",
    limit: 10,
  });
  assert.match(call.text, /e\.district_slug = \$1/);
  assert.match(call.text, /e\.slug = \$2/);
  assert.deepEqual(call.params, ["sham-tseng", "bellagio", 10]);
  assert.doesNotMatch(call.text, /sham-tseng|bellagio/);
});

test("dealType='all' adds no deal_type predicate; a real deal type is bound and cast", async () => {
  const all = await runRecent({ dealType: "all", limit: 10 });
  // t.deal_type is always in the SELECT column list (the UI renders a 類型
  // column regardless of filter) -- the assertion below is scoped to the
  // predicate FORM ("t.deal_type = $"), not the bare column name, which
  // would false-positive on that unconditional SELECT entry.
  assert.doesNotMatch(all.text, /t\.deal_type = \$/);
  assert.deepEqual(all.params, [10]);

  const sale = await runRecent({ dealType: "sale", limit: 10 });
  assert.match(sale.text, /t\.deal_type = \$1::deal_type/);
  assert.deepEqual(sale.params, ["sale", 10]);

  const rent = await runRecent({ dealType: "rent", limit: 10 });
  assert.match(rent.text, /t\.deal_type = \$1::deal_type/);
  assert.deepEqual(rent.params, ["rent", 10]);
});

test("a valid month bounds deal_date to that calendar month, both ends bound parameters", async () => {
  const call = await runRecent({ month: "2026-03", limit: 10 });
  assert.match(call.text, /t\.deal_date >= \$1::date/);
  assert.match(call.text, /t\.deal_date < \(\$2::date \+ INTERVAL '1 month'\)/);
  assert.deepEqual(call.params, ["2026-03-01", "2026-03-01", 10]);
});

test("a malformed month is silently ignored rather than reaching the date cast", async () => {
  for (const month of ["2026-13", "26-03", "not-a-month", "2026-3"]) {
    const call = await runRecent({ month, limit: 10 });
    // t.deal_date is always in the SELECT column list and the ORDER BY, so
    // this is scoped to the predicate FORMS (">= $"/"< (") rather than the
    // bare column name.
    assert.doesNotMatch(
      call.text,
      /t\.deal_date >= \$|t\.deal_date < \(/,
      `month="${month}" must add no predicate`,
    );
    assert.deepEqual(call.params, [10], `month="${month}" must add no bound parameter`);
  }
});

test("minPrice/maxPrice become bound comparisons against t.price", async () => {
  const call = await runRecent({ minPrice: 5_000_000, maxPrice: 8_000_000, limit: 10 });
  assert.match(call.text, /t\.price >= \$1/);
  assert.match(call.text, /t\.price <= \$2/);
  assert.deepEqual(call.params, [5_000_000, 8_000_000, 10]);
});

test("the limit is clamped to [1, 100] and always the final bound parameter", async () => {
  const tooHigh = await runRecent({ limit: 5000 });
  assert.equal(tooHigh.params.at(-1), 100);

  const tooLow = await runRecent({ limit: 0 });
  assert.equal(tooLow.params.at(-1), 1);
});

test("every optional filter stays a bound parameter, including an injection attempt", async () => {
  const call = await runRecent({
    districtSlug: "sham-tseng' OR 1=1 --",
    estateSlug: "bellagio",
    limit: 10,
  });
  assert.doesNotMatch(call.text, /OR 1=1/);
  assert.ok(call.params.includes("sham-tseng' OR 1=1 --"));
});

test("fetchRecentTransactions selects t.id (needed for the ?tx=<id> share/highlight reference)", async () => {
  const call = await runRecent({ limit: 10 });
  assert.match(call.text, /SELECT[\s\S]*?t\.id,/);
});

test("results are ordered newest-deal-first with a stable tiebreaker", async () => {
  const call = await runRecent({ limit: 10 });
  assert.match(call.text, /ORDER BY t\.deal_date DESC NULLS LAST, t\.created_at DESC/);
});

// --- fetchDistrictTransactions / fetchEstateTransactions -------------------
//
// Both existing queries (district.sham-tseng.tsx's price-trend chart,
// castle-peak-road.index.tsx's segment snapshot, estate.$slug.tsx's PSF
// trend) must gain the same published/verified gate fetchRecentTransactions
// above already carries -- these are regression tests proving Task 2 did not
// touch only the one query it happened to build new UI around.

test("fetchDistrictTransactions filters on published=true AND verification_state='verified'", async () => {
  const { calls, query } = recorder();
  const server = await importPublicDataServerWithInjectedQuery(query);
  await server.fetchDistrictTransactions({ districtSlug: "sham-tseng", monthsBack: 12 });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.match(call.text, /t\.published = true/);
  assert.match(call.text, /t\.verification_state = 'verified'/);
  // The pre-existing sale-only scope for this chart must survive untouched.
  assert.match(call.text, /t\.deal_type = 'sale'/);
});

test("fetchEstateTransactions filters on published=true AND verification_state='verified'", async () => {
  const { calls, query } = recorder();
  const server = await importPublicDataServerWithInjectedQuery(query);
  await server.fetchEstateTransactions({ estateId: "estate-1", limit: 8 });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.match(call.text, /published = true/);
  assert.match(call.text, /verification_state = 'verified'/);
  assert.match(call.text, /deal_type = 'sale'/);
});

// --- migration + registration ----------------------------------------------

test("the transaction provenance migration exists, is idempotent, and adds every column the plan specifies", () => {
  const path = "neon/migrations/20260830140000_transaction_provenance.sql";
  assert.ok(existsSync(join(root, path)), "transaction provenance migration must exist");
  const sql = read(path);

  assert.match(sql, /CREATE TYPE transaction_verification_state AS ENUM/);
  assert.match(sql, /'unverified', 'pending', 'verified'/);
  for (const column of [
    "source TEXT",
    "source_url TEXT",
    "verification_state transaction_verification_state NOT NULL DEFAULT 'unverified'",
    "verified_at TIMESTAMPTZ",
    "agent_id UUID REFERENCES staff_users\\(id\\)",
    "published BOOLEAN NOT NULL DEFAULT false",
    "block TEXT",
    "floor_band TEXT",
    "social_state TEXT",
  ]) {
    assert.match(
      sql,
      new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`),
      `expected column: ${column}`,
    );
  }
  assert.doesNotMatch(sql, /ALTER TABLE transactions\s+ADD COLUMN(?! IF NOT EXISTS)/);
  assert.doesNotMatch(sql, /CREATE INDEX(?! IF NOT EXISTS)/);
});

test("the transaction provenance migration is registered in migration-versions.js", () => {
  const versions = read("src/lib/control-plane/migration-versions.js");
  assert.match(versions, /"20260830140000_transaction_provenance\.sql"/);
});
