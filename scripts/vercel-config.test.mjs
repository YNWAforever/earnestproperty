// Config tests for vercel.ts redirects. vercel.ts is loaded in a child process
// with a controlled env (never the developer's shell), and each redirect source
// is compiled the way Vercel compiles it: path-to-regexp 6.x with
// { strict: true, sensitive: true, delimiter: "/" } (@vercel/routing-utils
// sourceToRegex). `has` values are anchored regexes (^value$), as Vercel reads them.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { pathToRegexp } from "path-to-regexp";

const FALLBACK_HOST = "earnestproperty.vercel.app";
const WWW = "https://www.earnestproperty.com";
const PROD = { VERCEL_ENV: "production", VITE_SITE_URL: WWW };

const redirectCache = new Map();

// Child-process load of vercel.ts. Only PATH/SystemRoot are inherited, so a
// CANONICAL_HOST_REDIRECT_ENABLED or VITE_SITE_URL in the shell cannot leak in.
function loadRedirects(env) {
  const cacheKey = JSON.stringify(env);
  if (redirectCache.has(cacheKey)) return redirectCache.get(cacheKey);
  const childEnv = { PATH: process.env.PATH, ...env };
  if (process.env.SystemRoot) childEnv.SystemRoot = process.env.SystemRoot;
  const redirects = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--input-type=module",
        "-e",
        "import {config} from './vercel.ts'; console.log(JSON.stringify(config.redirects))",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: childEnv },
    ),
  );
  redirectCache.set(cacheKey, redirects);
  return redirects;
}

function compileSource(source) {
  const keys = [];
  const regex = pathToRegexp(source, keys, { strict: true, sensitive: true, delimiter: "/" });
  return { regex, keys };
}

function anchored(value) {
  return new RegExp(`^${value}$`);
}

// Returns the named groups of every matching condition, or null when one fails.
function conditionsHold(redirect, { host, query }) {
  const captures = {};
  for (const condition of redirect.has ?? []) {
    if (condition.type === "host") {
      const result = anchored(condition.value).exec(host);
      if (!result) return null;
      Object.assign(captures, result.groups);
    } else if (condition.type === "query") {
      if (!Object.hasOwn(query, condition.key)) return null;
      if (condition.value !== undefined) {
        const result = anchored(condition.value).exec(String(query[condition.key]));
        if (!result) return null;
        Object.assign(captures, result.groups);
      }
    } else {
      throw new Error(`unsupported has condition in test matcher: ${condition.type}`);
    }
  }
  for (const condition of redirect.missing ?? []) {
    if (condition.type === "host" && anchored(condition.value).test(host)) return null;
    if (condition.type === "query" && Object.hasOwn(query, condition.key)) return null;
  }
  return captures;
}

function substitute(destination, positional, named) {
  return destination
    .replace(/\$(\d+)/g, (_, index) => positional[Number(index)] ?? "")
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)[*+?]?/g, (whole, name) =>
      Object.hasOwn(named, name) ? (named[name] ?? "") : whole,
    );
}

// First redirect (Vercel order) whose source and every condition match.
function match(redirects, { host, path, query = {} }) {
  for (const redirect of redirects) {
    const { regex, keys } = compileSource(redirect.source);
    const result = regex.exec(path);
    if (!result) continue;
    const captures = conditionsHold(redirect, { host, query });
    if (!captures) continue;
    const named = { ...captures };
    keys.forEach((key, index) => {
      if (typeof key.name === "string") named[key.name] = result[index + 1];
    });
    // Vercel keeps the request query and appends the destination's own query
    // after it (production: /property/c5?x=1 -> /listings?x=1&deal=rent&page=1).
    const [destPath, destSearch = ""] = substitute(redirect.destination, result, named).split("?");
    const search = [new URLSearchParams(query).toString(), destSearch].filter(Boolean).join("&");
    const location = search ? `${destPath}?${search}` : destPath;
    return { status: redirect.permanent ? 308 : 307, location };
  }
  return null;
}

function hostRules(redirects) {
  return redirects.filter((redirect) => redirect.has?.some((h) => h.type === "host"));
}

// "api.admin.control-plane.jobs.$id.retry.ts" -> "/api/admin/control-plane/jobs/x/retry"
function apiRoutePaths() {
  return readdirSync("src/routes")
    .filter((file) => /^api\..+\.ts$/.test(file) && !/\.test\./.test(file))
    .map((file) => {
      const segments = file
        .replace(/\.ts$/, "")
        .replaceAll("[.]", "\u0000")
        .split(".")
        .map((segment) => segment.replaceAll("\u0000", "."))
        .filter((segment) => segment !== "index" && !segment.startsWith("_"))
        .filter((segment) => !/^\(.*\)$/.test(segment))
        .map((segment) => (segment === "$" ? "x/y" : segment.startsWith("$") ? "x" : segment))
        .map((segment) => segment.replace(/_$/, ""));
      return `/${segments.join("/")}`;
    });
}

