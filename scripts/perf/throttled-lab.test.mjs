import assert from "node:assert/strict";
import test from "node:test";
import {
  TARGETS,
  evaluateTargets,
  parseLabArgs,
  redactShare,
  shouldBlock,
} from "./throttled-lab.mjs";

test("targets are home 4000, listings 4000, property 3500 ms", () => {
  assert.deepEqual({ ...TARGETS }, { home: 4000, listings: 4000, property: 3500 });
  assert.ok(Object.isFrozen(TARGETS));
});

test("evaluateTargets takes the median of three runs and fails a page with no LCP", () => {
  const rows = [
    ...[3000, 9000, 3900].map((lcp) => ({ page: "home", lcp })),
    ...[5000, 3000, 4100].map((lcp) => ({ page: "listings", lcp })),
    ...[3400, null, 3500].map((lcp) => ({ page: "property", lcp })),
  ];
  const byPage = Object.fromEntries(evaluateTargets(rows).map((r) => [r.page, r]));
  assert.deepEqual(byPage.home, { page: "home", medianLcp: 3900, target: 4000, pass: true });
  assert.equal(byPage.listings.medianLcp, 4100);
  assert.equal(byPage.listings.pass, false);
  // A missing run is dropped, not counted as zero: median of 3400 and 3500.
  assert.equal(byPage.property.medianLcp, 3450);
  assert.equal(byPage.property.pass, true);
  const none = evaluateTargets([{ page: "home", lcp: null }]);
  assert.deepEqual(
    none.find((r) => r.page === "home"),
    {
      page: "home",
      medianLcp: null,
      target: 4000,
      pass: false,
    },
  );
  // A page with no result at all fails too.
  assert.equal(none.find((r) => r.page === "property").pass, false);
});

test("parseLabArgs defaults to production and the audit's three pages", () => {
  const a = parseLabArgs([]);
  assert.equal(a.base, "https://www.earnestproperty.com");
  assert.equal(a.property, "T027001");
  assert.equal(a.runs, 3);
  assert.equal(a.share, null);
  assert.match(a.out, /^\.cache\/perf\/throttled-\d{8}T\d{6}Z\.json$/);
  const b = parseLabArgs([
    "--base=https://x.vercel.app/",
    "--property=T1",
    "--runs=5",
    "--out=.cache/a.json",
    "--share=https://x.vercel.app/?_vercel_share=abc",
  ]);
  assert.equal(b.base, "https://x.vercel.app");
  assert.equal(b.property, "T1");
  assert.equal(b.runs, 5);
  assert.equal(b.out, ".cache/a.json");
  assert.equal(b.share, "https://x.vercel.app/?_vercel_share=abc");
});

test("parseLabArgs rejects a non-https base and a runs value outside 1..10", () => {
  for (const bad of [
    "--base=http://www.earnestproperty.com",
    "--base=not a url",
    "--runs=0",
    "--runs=11",
    "--runs=x",
  ])
    assert.throws(() => parseLabArgs([bad]), TypeError, bad);
  assert.throws(() => parseLabArgs(["--share=http://x.vercel.app/"]), TypeError);
});

test("parseLabArgs rejects an out path outside the workspace", () => {
  for (const bad of [
    "--out=../x.json",
    "--out=/tmp/x.json",
    "--out=C:\\x.json",
    "--out=a/../../x.json",
    "--out=package.json",
    "--out=scripts/x.json",
  ])
    assert.throws(() => parseLabArgs([bad]), TypeError, bad);
});

test("the lab blocks api, w, admin, non-GET and wa.me requests", () => {
  const site = "https://www.earnestproperty.com";
  const cases = [
    [`${site}/`, "GET", false],
    [`${site}/listings?deal=sale`, "GET", false],
    [`${site}/assets/app.js`, "GET", false],
    [`${site}/api/leads`, "GET", true],
    [`${site}/w/abc123`, "GET", true],
    [`${site}/admin`, "GET", true],
    [`${site}/admin/leads`, "GET", true],
    [`${site}/_serverFn/abc`, "POST", true],
    [`${site}/`, "POST", true],
    [`${site}/`, "PUT", true],
    ["https://wa.me/85212345678", "GET", true],
    ["https://api.whatsapp.com/send", "GET", true],
    ["https://x.vercel.app/_vercel/insights/event", "GET", true],
    ["https://x.vercel.app/_vercel/speed-insights/vitals", "GET", true],
    ["https://www.google-analytics.com/g/collect?v=2", "GET", true],
    ["https://fonts.gstatic.com/a.woff2", "GET", false],
    [`${site}/apix`, "GET", false],
  ];
  for (const [url, method, blocked] of cases)
    assert.equal(shouldBlock(url, method), blocked, `${method} ${url}`);
});

test("redactShare removes the share link and token from error text", () => {
  const share = "https://x.vercel.app/?_vercel_share=SECRETTOKEN123";
  const text = `page.goto: Timeout navigating to "${share}" token SECRETTOKEN123 ${encodeURIComponent(share)}`;
  const cleaned = redactShare(text, share);
  assert.doesNotMatch(cleaned, /SECRETTOKEN123/);
  assert.doesNotMatch(cleaned, /_vercel_share=SEC/);
  assert.equal(redactShare("plain", null), "plain");
});
