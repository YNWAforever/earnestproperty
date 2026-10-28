import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
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

test("T5 scheduled reports stay opt-in and expose only the manual dispatch trigger", async () => {
  const { load } = createRequire(import.meta.url)("js-yaml");
  const workflow = load(
    await readFile(
      new URL("../../.github/workflows/property-price-status-sync.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.equal(
    workflow.jobs.report.if,
    "github.event_name == 'workflow_dispatch' || vars.PRICE_STATUS_SYNC_ENABLED == 'true'",
  );
  assert.deepEqual(
    workflow.jobs.report.steps.flatMap((s) =>
      Object.keys(s.env ?? {}).filter((key) => key.endsWith("DATABASE_URL")),
    ),
    ["PRICE_STATUS_SYNC_READONLY_DATABASE_URL"],
  );
});

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
test("offline properties remain valid comparison targets without reactivation", () => {
  const f = fresh();
  f.current.properties[0].status = "offline";
  const report = run(f);
  assert.equal(report.counts["price-changed"], 1);
  assert.ok(report.rows.every((r) => r.would_change.every((c) => c.field !== "status")));
});
test("unnumbered linked Property.hk targets are held without aborting other comparisons", () => {
  const f = fresh();
  f.current.properties.forEach((p, i) => {
    p.source = "propertyhk";
    p.source_ids = [f.capture.listings[i].property_id];
  });
  f.current.properties[0].canonical_property_no = null;
  const report = diffPriceStatus(f.capture, f.current, { now: f.now, source: "propertyhk" });
  assert.equal(report.counts["ambiguous-ref"], 2);
  assert.equal(report.counts["rent-changed"], 1);
  assert.ok(
    report.rows.filter((r) => r.category === "ambiguous-ref").every((r) => !r.would_change.length),
  );
});
test("SQL export holds manual and unknown ownership as well as overrides and drift", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    // Disposable in-memory tables only; no migration files or external connection.
    await db.exec(`
      CREATE TABLE properties (id text, canonical_property_no text, deal_type text,
        price numeric, rent numeric, status text);
      CREATE TABLE property_source_links (property_id text, source text, status text,
        external_listing_id text);
      CREATE TABLE property_public_members (property_id text, public_listing_no text);
      CREATE TABLE property_public_groups (public_listing_no text, review_required boolean);
      CREATE TABLE admin_property_overrides (property_no text, shared jsonb, sale jsonb, rent jsonb);
      CREATE TABLE property_sync_fields (property_id text, field_name text,
        active_override boolean, selection_reason text, last_published_value jsonb,
        winning_observation_id text);
      INSERT INTO properties VALUES ('sale', 'A000001', 'sale', 5100000, NULL, 'offline');
      INSERT INTO property_sync_fields VALUES
        ('sale', 'price', false, 'source_priority', '5100000', NULL),
        ('sale', 'status', false, 'source_priority', '"offline"', 'authorized');
    `);
    const sql = await readFile(new URL("./price_status_export.sql", import.meta.url), "utf8");
    const exported = async () => (await db.query(sql, ["28hse_agent_540"])).rows[0];
    assert.deepEqual((await exported()).override_fields, ["price"]);
    await db.exec("DELETE FROM property_sync_fields WHERE field_name='price'");
    assert.deepEqual((await exported()).override_fields, ["price"]);
    await db.exec(`INSERT INTO property_sync_fields VALUES
      ('sale', 'price', false, 'source_priority', '5100000', 'authorized')`);
    assert.deepEqual((await exported()).override_fields, []);
    // The ingestion adapter persists PostgreSQL numeric values as JSON strings.
    // Decimal scale and JSON number/string representation are not staff drift.
    for (const baseline of ['"5100000"', '"05100000.0000"', "5100000.00"]) {
      await db.query(
        "UPDATE property_sync_fields SET last_published_value=$1::jsonb WHERE field_name='price'",
        [baseline],
      );
      const property = await exported();
      assert.deepEqual(property.override_fields, [], baseline);
      const f = fresh();
      const report = diffPriceStatus(
        f.capture,
        { exported_at: f.current.exported_at, properties: [property] },
        { now: f.now },
      );
      assert.equal(report.counts["price-changed"], 1, baseline);
    }
    for (const update of [
      "active_override=true",
      "selection_reason='manual_override'",
      "last_published_value='5000000'",
    ]) {
      await db.exec("UPDATE property_sync_fields SET " + update + " WHERE field_name='price'");
      assert.ok((await exported()).override_fields.includes("price"));
      await db.exec(`UPDATE property_sync_fields SET active_override=false,
        selection_reason='source_priority', last_published_value='5100000' WHERE field_name='price'`);
    }
    await db.exec(`INSERT INTO property_public_members VALUES ('sale', 'A000001');
      INSERT INTO admin_property_overrides VALUES ('A000001', '{}', '{"price":null}', '{}')`);
    assert.deepEqual((await exported()).override_fields, ["price"]);
    await db.exec(`INSERT INTO properties VALUES ('rent', 'A000001', 'rent', NULL, 19000, 'active');
      INSERT INTO property_sync_fields VALUES
        ('rent', 'rent', false, 'source_priority', '"19000.0000"', 'authorized'),
        ('rent', 'status', false, 'source_priority', '"active"', 'authorized')`);
    const f = fresh();
    const report = diffPriceStatus(
      f.capture,
      {
        exported_at: f.current.exported_at,
        properties: (await db.query(sql, ["28hse_agent_540"])).rows,
      },
      { now: f.now },
    );
    assert.equal(report.counts["rent-changed"], 1);
    assert.equal(report.counts["override-held"], 1);
    for (const baseline of ['"19000.0001"', '"invalid"', "{}", "null"]) {
      await db.query(
        "UPDATE property_sync_fields SET last_published_value=$1::jsonb WHERE field_name='rent'",
        [baseline],
      );
      const rent = (await db.query(sql, ["28hse_agent_540"])).rows.find((p) => p.id === "rent");
      assert.deepEqual(rent.override_fields, ["rent"], baseline);
    }
  } finally {
    await db.close();
  }
});
test("SQL export retains proposed and rejected source identities as comparison holds", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE properties (id text, canonical_property_no text, deal_type text,
        price numeric, rent numeric, status text);
      CREATE TABLE property_source_links (property_id text, source text, status text,
        external_listing_id text);
      CREATE TABLE property_public_members (property_id text, public_listing_no text);
      CREATE TABLE property_public_groups (public_listing_no text, review_required boolean);
      CREATE TABLE admin_property_overrides (property_no text, shared jsonb, sale jsonb, rent jsonb);
      CREATE TABLE property_sync_fields (property_id text, field_name text,
        active_override boolean, selection_reason text, last_published_value jsonb,
        winning_observation_id text);
      INSERT INTO properties VALUES
        ('sale', 'A000001', 'sale', 5100000, NULL, 'active'),
        ('unnumbered', NULL, 'sale', 7000000, NULL, 'active');
      INSERT INTO property_sync_fields VALUES
        ('sale', 'price', false, 'source_priority', '5100000', 'authorized'),
        ('sale', 'status', false, 'source_priority', '"active"', 'authorized');
    `);
    const sql = await readFile(new URL("./price_status_export.sql", import.meta.url), "utf8");
    const f = fresh();
    f.capture.listings = [f.capture.listings[0]];
    const report = async () =>
      diffPriceStatus(
        f.capture,
        {
          exported_at: f.current.exported_at,
          properties: (await db.query(sql, ["28hse_agent_540"])).rows,
        },
        { now: f.now },
      );
    assert.equal((await report()).counts["price-changed"], 1);
    for (const status of ["proposed", "rejected"]) {
      for (const propertyId of ["sale", "unnumbered"]) {
        await db.exec("DELETE FROM property_source_links");
        await db.query(
          "INSERT INTO property_source_links VALUES ($1, '28hse_agent_540', $2, '100')",
          [propertyId, status],
        );
        const held = await report();
        assert.equal(held.counts["price-changed"], 0, `${status}/${propertyId}`);
        assert.equal(held.counts["ambiguous-ref"], 1, `${status}/${propertyId}`);
        assert.ok(held.rows.every((r) => r.would_change.length === 0));
      }
    }
    // A rejected historical ad does not hold a different, unblocked ad's proposal.
    await db.exec("UPDATE property_source_links SET property_id='sale', external_listing_id='old'");
    assert.equal((await report()).counts["price-changed"], 1);
  } finally {
    await db.close();
  }
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
test("unreviewed native source conflicts hold price, rent and terminal proposals", () => {
  for (const deal of ["sale", "rent"])
    for (const terminal of [false, true]) {
      const f = fresh();
      const observed = f.capture.listings.find((r) => r.deal_type === deal);
      const field = deal === "sale" ? "price" : "rent";
      observed.raw_payload = {
        source_conflicts: [
          {
            field,
            dom: observed[field],
            json_ld: "6000000",
            resolution: "dom",
            status: "review",
          },
        ],
      };
      if (terminal) {
        observed.source_status = "delisted";
        observed.source_status_reason = deal === "sale" ? "sold" : "rented";
      }
      validate28Capture(f.capture);
      const report = run(f);
      assert.equal(report.counts["ambiguous-ref"], 1, `${deal}/${terminal}`);
      const held = report.rows.find((r) => r.category === "ambiguous-ref");
      assert.equal(held.reason, "source_conflict_requires_review");
      assert.deepEqual(held.would_change, []);
      assert.equal(report.rows.flatMap((r) => r.would_change).length, 1);
      observed.raw_payload.source_conflicts = [];
      assert.equal(run(f).counts["ambiguous-ref"], 0);
    }
});
test("zero source quotes never propose replacing a current price or rent", () => {
  for (const [i, field] of [
    [0, "price"],
    [1, "rent"],
  ])
    for (const zero of [0, "0", "000.0000"]) {
      const f = fresh();
      f.capture.listings[i][field] = zero;
      validate28Capture(f.capture);
      assert.throws(() => run(f), /invalid_amount/, `${field}/${zero}`);
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
test("Property.hk scales fractional WAN quotes exactly without floating-point rejection", () => {
  for (const [quote, amount] of [
    ["$100.04萬", "1000400"],
    ["$100.07萬", "1000700"],
  ]) {
    const detail = parseDetail(
      {
        ...dom,
        fields: [
          ["售價", quote],
          ["租金", "$20,000.00"],
        ],
      },
      detailUrl,
      fixture.capture.scraped_at,
    );
    assert.equal(detail.price, amount);
    assert.equal(detail.rent, "20000");
  }
  for (const quote of ["$100.00001萬", "$0萬", "$900719925475萬"])
    assert.throws(
      () => parseDetail({ ...dom, fields: [["售價", quote]] }, detailUrl, fixture.now),
      /detail_amount_invalid/,
    );
});
test("Property.hk terminal labels in the amount cell preserve inactive reasons without a numeric quote", () => {
  for (const [label, reason] of [
    ["已售", "sold"],
    ["已租", "rented"],
    ["已撤盤", "delisted"],
    ["已下架", "delisted"],
  ]) {
    const detail = parseDetail(
      { ...dom, fields: [["售價", label]], lifecycle: [label] },
      detailUrl,
      fixture.capture.scraped_at,
    );
    assert.equal(detail.source_status, "delisted");
    assert.equal(detail.source_status_reason, reason);
    assert.equal(detail.price, null);
  }
});
for (const [fields, lifecycle] of [
  [
    [
      ["售價", "$500 萬"],
      ["出租價", "已租"],
    ],
    ["已租"],
  ],
  [
    [
      ["售價", "已售"],
      ["出租價", "$20,000"],
    ],
    ["已售"],
  ],
])
  test(`a terminal offer cannot mark the other quoted deal inactive (${lifecycle[0]})`, () => {
    assert.throws(
      () => parseDetail({ ...dom, fields, lifecycle }, detailUrl, fixture.capture.scraped_at),
      /mixed_terminal_offers/,
    );
  });
function browserMock(
  sequence,
  {
    late429 = false,
    closing429 = false,
    requests = [],
    extraPageRequest = false,
    socket = false,
  } = {},
) {
  let time = 0,
    current = 0,
    handler,
    contextHandler,
    requestHandler,
    routeHandler,
    socketHandler,
    attempts = 0,
    closed = 0;
  const mainFrame = { page: () => page },
    request = { isNavigationRequest: () => true, frame: () => mainFrame, url: () => detailUrl };
  const sent = [];
  const paused = (id, resourceType = "Document", url = detailUrl) => ({
    requestId: id,
    resourceType,
    frameId: "main",
    request: { url },
  });
  const respond = (code) => {
    const response = { status: () => code, request: () => request, frame: () => mainFrame };
    contextHandler(response);
    handler(response);
  };
  const page = {
    mainFrame: () => mainFrame,
    url: () => detailUrl,
    on: (_name, cb) => {
      handler = cb;
    },
    goto: async () => {
      attempts++;
      await requestHandler(paused("navigation-" + attempts));
      if (routeHandler)
        await routeHandler({
          request: () => ({ frame: () => mainFrame }),
          abort: async () => {
            throw Error("main_page_blocked");
          },
          fallback: async () => {},
        });
      if (extraPageRequest && routeHandler)
        await routeHandler({
          request: () => ({
            frame: () => {
              if (extraPageRequest === "frameless") throw Error("no_frame");
              return { page: () => (extraPageRequest === "subframe" ? page : {}) };
            },
          }),
          abort: async () => sent.push({ name: "extra-page-aborted", time }),
          fallback: async () => sent.push({ name: "extra-page-sent", time }),
        });
      else if (extraPageRequest) sent.push({ name: "extra-page-sent", time });
      if (socket && socketHandler)
        await socketHandler({
          close: async () => sent.push({ name: "websocket-closed", time }),
          connectToServer: () => sent.push({ name: "websocket-sent", time }),
        });
      else if (socket) sent.push({ name: "websocket-sent", time });
      await Promise.all(
        requests.map((r, i) => requestHandler(paused("resource-" + i, r.type, r.url))),
      );
    },
    title: async () => {
      current = Math.min(Math.floor(time / 500), sequence.length - 1);
      respond(sequence[current]);
      return sequence[current] === 403 ? "正在驗證您的瀏覽器" : "樓盤詳情";
    },
    evaluate: async () => (sequence[current] === 200 ? dom : { refs: [] }),
  };
  let launchOptions, contextOptions;
  const chromium = {
    launch: async (options) => {
      launchOptions = options;
      return {
        newContext: async (options) => {
          contextOptions = options;
          return {
            on: (name, cb) => {
              if (name === "response") contextHandler = cb;
            },
            route: async (_pattern, cb) => {
              routeHandler = cb;
            },
            routeWebSocket: async (_pattern, cb) => {
              socketHandler = cb;
            },
            newCDPSession: async () => ({
              on: (_name, cb) => {
                requestHandler = cb;
              },
              send: async (name, args) => {
                if (name === "Page.getFrameTree") return { frameTree: { frame: { id: "main" } } };
                if (name === "Fetch.continueRequest" || name === "Fetch.failRequest")
                  sent.push({ name, ...args, time });
              },
            }),
            newPage: async () => page,
            close: async () => {
              if (closing429) contextHandler({ status: () => 429 });
              closed++;
            },
          };
        },
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
      if (late429 && ms === 3000) contextHandler({ status: () => 429 });
    },
    inspect: () => ({ time, attempts, closed, launchOptions, contextOptions, sent }),
  };
}
test("normal headless clears a transient challenge, uses pinned executable and closes context", async () => {
  const mock = browserMock([403, 403, 200]);
  const result = await collectDetails([detailUrl], mock);
  assert.equal(result.listings.length, 1);
  assert.equal(mock.inspect().launchOptions.headless, true);
  assert.equal(mock.inspect().launchOptions.executablePath, "/pinned/chromium");
  assert.deepEqual(mock.inspect().launchOptions.args, ["--no-proxy-server"]);
  assert.deepEqual(mock.inspect().contextOptions, { serviceWorkers: "block" });
  assert.equal(mock.inspect().closed, 2);
  assert.ok(mock.inspect().time >= 3000);
});
test("concurrent resources and redirected document requests each wait at least three seconds", async () => {
  const mock = browserMock([200], {
    requests: [
      { type: "Script", url: "https://www.property.hk/script.js" },
      { type: "Image", url: "https://www.property.hk/image.jpg" },
      { type: "Document", url: detailUrl },
    ],
  });
  await collectDetails([detailUrl], mock);
  assert.deepEqual(
    mock.inspect().sent.map((r) => r.time),
    [0, 3000, 6000, 9000],
  );
});
test("an unapproved redirected document fails closed before continuing its request", async () => {
  const mock = browserMock([200], {
    requests: [{ type: "Document", url: "https://elsewhere.test/asking_detail/100.html" }],
  });
  await assert.rejects(collectDetails([detailUrl], mock), /unexpected_navigation/);
  assert.equal(mock.inspect().sent.at(-1).name, "Fetch.failRequest");
  assert.equal(mock.inspect().closed, 2);
});
for (const extraPageRequest of ["popup", "frameless", "subframe"])
  test(`an unpaced browser target is blocked before sending (${extraPageRequest})`, async () => {
    const mock = browserMock([200], { extraPageRequest });
    await assert.rejects(collectDetails([detailUrl], mock), /unexpected_browser_target/);
    assert.ok(mock.inspect().sent.some((r) => r.name === "extra-page-aborted"));
    assert.ok(mock.inspect().sent.every((r) => r.name !== "extra-page-sent"));
    assert.equal(mock.inspect().closed, 2);
  });
test("a WebSocket cannot open an unpaced connection from the main frame", async () => {
  const mock = browserMock([200], { socket: true });
  await assert.rejects(collectDetails([detailUrl], mock), /unexpected_browser_target/);
  assert.ok(mock.inspect().sent.some((r) => r.name === "websocket-closed"));
  assert.ok(mock.inspect().sent.every((r) => r.name !== "websocket-sent"));
  assert.equal(mock.inspect().closed, 2);
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
test("a 429 during the final page pacing interval cannot produce a complete capture", async () => {
  const mock = browserMock([200], { late429: true });
  await assert.rejects(collectDetails([detailUrl], mock), /rate_limited/);
  assert.equal(mock.inspect().attempts, 1);
  assert.equal(mock.inspect().closed, 2);
});
test("a resource 429 aborts queued requests and a 429 during shutdown rejects the capture", async () => {
  const queued = browserMock([200], {
    late429: true,
    requests: [
      { type: "Script", url: "https://www.property.hk/one.js" },
      { type: "Script", url: "https://www.property.hk/two.js" },
    ],
  });
  await assert.rejects(collectDetails([detailUrl], queued), /rate_limited/);
  assert.deepEqual(
    queued.inspect().sent.map((r) => r.name),
    ["Fetch.continueRequest", "Fetch.failRequest", "Fetch.failRequest"],
  );
  const closing = browserMock([200], { closing429: true });
  await assert.rejects(collectDetails([detailUrl], closing), /rate_limited/);
  assert.equal(closing.inspect().closed, 2);
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
for (const [label, field, otherDeal] of [
  ["已售", "price", "rent"],
  ["已租", "rent", "sale"],
])
  test(`Property.hk ${label} cannot deactivate an unquoted linked ${otherDeal} offer`, () => {
    const f = fresh();
    f.current.properties.forEach((p) => {
      p.source = "propertyhk";
      p.source_ids = ["100"];
    });
    const index = {
      schema: "propertyhk-index/v1",
      complete: true,
      absence_enabled: false,
      scraped_at: f.capture.scraped_at,
      ads: [{ property_id: "100", detail_url: detailUrl, [field]: "20000" }],
    };
    const details = {
      schema: "propertyhk-details/v1",
      complete: true,
      absence_enabled: false,
      listings: [
        parseDetail(
          { ...dom, fields: [[field === "price" ? "售價" : "出租價", label]], lifecycle: [label] },
          detailUrl,
          f.capture.scraped_at,
        ),
      ],
    };
    assert.throws(
      () => propertyhkDiff(index, f.current, details, { now: f.now }),
      /mixed_terminal_offers/,
    );
    // With only the explicitly terminal deal linked, the report remains useful.
    f.current.properties = f.current.properties.filter((p) => p.deal_type !== otherDeal);
    const report = propertyhkDiff(index, f.current, details, { now: f.now });
    assert.equal(report.counts[label === "已售" ? "sold" : "rented"], 1);
    assert.equal(report.rows.flatMap((r) => r.would_change).length, 1);
  });

for (const label of ["已撤盤", "已下架"])
  for (const deal of ["sale", "rent"])
    test(`Property.hk ${label} in the ${deal} cell cannot deactivate the other offer`, () => {
      const f = fresh();
      f.current.properties.forEach((p) => {
        p.source = "propertyhk";
        p.source_ids = ["100"];
      });
      const field = deal === "sale" ? "price" : "rent";
      const amountLabel = deal === "sale" ? "售價" : "出租價";
      const otherLabel = deal === "sale" ? "出租價" : "售價";
      const otherQuote = deal === "sale" ? "$20,000" : "$500 萬";
      for (const quoted of [label, `${deal === "sale" ? "$500 萬" : "$20,000"} ${label}`]) {
        assert.throws(
          () =>
            parseDetail(
              {
                ...dom,
                fields: [
                  [amountLabel, quoted],
                  [otherLabel, otherQuote],
                ],
                lifecycle: [label],
              },
              detailUrl,
              f.capture.scraped_at,
            ),
          /mixed_terminal_offers/,
        );
      }
      const index = {
        schema: "propertyhk-index/v1",
        complete: true,
        absence_enabled: false,
        scraped_at: f.capture.scraped_at,
        ads: [{ property_id: "100", detail_url: detailUrl, [field]: null }],
      };
      const detail = parseDetail(
        { ...dom, fields: [[amountLabel, label]], lifecycle: [label] },
        detailUrl,
        f.capture.scraped_at,
      );
      assert.deepEqual(detail.source_status_deals, [deal]);
      const details = {
        schema: "propertyhk-details/v1",
        complete: true,
        absence_enabled: false,
        listings: [detail],
      };
      assert.throws(
        () => propertyhkDiff(index, f.current, details, { now: f.now }),
        /mixed_terminal_offers/,
      );
      f.current.properties = f.current.properties.filter((p) => p.deal_type === deal);
      const report = propertyhkDiff(index, f.current, details, { now: f.now });
      assert.equal(report.counts.delisted, 1);
      assert.deepEqual(report.rows[0].would_change, [
        { field: "status", old: "active", new: "inactive" },
      ]);
      delete detail.source_status_deals;
      assert.throws(
        () => propertyhkDiff(index, f.current, details, { now: f.now }),
        /detail_status_scope_missing/,
      );
    });

test("Property.hk listing-wide withdrawal can settle both explicitly linked offers", () => {
  const f = fresh();
  f.current.properties.forEach((p) => {
    p.source = "propertyhk";
    p.source_ids = ["100"];
  });
  const detail = parseDetail(
    { ...dom, fields: [...dom.fields, ["樓盤狀態", "已撤盤"]], lifecycle: ["已撤盤"] },
    detailUrl,
    f.capture.scraped_at,
  );
  assert.deepEqual(detail.source_status_deals, ["rent", "sale"]);
  const report = propertyhkDiff(
    {
      schema: "propertyhk-index/v1",
      complete: true,
      absence_enabled: false,
      scraped_at: f.capture.scraped_at,
      ads: [{ property_id: "100", detail_url: detailUrl, price: "5000000", rent: "20000" }],
    },
    f.current,
    { schema: "propertyhk-details/v1", complete: true, absence_enabled: false, listings: [detail] },
    { now: f.now },
  );
  assert.equal(report.counts.delisted, 2);
  assert.ok(report.rows.every((r) => r.would_change[0].new === "inactive"));
});
