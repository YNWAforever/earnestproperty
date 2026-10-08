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
    return {
      status: redirect.permanent ? 308 : 307,
      location: substitute(redirect.destination, result, named),
    };
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