function assertOneHostRule(redirects) {
  assert.equal(
    hostRules(redirects).length,
    1,
    "the production config must carry exactly one host rule, so exclusions are not vacuous",
  );
}

function assertNotRedirected(redirects, paths) {
  for (const path of paths) {
    assert.equal(
      match(redirects, { host: FALLBACK_HOST, path }),
      null,
      `${path} on ${FALLBACK_HOST} must not be redirected`,
    );
  }
}

test("host redirect excludes /api/woztell/webhook and /w/abc", () => {
  const redirects = loadRedirects(PROD);
  assertOneHostRule(redirects);
  assertNotRedirected(redirects, [
    "/api/woztell/webhook",
    "/api/admin/whatsapp/service-worker",
    "/api/admin/control-plane/worker",
    "/api/admin/propertyhk-sync",
    "/api/youtube-sync",
    "/api/mls-sync",
    "/w/abc",
    "/w/ABC123",
  ]);
});

test("host redirect excludes /_serverFn, bare /api and /.well-known", () => {
  const redirects = loadRedirects(PROD);
  assertOneHostRule(redirects);
  assertNotRedirected(redirects, [
    "/_serverFn/2240abc",
    "/_serverFn",
    "/api",
    "/api/",
    "/.well-known/vercel/x",
    "/.well-known",
  ]);
});

test("host redirect excludes /assets/* so open vercel.app tabs keep loading chunks", () => {
  const redirects = loadRedirects(PROD);
  assertOneHostRule(redirects);
  assertNotRedirected(redirects, [
    "/assets/x.js",
    "/assets/index-abc123.js",
    "/assets/img/logo.webp",
  ]);
});

test("host redirect keeps the request query string", () => {
  const redirects = loadRedirects(PROD);
  const [rule] = hostRules(redirects);
  // Shape: no query in the destination (so Vercel passes the caller's through)
  // and no query condition that could drop or rewrite it.
  assert.equal(rule.destination, `${WWW}/$1`);
  assert.ok(!rule.destination.includes("?"), "destination must not carry its own query");
  assert.equal(rule.has.length, 1);
  assert.equal(rule.missing, undefined);
  assert.deepEqual(
    match(redirects, { host: FALLBACK_HOST, path: "/listings", query: { keyword: "x" } }),
    { status: 308, location: `${WWW}/listings?keyword=x` },
  );
  assert.deepEqual(match(redirects, { host: FALLBACK_HOST, path: "/", query: { ln: "tc" } }), {
    status: 308,
    location: `${WWW}/?ln=tc`,
  });
});

test("every API route file is excluded from the host redirect", () => {
  const paths = apiRoutePaths();
  assert.ok(paths.length >= 25, `expected at least 25 API routes, found ${paths.length}`);
  assert.ok(paths.includes("/api/admin/control-plane/jobs/x/retry"));
  assert.ok(paths.includes("/api/woztell/webhook"));
  const redirects = loadRedirects(PROD);
  assertOneHostRule(redirects);
  assertNotRedirected(redirects, paths);
});

test("redirects / on the vercel.app host", () => {
  const redirects = loadRedirects(PROD);
  const cases = {
    "/": `${WWW}/`,
    "/listings": `${WWW}/listings`,
    "/estate/bellagio": `${WWW}/estate/bellagio`,
    "/property/A056377": `${WWW}/property/A056377`,
    "/wiki": `${WWW}/wiki`,
    "/apidocs": `${WWW}/apidocs`,
    "/w": `${WWW}/w`,
    "/_serverFnx": `${WWW}/_serverFnx`,
    "/.well-knownx": `${WWW}/.well-knownx`,
    "/xwell-known": `${WWW}/xwell-known`,
    "/assetsx": `${WWW}/assetsx`,
    "/assets": `${WWW}/assets`,
  };
  for (const [path, location] of Object.entries(cases)) {
    assert.deepEqual(
      match(redirects, { host: FALLBACK_HOST, path }),
      { status: 308, location },
      path,
    );
  }
});

test("host redirect never matches a preview or www host", () => {
  const rules = hostRules(loadRedirects(PROD));
  assert.equal(rules.length, 1);
  for (const host of [
    "earnestproperty-git-fix-fx-13-redirects-team.vercel.app",
    "earnestproperty-abc123def-team.vercel.app",
    "www.earnestproperty.com",
    "earnestproperty.com",
    "localhost",
    "localhost:3000",
    "127.0.0.1:3000",
  ]) {
    for (const path of ["/", "/listings"]) {
      assert.equal(match(rules, { host, path }), null, `${host}${path}`);
    }
  }
});

