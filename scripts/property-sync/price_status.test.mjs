import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { diffPriceStatus, parseArgs } from "./price_status_diff.mjs";
import { lockedReport, validate28Capture } from "./price_status_locked.mjs";
import { collectDetails, detailIdentity, parseDetail } from "./propertyhk_detail_browser.mjs";
import { propertyhkDiff } from "./propertyhk_daily_diff.mjs";
const fixture = JSON.parse(
  await readFile(new URL("./tests/fixtures/t5-phase0.json", import.meta.url)),
);
const fresh = () => structuredClone(fixture);
const run = (f) => diffPriceStatus(f.capture, f.current, { now: f.now });

test("company number + deal distinguishes sale and rent and normalizes amounts", () => {
  const f = fresh(),
    report = run(f);
  assert.equal(report.counts["price-changed"], 1);
  assert.equal(report.counts["rent-changed"], 1);
  f.current.properties[0].price = "5000000.00";
  assert.equal(run(f).counts.unchanged, 1);
});
test("the real offline CLI completes without importing a DB adapter or accepting apply", async () => {
  const folder = await mkdtemp(join(tmpdir(), "t5-diff-"));
  try {
    const f = fresh();
    f.capture.scraped_at = f.current.exported_at = new Date(Date.now() - 1000).toISOString();
    await writeFile(join(folder, "capture.json"), JSON.stringify(f.capture));
    await writeFile(join(folder, "current.json"), JSON.stringify(f.current));
    const args = [
      "scripts/property-sync/price_status_diff.mjs",
      "--capture",
      join(folder, "capture.json"),
      "--current",
      join(folder, "current.json"),
      "--out",
      join(folder, "diff"),
    ];
    const result = spawnSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 10000,
      env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(join(folder, "diff.json"), "utf8"));
    assert.equal(report.counts["price-changed"], 1);
    assert.equal(report.production_writes, 0);
    const refused = spawnSync(process.execPath, [...args, "--apply", "true"], {
      encoding: "utf8",
      timeout: 10000,
      env: { PATH: process.env.PATH },
    });
    assert.equal(refused.status, 2);
    assert.equal(refused.stderr.trim(), "price_status_diff_failed");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test("staff field overrides hold prices and rent, including null overrides", () => {
  const f = fresh();
  f.current.properties[0].override_fields = ["price"];
  f.current.properties[1].override_fields = ["rent"];
  const report = run(f);
  assert.equal(report.counts["override-held"], 2);
  assert.ok(report.rows.every((r) => r.would_change.length === 0));
});
for (const reason of ["sold", "rented", "delisted"])
  test(`${reason} proposes only inactive plus reason`, () => {
    const f = fresh();
    f.capture.listings[0].source_status = "delisted";
    f.capture.listings[0].source_status_reason = reason;
    const row = run(f).rows.find((r) => r.category === reason);
    assert.deepEqual(row.would_change, [{ field: "status", old: "active", new: "inactive" }]);
    assert.equal(row.reason, reason);
  });
test("absence is report-only, unrelated source candidates are not absent", () => {
  const f = fresh();
  f.capture.listings = [];
  f.current.properties[1].source = null;
  const report = run(f);
  assert.equal(report.counts.delisted, 1);
  assert.equal(report.absence_enabled, false);
  assert.deepEqual(report.rows[0].would_change, []);
});
test("duplicates, missing references, review holds and unknown company refs are ambiguous", () => {
  for (const kind of ["candidate", "source", "missing", "new", "review"]) {
    const f = fresh();
    if (kind === "candidate")
      f.current.properties.push({ ...f.current.properties[0], id: "duplicate" });
    if (kind === "source") f.capture.listings.push({ ...f.capture.listings[0] });
    if (kind === "missing") delete f.capture.listings[0].agency_property_no;
    if (kind === "new") f.capture.listings[0].agency_property_no = "Z999999";
    if (kind === "review") f.current.properties[0].review_required = true;
    const report = run(f);
    assert.ok(report.counts["ambiguous-ref"] >= 1, kind);
    assert.ok(
      report.rows
        .filter((r) => r.category === "ambiguous-ref")
        .every((r) => !r.would_change.length),
    );
  }
});
test("36h is inclusive, older capture/detail/export suppresses proposals", () => {
  const f = fresh();
  f.now = "2026-10-30T00:00:00Z";
  assert.equal(run(f).stale, false);
  f.now = "2026-10-30T00:00:01Z";
  assert.equal(run(f).counts.stale, 2);
  const g = fresh();
  g.current.exported_at = "2026-10-25T00:00:00Z";
  assert.equal(run(g).counts.stale, 2);
  const h = fresh();
  h.capture.listings[0].captured_at = "2026-10-25T00:00:00Z";
  assert.equal(run(h).counts.stale, 1);
});
test("PII and arbitrary input fields cannot escape into report", () => {
  const f = fresh();
  Object.assign(f.capture.listings[0], {
    address: "PRIVATE ADDRESS",
    phone: "PRIVATE PHONE",
    description: "PRIVATE NOTES",
  });
  const text = JSON.stringify(run(f));
  assert.ok(!text.includes("PRIVATE"));
  assert.ok(!text.includes("A000001"));
  assert.deepEqual(
    [...new Set(run(f).rows.flatMap((r) => r.would_change.map((c) => c.field)))].sort(),
    ["price", "rent"],
  );
});
test("incomplete, malformed, future and invalid money fail closed", () => {
  const f = fresh();
  validate28Capture(f.capture);
  for (const change of [
    (c) => {
      c.meta.pages_failed = 1;
    },
    (c) => {
      c.meta.crawl_complete = false;
    },
    (c) => {
      c.meta.pages.pop();
    },
    (c) => {
      c.meta.pages[0].ids = ["wrong"];
    },
  ]) {
    const c = structuredClone(f.capture);
    change(c);
    assert.throws(() => validate28Capture(c));
  }
  f.capture.listings[0].price = "invalid";
  assert.throws(() => run(f));
  f.capture.listings[0].price = "2";
  f.capture.scraped_at = "2030-01-01T00:00:00Z";
  assert.throws(() => run(f));
  assert.throws(() => parseArgs(["--apply", "true"], ["capture", "current", "out"]));
});
test("read-only transaction waits on the exact MLS writer lock and always rolls back", async () => {
  const calls = [],
    f = fresh();
  f.capture.scraped_at = new Date().toISOString();
  const client = {
    connect: async () => calls.push("connect"),
    end: async () => calls.push("end"),
    query: async (sql) => {
      calls.push(sql);
      return { rows: f.current.properties };
    },
  };
  await assert.rejects(
    lockedReport(client, f.capture, async () => {
      throw Error("report_output_failed");
    }),
    /report_output_failed/,
  );
  assert.equal(calls[1], "BEGIN READ ONLY");
  assert.equal(calls[3], "SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
  assert.equal(calls.at(-2), "ROLLBACK");
  assert.equal(calls.at(-1), "end");
  assert.ok(calls.every((s) => !/\b(?:INSERT|UPDATE|DELETE|COMMIT)\b/.test(s)));
});
const detailUrl = "https://www.property.hk/asking_detail/eps/ruby/100.html";
const dom = {
  refs: ["物業編號：A000001", "物業編號 : A000001"],
  license: true,
  fields: [
    ["售價", "$500 萬"],
    ["出租價", "$20,000"],
  ],
  lifecycle: [],
};
test("Property.hk parses duplicate mobile/desktop fields and rejects identity/price conflict", () => {
  const detail = parseDetail(dom, detailUrl, fixture.capture.scraped_at);
  assert.equal(detail.price, "5000000");
  assert.equal(detail.rent, "20000");
  assert.throws(() => parseDetail({ ...dom, license: false }, detailUrl, fixture.now));
  assert.throws(() =>
    parseDetail({ ...dom, refs: [...dom.refs, "物業編號：B000001"] }, detailUrl, fixture.now),
  );
  assert.throws(() =>
    parseDetail({ ...dom, fields: [...dom.fields, ["售價", "$800 萬"]] }, detailUrl, fixture.now),
  );
  assert.throws(() => detailIdentity("https://elsewhere.test/asking_detail/100.html"));
});
function browserMock(sequence) {
  let time = 0,
    current = 0,
    handler,
    routeHandler,
    attempts = 0,
    closed = 0;
  const mainFrame = {},
    request = { isNavigationRequest: () => true, frame: () => mainFrame, url: () => detailUrl };
  const page = {
    mainFrame: () => mainFrame,
    url: () => detailUrl,
    on: (_name, cb) => {
      handler = cb;
    },
    goto: async () => {
      attempts++;
      await routeHandler({
        request: () => request,
        continue: async () => {},
        abort: async () => {},
      });
    },
    title: async () => {
      current = Math.min(Math.floor(time / 500), sequence.length - 1);
      handler({ status: () => sequence[current], request: () => request, frame: () => mainFrame });
      return sequence[current] === 403 ? "正在驗證您的瀏覽器" : "樓盤詳情";
    },
    evaluate: async () => (sequence[current] === 200 ? dom : { refs: [] }),
  };
  let launchOptions;
  const chromium = {
    launch: async (options) => {
      launchOptions = options;
      return {
        newContext: async () => ({
          route: async (_pattern, cb) => {
            routeHandler = cb;
          },
          newPage: async () => page,
          close: async () => {
            closed++;
          },
        }),
        close: async () => {
          closed++;
        },
      };
    },
  };
  return {
    chromium,
    executablePath: "/pinned/chromium",
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    inspect: () => ({ time, attempts, closed, launchOptions }),
  };
}
test("normal headless clears a transient challenge, uses pinned executable and closes context", async () => {
  const mock = browserMock([403, 403, 200]);
  const result = await collectDetails([detailUrl], mock);
  assert.equal(result.listings.length, 1);
  assert.equal(mock.inspect().launchOptions.headless, true);
  assert.equal(mock.inspect().launchOptions.executablePath, "/pinned/chromium");
  assert.equal(mock.inspect().closed, 2);
  assert.ok(mock.inspect().time >= 3000);
});
test("persistent challenge stops at 20s without retries; 429 stops immediately", async () => {
  for (const [sequence, error] of [
    [[403], /challenge_not_cleared/],
    [[429], /rate_limited/],
  ]) {
    const mock = browserMock(sequence);
    await assert.rejects(collectDetails([detailUrl], mock), error);
    assert.equal(mock.inspect().attempts, 1);
    assert.ok(mock.inspect().time <= 20000);
    assert.equal(mock.inspect().closed, 2);
  }
});
test("transient server failures have at most four attempts", async () => {
  const mock = browserMock([503]);
  await assert.rejects(collectDetails([detailUrl], mock), /attempts_exhausted/);
  assert.equal(mock.inspect().attempts, 4);
});
test("Property.hk requires detail confirmation and exact exported source links; holds overrides", () => {
  const f = fresh();
  f.current.properties.forEach((p) => {
    p.source = "propertyhk";
    p.source_ids = ["100"];
    p.override_fields = ["price"];
  });
  const index = {
    schema: "propertyhk-index/v1",
    complete: true,
    absence_enabled: false,
    scraped_at: f.capture.scraped_at,
    ads: [{ property_id: "100", detail_url: detailUrl, price: "5000000", rent: "20000" }],
  };
  const details = {
    schema: "propertyhk-details/v1",
    complete: true,
    absence_enabled: false,
    listings: [parseDetail(dom, detailUrl, f.capture.scraped_at)],
  };
  assert.equal(
    propertyhkDiff(index, f.current, details, { now: f.now }).counts["override-held"],
    1,
  );
  assert.throws(() => propertyhkDiff(index, f.current, { ...details, listings: [] }));
  const mismatch = structuredClone(details);
  mismatch.listings[0].price = "2";
  assert.throws(() => propertyhkDiff(index, f.current, mismatch));
  f.current.properties[0].source_ids = ["999"];
  assert.equal(
    propertyhkDiff(index, f.current, details, { now: f.now }).counts["ambiguous-ref"],
    1,
  );
});
