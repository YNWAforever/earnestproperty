import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from "@tanstack/react-router";

// F-04: TanStack Start's server load compares the requested URL with
// router.buildLocation(... _includeValidateSearch: true) and 307s to the
// canonical href when they differ (router-core load-server.ts). A schema with
// .default() values therefore turned a bare /listings into
// /listings?deal=all&sort=newest&page=1. stripSearchParams removes the defaults
// again, so the bare URL is its own canonical. This harness runs the exact same
// comparison against each route's real searchSchema.

const routesDir = fileURLToPath(new URL(".", import.meta.url));
const srcDir = join(routesDir, "..");

const defaults = await import("../lib/public-search-defaults.ts").catch(() => ({}));
const { LISTINGS_SEARCH_DEFAULTS, VIDEOS_SEARCH_DEFAULTS, TRANSACTIONS_SEARCH_DEFAULTS } = defaults;

function readRoute(file) {
  return readFileSync(join(routesDir, file), "utf8").replace(/\r\n/g, "\n");
}

// Same anchors as listings.contract.test.mjs: `const searchSchema = z.object({`
// up to its closing `});`, plus the consts the schema references.
function schemaFrom(file) {
  const source = readRoute(file);
  const start = source.indexOf("const searchSchema = z.object({");
  assert.notEqual(start, -1, `${file} declares searchSchema`);
  const end = source.indexOf("});", start) + "});".length;
  const prelude = [];
  for (const name of ["SORT_OPTIONS", "MONTH_PATTERN"]) {
    const match = source.match(new RegExp(`^const ${name} = [^\\n]*;$`, "m"));
    if (match) prelude.push(match[0]);
  }
  const snippet = `${prelude.join("\n")}\n${source.slice(start, end)}\nreturn searchSchema;`;
  const js = ts.transpileModule(snippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function("z", "fallback", js)(z, fallback);
}

const listingsSchema = schemaFrom("listings.tsx");
const videosSchema = schemaFrom("videos.tsx");
const transactionsSchema = schemaFrom("transactions.tsx");

function canonicalHref(href, schema, searchDefaults) {
  const pathname = href.split("?")[0];
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: pathname,
    validateSearch: zodValidator(schema),
    search: searchDefaults ? { middlewares: [stripSearchParams(searchDefaults)] } : undefined,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [href] }),
    isServer: true,
  });
  return router.buildLocation({
    to: pathname,
    search: true,
    params: true,
    hash: true,
    state: true,
    _includeValidateSearch: true,
  }).publicHref;
}

test("precondition: without the middleware, bare /listings canonicalises to ?deal=all&sort=newest&page=1", () => {
  assert.equal(
    canonicalHref("/listings", listingsSchema, null),
    "/listings?deal=all&sort=newest&page=1",
  );
});

test("bare /listings renders without redirect", () => {
  assert.equal(canonicalHref("/listings", listingsSchema, LISTINGS_SEARCH_DEFAULTS), "/listings");
});

test("bare /videos renders without redirect", () => {
  assert.equal(canonicalHref("/videos", videosSchema, VIDEOS_SEARCH_DEFAULTS), "/videos");
});

test("bare /transactions renders without redirect", () => {
  assert.equal(
    canonicalHref("/transactions", transactionsSchema, TRANSACTIONS_SEARCH_DEFAULTS),
    "/transactions",
  );
});

test("explicit defaults collapse to the bare URL in one hop", () => {
  const cases = [
    ["/listings?deal=all&page=1", "/listings", listingsSchema, LISTINGS_SEARCH_DEFAULTS],
    [
      "/listings?deal=all&sort=newest&page=1",
      "/listings",
      listingsSchema,
      LISTINGS_SEARCH_DEFAULTS,
    ],
    ["/videos?sort=newest", "/videos", videosSchema, VIDEOS_SEARCH_DEFAULTS],
    [
      "/transactions?dealType=all&page=1",
      "/transactions",
      transactionsSchema,
      TRANSACTIONS_SEARCH_DEFAULTS,
    ],
  ];
  for (const [href, expected, schema, searchDefaults] of cases) {
    assert.equal(canonicalHref(href, schema, searchDefaults), expected, href);
    // The target is a fixed point, so the redirect cannot loop.
    assert.equal(canonicalHref(expected, schema, searchDefaults), expected, `${expected} again`);
  }
});

test("non-default filters are kept", () => {
  const cases = [
    ["/listings?deal=sale", listingsSchema, LISTINGS_SEARCH_DEFAULTS],
    ["/listings?estate=bellagio", listingsSchema, LISTINGS_SEARCH_DEFAULTS],
    ["/listings?page=2", listingsSchema, LISTINGS_SEARCH_DEFAULTS],
    // Unknown keys (the old site's ?ln=) are carried through untouched, so the
    // live /listings?ln=sc 307 becomes a 200 rather than a loop.
    ["/listings?ln=sc", listingsSchema, LISTINGS_SEARCH_DEFAULTS],
    ["/transactions?dealType=rent&page=2", transactionsSchema, TRANSACTIONS_SEARCH_DEFAULTS],
    ["/videos?sort=oldest", videosSchema, VIDEOS_SEARCH_DEFAULTS],
  ];
  for (const [href, schema, searchDefaults] of cases) {
    assert.equal(canonicalHref(href, schema, searchDefaults), href, href);
  }
});

test("each public search route strips its defaults", () => {
  for (const [file, constant] of [
    ["listings.tsx", "LISTINGS_SEARCH_DEFAULTS"],
    ["videos.tsx", "VIDEOS_SEARCH_DEFAULTS"],
    ["transactions.tsx", "TRANSACTIONS_SEARCH_DEFAULTS"],
  ]) {
    const source = readRoute(file);
    assert.ok(
      source.includes(`middlewares: [stripSearchParams(${constant})]`),
      `${file} strips ${constant}`,
    );
  }
});

function walk(dir, extension) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full, extension));
    else if (name.endsWith(extension) && !name.includes(".test.")) files.push(full);
  }
  return files;
}

test("no internal link carries a default search param", () => {
  const files = [...walk(join(srcDir, "content"), ".ts"), ...walk(routesDir, ".tsx")];
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const [href] of source.matchAll(/\/(?:listings|transactions)\?[^"'`\s]*/g)) {
      if (/deal=all|dealType=all|sort=newest|[?&]page=1(?!\d)/.test(href)) {
        offenders.push(`${file.slice(srcDir.length)}: ${href}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