test("no host redirect outside production builds", () => {
  for (const env of [
    { VERCEL_ENV: "preview", VITE_SITE_URL: WWW },
    { VERCEL_ENV: "development", VITE_SITE_URL: WWW },
    { VITE_SITE_URL: WWW },
  ]) {
    assert.deepEqual(hostRules(loadRedirects(env)), [], JSON.stringify(env));
  }
});

test("no host redirect when the production origin is a vercel.app host", () => {
  assert.deepEqual(
    hostRules(
      loadRedirects({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "earnestproperty.vercel.app",
      }),
    ),
    [],
  );
});

test("the opt-in flag is gone", () => {
  assert.doesNotMatch(readFileSync("vercel.ts", "utf8"), /CANONICAL_HOST_REDIRECT_ENABLED/);
  assert.equal(
    hostRules(loadRedirects({ ...PROD, CANONICAL_HOST_REDIRECT_ENABLED: "false" })).length,
    1,
  );
});

test("the host rule is first", () => {
  assert.equal(loadRedirects(PROD)[0].has?.[0]?.type, "host");
});

// --- FX-13 Task 2 (L-04): legacy old-site redirects -------------------------

const WWW_HOST = "www.earnestproperty.com";

// The audit's 24 h 404 list (audit :150). Counts are the audit's, per path.
// No Vercel 404 export was available, so no .json/uppercase variants and no
// /eng seccode path are added: only what the audit shows.
const LEGACY_404_PATHS = [
  "/info_gallery.php", // 707
  "/qrcode_page.php", // 590
  "/eng/special_prop_st.php", // 987 incl. variants
  "/special_prop_detail.php", // 189
  "/seccode_enquiry/seccode.php", // 209 incl. /eng
  "/unlucky_detail.php", // 64
  "/vr.php", // 52
  "/m/property_detail.php", // 14
];

function nonHostRules(redirects) {
  return redirects.filter((redirect) => !redirect.has?.some((h) => h.type === "host"));
}

