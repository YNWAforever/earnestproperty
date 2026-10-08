import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { CSP_ENFORCED, CSP_REPORT_ONLY, SECURITY_HEADERS } from "./vercel-headers.mjs";

// Exact for these sources: plain regex groups, no path-to-regexp named params.
function match(source, path) {
  return new RegExp("^" + source + "$").test(path);
}

function headersFor(path) {
  const merged = new Map();
  for (const rule of SECURITY_HEADERS) {
    if (!match(rule.source, path)) continue;
    for (const { key, value } of rule.headers) merged.set(key.toLowerCase(), value);
  }
  return merged;
}

function directives(policy) {
  const map = new Map();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

// Tiny host-source matcher: scheme-only (`https:`), `*.` prefix, or exact host.
function allows(sources, url) {
  const target = new URL(url);
  return sources.some((source) => {
    if (source === target.protocol) return true;
    if (!source.includes("://")) return false;
    const [scheme, host] = source.split("://");
    if (`${scheme}:` !== target.protocol) return false;
    if (host.startsWith("*.")) return target.hostname.endsWith(host.slice(1));
    return target.hostname === host;
  });
}

test("vercel.ts exposes SECURITY_HEADERS as config.headers", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      "import {config} from './vercel.ts'; console.log(JSON.stringify(config.headers));",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(output), SECURITY_HEADERS);
});

test("every path including /api and /w gets nosniff and frame-ancestors", () => {
  for (const path of [
    "/",
    "/admin",
    "/admin/leads",
    "/api/woztell/webhook",
    "/api/admin/control-plane/worker",
    "/w/abc",
    "/assets/index-x.js",
    "/property/C007232",
  ]) {
    const headers = headersFor(path);
    assert.equal(headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(headers.get("x-frame-options"), "DENY", path);
    assert.equal(headers.get("content-security-policy"), "frame-ancestors 'none'", path);
    assert.equal(
      headers.get("permissions-policy"),
      "camera=(), microphone=(), geolocation=()",
      path,
    );
  }
});

test("only frame-ancestors is enforced; the full policy is report-only", () => {
  assert.equal(CSP_ENFORCED, "frame-ancestors 'none'");
  const setters = SECURITY_HEADERS.flatMap((rule) =>
    rule.headers.filter((h) => h.key.toLowerCase() === "content-security-policy"),
  );
  assert.deepEqual(setters, [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }]);
  assert.equal(headersFor("/").get("content-security-policy-report-only"), CSP_REPORT_ONLY);
});

test("tracked links keep their own no-referrer", () => {
  for (const path of ["/w/abc", "/w/ABC123"]) {
    assert.equal(headersFor(path).has("referrer-policy"), false, path);
  }
  for (const path of ["/", "/wiki", "/api/x"]) {
    assert.equal(headersFor(path).get("referrer-policy"), "strict-origin-when-cross-origin", path);
  }
});

test("report-only policy allows every third-party origin the site loads", () => {
  const csp = directives(CSP_REPORT_ONLY);
  const fixtures = {
    "frame-src": [
      "https://www.youtube.com/embed/x",
      "https://www.google.com/maps?q=22.37,114.07&z=16&output=embed",
      "https://my.matterport.com/show/?m=x",
      "https://kuula.co/post/x",
      "https://vercel.live/_next-live/feedback/feedback.html",
    ],
    "script-src": [
      "https://www.googletagmanager.com/gtag/js?id=G-X",
      "https://vercel.live/_next-live/feedback/feedback.js",
    ],
    "connect-src": [
      "https://ep-divine-frost-aokzrg7f.neonauth.c-2.ap-southeast-1.aws.neon.tech/neondb/auth/get-session",
      "https://region1.google-analytics.com/g/collect",
      "wss://ws-us3.pusher.com/app/x",
    ],
    "img-src": [
      "https://i.ytimg.com/vi/x/hqdefault.jpg",
      "https://imgs.property.hk/a.jpg",
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/a.jpg",
      "https://i1.28hse.com/a.jpg",
    ],
    "style-src": ["https://vercel.live/a.css"],
    "font-src": ["https://vercel.live/a.woff2", "https://assets.vercel.com/a.woff2"],
  };
  for (const [directive, urls] of Object.entries(fixtures)) {
    const sources = csp.get(directive);
    assert.ok(sources, `${directive} is missing`);
    for (const url of urls) assert.ok(allows(sources, url), `${directive} blocks ${url}`);
  }
  // Hydration and JSON-LD are inline <script>; chart.tsx injects an inline <style>.
  assert.ok(csp.get("script-src").includes("'unsafe-inline'"));
  assert.ok(csp.get("style-src").includes("'unsafe-inline'"));
  assert.ok(csp.get("font-src").includes("data:"));
});

test("report-only policy keeps object-src none, base-uri self and form-action self", () => {
  const csp = directives(CSP_REPORT_ONLY);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("base-uri"), ["'self'"]);
  assert.deepEqual(csp.get("form-action"), ["'self'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(csp.get("default-src"), ["'self'"]);
});

test("no HSTS override (D9)", () => {
  for (const rule of SECURITY_HEADERS) {
    for (const { key } of rule.headers) {
      assert.notEqual(key.toLowerCase(), "strict-transport-security");
    }
  }
});
