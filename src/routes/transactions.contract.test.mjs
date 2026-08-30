import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Source-scan regression tests for /transactions -- this repo has no render
// harness for TanStack routes (same rationale as listings.contract.test.mjs
// and SiteHeader.contract.test.mjs), so these assert against the raw source
// text, plus a couple of small pure-function extractions that are actually
// executed rather than just pattern-matched.
const source = await readFile(new URL("./transactions.tsx", import.meta.url), "utf8");

function transpileAndRun(snippet, exportNames) {
  const { outputText } = ts.transpileModule(snippet, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exportsObj = {};
  new Function("exports", outputText)(exportsObj);
  return exportNames.length === 1
    ? exportsObj[exportNames[0]]
    : exportNames.map((n) => exportsObj[n]);
}

function loadBuildActiveFilterChips() {
  // Spans DISTRICT_LABELS through DEAL_TYPE_LABELS -- both live between these
  // two anchors, so a single slice avoids extracting DEAL_TYPE_LABELS twice.
  const labelsBlock = source.slice(
    source.indexOf("const DISTRICT_LABELS"),
    source.indexOf("type DealTypeFilter"),
  );
  const chipsBlock = source.slice(
    source.indexOf("function buildActiveFilterChips("),
    source.indexOf("function FilterChip("),
  );
  const snippet = [labelsBlock, chipsBlock, "export { buildActiveFilterChips };\n"].join("\n");
  return transpileAndRun(snippet, ["buildActiveFilterChips"]);
}

// --- Zod search schema -------------------------------------------------

test("the search schema exposes estate/district/dealType/month/price-range filters plus the tx share param", () => {
  const schemaBody = source.slice(
    source.indexOf("const searchSchema = z.object({"),
    source.indexOf("});", source.indexOf("const searchSchema = z.object({")) + 2,
  );
  for (const field of ["district", "estate", "dealType", "month", "minPrice", "maxPrice", "tx"]) {
    assert.match(schemaBody, new RegExp(`${field}:`), `expected search schema field "${field}"`);
  }
  // dealType defaults to "all", mirroring listings.tsx's deal filter default.
  assert.match(
    schemaBody,
    /dealType: fallback\(z\.enum\(\["all", "sale", "rent"\]\), "all"\)\.default\("all"\)/,
  );
});

test("validateSearch wires the Zod schema via the same zodValidator adapter listings.tsx uses", () => {
  assert.match(source, /import \{ zodValidator, fallback \} from "@tanstack\/zod-adapter";/);
  assert.match(source, /validateSearch: zodValidator\(searchSchema\)/);
});

// --- loader wiring -------------------------------------------------------

test("the loader forwards every filter param to fetchRecentTransactions and also loads estate options", () => {
  const loaderBody = source.slice(
    source.indexOf("loader: async ({ deps }) => {"),
    source.indexOf("},", source.indexOf("loader: async ({ deps }) => {")),
  );
  assert.match(loaderBody, /districtSlug: deps\.district/);
  assert.match(loaderBody, /estateSlug: deps\.estate/);
  assert.match(loaderBody, /dealType: deps\.dealType/);
  assert.match(loaderBody, /month: deps\.month/);
  assert.match(loaderBody, /minPrice: deps\.minPrice/);
  assert.match(loaderBody, /maxPrice: deps\.maxPrice/);
  assert.match(loaderBody, /fetchEstateOptions\(\)/);
  assert.match(source, /return \{ transactions, estates \};/);
});

test("loaderDeps excludes tx -- sharing/highlighting a row must not force a reload", () => {
  const depsBody = source.slice(
    source.indexOf("loaderDeps: ({ search }) => ({"),
    source.indexOf("}),", source.indexOf("loaderDeps: ({ search }) => ({")),
  );
  assert.doesNotMatch(depsBody, /\btx\b/);
});

// --- noindex / sitemap-exclusion behaviour under the new, stricter empty
// condition (empty because nothing is published+verified, not just because
// the table is empty) -------------------------------------------------------

test("head() noindexes whenever the filtered transactions array is empty", () => {
  const headBody = source.slice(
    source.indexOf("head: ({ loaderData }) => ({"),
    source.indexOf("component: TransactionsPage,"),
  );
  assert.match(headBody, /loaderData\.transactions\.length === 0/);
  assert.match(headBody, /name: "robots", content: "noindex,follow"/);
  assert.match(headBody, /canonicalLink\("\/transactions"\)/);
});

// --- deal_type column ------------------------------------------------------

test("the results table renders a 類型 column populated from transaction.deal_type", () => {
  assert.match(source, /<th className="px-4 py-3 font-medium">類型<\/th>/);
  assert.match(source, /\{DEAL_TYPE_LABELS\[transaction\.deal_type\]\}/);
});

// --- DataNote / EmptyState (established shared components) -----------------

test("a real result set cites source + verification date via the shared DataNote component", () => {
  assert.match(source, /import \{ DataNote \} from "@\/components\/layout\/DataNote";/);
  assert.match(source, /<DataNote/);
  const dataNoteBody = source.slice(
    source.indexOf("<DataNote"),
    source.indexOf("/>", source.indexOf("<DataNote")),
  );
  assert.match(dataNoteBody, /source={sources\.length > 0 \? sources\.join/);
  assert.match(dataNoteBody, /asOf={latestVerifiedAt/);
  assert.match(dataNoteBody, /caveat=/);
});

test("the empty state uses the shared EmptyState component, not a bespoke inline card", () => {
  assert.match(source, /import \{ EmptyState \} from "@\/components\/layout\/EmptyState";/);
  assert.match(source, /<EmptyState/);
  // The old bespoke empty-state markup (a raw <div> card with its own icon
  // and copy) must be gone, not left duplicated alongside the shared one.
  assert.doesNotMatch(source, /<ReceiptText className="mx-auto h-8 w-8 text-coral" \/>/);
});

// --- filters wire to real, shareable URL search params ---------------------

test("active-filter chips are built from non-default search params, one chip per param", () => {
  assert.match(source, /function buildActiveFilterChips\(/);
  for (const key of ["district", "estate", "dealType", "month", "minPrice", "maxPrice"]) {
    assert.match(source, new RegExp(`key:\\s*"${key}"`), `expected a chip descriptor for "${key}"`);
  }
});

test("buildActiveFilterChips only flags dealType once it differs from the default 'all'", () => {
  const buildActiveFilterChips = loadBuildActiveFilterChips();
  const base = {
    district: undefined,
    estate: undefined,
    dealType: "all",
    month: undefined,
    minPrice: undefined,
    maxPrice: undefined,
  };
  assert.deepEqual(
    buildActiveFilterChips(base, []).map((c) => c.key),
    [],
  );
  assert.deepEqual(
    buildActiveFilterChips({ ...base, dealType: "sale" }, []).map((c) => c.key),
    ["dealType"],
  );
});

test("each filter chip removes only its own param via a search merge function, not a whole-object replace", () => {
  const chipBody = source.slice(
    source.indexOf("function FilterChip("),
    source.indexOf("function handleTransactionShare("),
  );
  assert.match(chipBody, /search={\(prev: Record<string, unknown>\) => {/);
  assert.match(chipBody, /const next: Record<string, unknown> = { \.\.\.prev };/);
  assert.match(chipBody, /delete next\[key\];/);
});

test("apply() sends every panel filter field, and reset() clears back to the schema default", () => {
  const applyBody = source.slice(
    source.indexOf("function apply()"),
    source.indexOf("function reset()"),
  );
  for (const field of ["district", "estate", "month", "minPrice", "maxPrice"]) {
    assert.match(applyBody, new RegExp(`${field}:`), `apply() must send "${field}"`);
  }
  // dealType is forwarded via object-shorthand (`dealType,`), not `dealType:
  // dealType` -- the other fields above are transformed (e.g. "all" -> undefined)
  // so they can't use shorthand, but this one is sent as-is.
  assert.match(applyBody, /\bdealType,/, 'apply() must send "dealType"');
  assert.match(source, /function reset\(\) \{\s*navigate\(\{ search: \{ dealType: "all" \} \}\);/);
});

// --- ?tx=<id> shareable per-transaction reference ---------------------------

test("a tx search param highlights and scrolls to the matching row", () => {
  assert.match(source, /const highlightedId = search\.tx;/);
  assert.match(source, /document\s*\n?\s*\.getElementById\(`tx-\$\{highlightedId\}`\)/);
  assert.match(source, /id={`tx-\$\{transaction\.id\}`}/);
  assert.match(source, /highlighted={transaction\.id === highlightedId}/);
});

test("each row has a share action that builds a ?tx=<id> URL via the shared shareUrl helper", () => {
  assert.match(source, /import \{ shareUrl \} from "@\/lib\/share";/);
  assert.match(source, /function handleTransactionShare\(/);
  assert.match(source, /url\.searchParams\.set\("tx", transaction\.id\);/);
  assert.match(source, /void shareUrl\(/);
});

// --- filter fields reuse the shared Select/Input/Label primitives, mirroring
// /listings' established shape rather than a bespoke filter UI -------------

test("filter fields are built from the same shadcn Select/Input/Label primitives listings.tsx uses", () => {
  assert.match(source, /from "@\/components\/ui\/select"/);
  assert.match(source, /from "@\/components\/ui\/input"/);
  assert.match(source, /from "@\/components\/ui\/label"/);
  assert.match(source, /function TransactionFilterFields\(/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /role="radio"/);
});