// "/castle-peak-road/$segment" -> /^\/castle-peak-road\/[^/]+$/
function fileRoutePatterns() {
  const source = readFileSync("src/routeTree.gen.ts", "utf8");
  const paths = new Set([...source.matchAll(/fullPath: '([^']+)'/g)].map((m) => m[1]));
  return [...paths].map((path) => {
    const pattern = path
      .split("/")
      .map((segment) =>
        segment.startsWith("$") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/");
    return { path, regex: new RegExp(`^${pattern}$`) };
  });
}

async function estateHasPage(slug) {
  const { getEstateEntry } = await import("../src/content/estate-registry.ts");
  try {
    return getEstateEntry(slug).hasPage;
  } catch {
    return false;
  }
}

test("every legacy path in the 24h 404 list has a redirect", () => {
  const rules = nonHostRules(loadRedirects(PROD));
  for (const path of LEGACY_404_PATHS) {
    assert.notEqual(match(rules, { host: WWW_HOST, path }), null, `${path} must redirect`);
    assert.notEqual(
      match(loadRedirects(PROD), { host: WWW_HOST, path }),
      null,
      `${path} on ${WWW_HOST} must redirect`,
    );
  }
  // The id rides along as a query: Vercel passes the request query through to a
  // destination that has none, and the /property-detail resolver ignores it.
  assert.deepEqual(
    match(rules, { host: WWW_HOST, path: "/special_prop_detail.php", query: { id: "6621030" } }),
    { status: 307, location: "/property-detail/6621030.html?id=6621030" },
  );
  assert.deepEqual(match(rules, { host: WWW_HOST, path: "/special_prop_detail.php" }), {
    status: 308,
    location: "/listings",
  });
  assert.deepEqual(
    match(rules, { host: WWW_HOST, path: "/m/property_detail.php", query: { id: "6621030" } }),
    { status: 307, location: "/property-detail/6621030.html?id=6621030" },
  );
  assert.deepEqual(match(rules, { host: WWW_HOST, path: "/m/property_detail.php" }), {
    status: 308,
    location: "/listings",
  });
  // A non-numeric id is not a legacy id: the permanent fallback takes it.
  assert.equal(
    match(rules, { host: WWW_HOST, path: "/special_prop_detail.php", query: { id: "abc" } })
      ?.status,
    308,
  );
});

test("every redirect destination is an existing route", async () => {
  const routes = fileRoutePatterns();
  const rules = nonHostRules(loadRedirects(PROD));
  assert.ok(rules.length > 20);
  for (const rule of rules) {
    const path = rule.destination.split("?")[0];
    if (path === "/") continue;
    if (path === "/property-detail/:oldId.html" || path === "/property-detail/:legacyId.html") {
      assert.ok(routes.some((route) => route.path === "/property-detail/$file"));
      continue;
    }
    const estate = /^\/estate\/([^/]+)$/.exec(path);
    if (estate) {
      assert.ok(await estateHasPage(estate[1]), `${rule.source} -> ${path}: estate has no page`);
      continue;
    }
    const segment = /^\/castle-peak-road\/([^/]+)$/.exec(path);
    if (segment) {
      const { getCastlePeakRoadSegment } = await import("../src/content/castle-peak-road.ts");
      assert.ok(getCastlePeakRoadSegment(segment[1]), `${rule.source} -> ${path}: unknown segment`);
      continue;
    }
    assert.ok(
      routes.some((route) => !route.path.includes("$") && route.regex.test(path)),
      `${rule.source} -> ${rule.destination}: no file route for ${path}`,
    );
  }
});

// A request that satisfies every `has` query condition of `rule`, or null when
// no sample value fits (or the source has parameters).
function satisfyingRequest(rule) {
  if (/[:(*]/.test(rule.source)) return null;
  const query = {};
  for (const condition of rule.has ?? []) {
    if (condition.type !== "query") return null;
    if (condition.value === undefined) {
      query[condition.key] = "1";
      continue;
    }
    const sample = ["tc", "sc", "123", "1", "x", ""].find((value) =>
      anchored(condition.value).test(value),
    );
    if (sample === undefined) return null;
    query[condition.key] = sample;
  }
  return { host: WWW_HOST, path: rule.source, query };
}

function splitLocation(location) {
  const [path, search = ""] = location.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(search)) };
}

test("legacy redirects have no duplicate sources and no chains", () => {
  const rules = nonHostRules(loadRedirects(PROD));
  const keys = rules.map((rule) => rule.source + JSON.stringify(rule.has ?? []));
  assert.equal(new Set(keys).size, keys.length, "duplicate source + has");
  for (const rule of rules) {
    const [path] = rule.destination.split("?");
    // /property-detail/:oldId.html is an app route, not a vercel rule.
    if (path.startsWith("/property-detail/")) {
      assert.ok(!rules.some((other) => other.source.startsWith("/property-detail/")));
      continue;
    }
    for (const other of rules) {
      if (other === rule || other.has) continue;
      assert.notEqual(path, other.source, `${rule.source} -> ${path} chains into ${other.source}`);
    }
    // Carry the request query through (Vercel merges it into the destination),
    // and include the rule itself, so a self-redirect is caught too.
    const request = satisfyingRequest(rule);
    assert.ok(request, `${rule.source}: no sample request satisfies its conditions`);
    const first = match(rules, request);
    assert.ok(first, `${rule.source}: sample request does not match`);
    const next = match(rules, { host: WWW_HOST, ...splitLocation(first.location) });
    assert.equal(next, null, `${rule.source} -> ${first.location} redirects again`);
  }
});

test("no redirect loops when the request query is preserved", () => {
  const rules = nonHostRules(loadRedirects(PROD));
  const conditional = rules.filter((rule) => rule.has?.some((h) => h.type === "query"));
  assert.ok(conditional.length > 0, "expected query-conditioned rules to check");
  for (const rule of conditional) {
    const request = satisfyingRequest(rule);
    assert.ok(request, `${rule.source}: no sample request satisfies its conditions`);
    const seen = new Set();
    let current = request;
    let hops = 0;
    for (;;) {
      const key = `${current.path}?${new URLSearchParams(current.query)}`;
      assert.ok(!seen.has(key), `${rule.source}: redirect loop at ${key}`);
      seen.add(key);
      const result = match(rules, current);
      if (!result) break;
      hops += 1;
      assert.ok(hops <= 2, `${rule.source}: chain longer than 2 hops (at ${result.location})`);
      current = { host: WWW_HOST, ...splitLocation(result.location) };
    }
  }
});

test("old /property redirects point at the bare listings URL", () => {
  const rules = nonHostRules(loadRedirects(PROD));
  for (const rule of rules) {
    assert.doesNotMatch(rule.destination, /deal=all/, rule.source);
    assert.doesNotMatch(rule.destination, /page=1/, rule.source);
  }
  for (const path of ["/property", "/property/", "/property/c1", "/property/c1/", "/property/c2"]) {
    assert.deepEqual(match(rules, { host: WWW_HOST, path }), {
      status: 308,
      location: "/listings",
    });
  }
  for (const path of ["/property/c5", "/property/c5/"]) {
    assert.deepEqual(match(rules, { host: WWW_HOST, path }), {
      status: 308,
      location: "/listings?deal=rent",
    });
  }
});

test("mortgage.php reaches the mortgage page", () => {
  assert.deepEqual(match(loadRedirects(PROD), { host: WWW_HOST, path: "/mortgage.php" }), {
    status: 308,
    location: "/mortgage",
  });
});
