import { batch as sourceBatch } from "./ingestion-test-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { exactUnitIdentity } from "./unit-identity.mjs";
import { decodeSnapshot, normalizeDecimal, SnapshotError } from "./ingestion-contract.mjs";
import { evaluateSnapshotGate } from "./source-snapshot-gates.mjs";
const row = (id = "123", extra = {}) => ({
  property_id: id,
  source_url: `https://www.28hse.com/buy/example/property-${id.replace(/^#/, "")}`,
  title: "晉誠 | Example",
  estate: "Estate Phase 1",
  district: "Test",
  block: "Tower 2A",
  floor: "12/F",
  unit: "Flat 01",
  deal_type: "sale",
  price: 5380000,
  ...extra,
});
const batch = (rows = [row()], extra = {}) => ({
  source: "28hse",
  branches: [],
  scraped_at: "2026-09-07T00:00:00.123456Z",
  listings: rows,
  meta: {
    schema_version: "2.0",
    run_id: "fixture-run",
    scope_id: "agent:540",
    policy_version: "no-hermes-v2",
    parser_version: "fixture-v2",
    crawl_complete: true,
    pages_failed: 0,
    worker_rejected_count: 0,
    rejected_records: [],
    eligible_for_absence: true,
    completed_branches: [],
    pages: [
      {
        scope: "sale",
        page: 1,
        status: "listings",
        ids: rows.map((r) => r.property_id.replace(/^#/, "")),
        details_complete: true,
      },
      { scope: "sale", page: 2, status: "terminal", ids: [], details_complete: true },
      { scope: "rent", page: 1, status: "terminal", ids: [], details_complete: true },
    ],
    ...extra,
  },
});
test("T07 wire source and ID cleaning preserve raw evidence; no agency number required", () => {
  const d = decodeSnapshot(batch([row("#123")]));
  assert.equal(d.source, "28hse_agent_540");
  assert.equal(d.records[0].externalId, "123");
  assert.equal(d.records[0].raw.property_id, "#123");
  assert.equal(d.scrapedAt, "2026-09-07T00:00:00.123456Z");
  assert.equal(d.records[0].propertyNo, null);
  assert.throws(() => decodeSnapshot({ ...batch(), source: "old_site" }), SnapshotError);
});
test("a future scraped_at cannot poison the accepted-snapshot watermark", () => {
  const nearFuture = { ...batch(), scraped_at: new Date(Date.now() + 60_000).toISOString() };
  assert.doesNotThrow(() => decodeSnapshot(nearFuture));
  const future = { ...batch(), scraped_at: "2099-01-01T00:00:00Z" };
  assert.throws(
    () => decodeSnapshot(future),
    (error) => error instanceof SnapshotError && error.code === "invalid_timestamp",
  );
});
test("T14 T16 T17 complete exact identity preserves phase suffix and leading zero", () => {
  const a = exactUnitIdentity(row());
  assert.ok(a.key);
  assert.equal(a.unit, "01");
  assert.equal(a.block, "2A");
  assert.equal(a.floor, "12");
  assert.notEqual(a.key, exactUnitIdentity(row("123", { estate: "Estate Phase 2" })).key);
  for (const field of ["estate", "block", "floor", "unit"])
    assert.equal(exactUnitIdentity(row("123", { [field]: null })).key, null);
  assert.equal(exactUnitIdentity(row("123", { floor: "高層" })).key, null);
});
test("decimal normalization preserves fractional evidence and zero semantics", () => {
  assert.equal(normalizeDecimal("538.2500"), "538.25");
  assert.equal(normalizeDecimal(0), "0");
  assert.equal(normalizeDecimal("面議"), null);
  assert.equal(normalizeDecimal("1e309"), null);
  const d = decodeSnapshot(batch([row("123", { saleable_area: 520.5, bedrooms: 0 })]));
  assert.equal(d.records[0].fields.saleable_area, "520.5");
  assert.equal(d.records[0].fields.bedrooms, 0);
});
test("T01 exact duplicate identities collapse; conflicting duplicates cannot last-row-win", () => {
  let d = decodeSnapshot(batch([row(), row()]));
  assert.equal(d.records.length, 1);
  assert.equal(d.duplicates, 1);
  d = decodeSnapshot(batch([row(), row("123", { price: 1 })]));
  assert.equal(d.records.length, 0);
  assert.equal(d.rejects.length, 2);
});
test("T03 T09 structural failure blocks writes independently of count drop", () => {
  const d = decodeSnapshot(batch());
  assert.equal(evaluateSnapshotGate(d, { fullCount: 2 }).allowed, false);
  assert.equal(
    evaluateSnapshotGate(decodeSnapshot(batch(undefined, { pages_failed: 1 })), { fullCount: 1 })
      .allowed,
    false,
  );
  assert.equal(
    evaluateSnapshotGate(decodeSnapshot(batch(undefined, { crawl_complete: false })), null).allowed,
    false,
  );
});
test("T26 first full snapshot eligible but cannot infer historical absence", () => {
  const g = evaluateSnapshotGate(decodeSnapshot(batch()), null);
  assert.equal(g.allowed, true);
  assert.equal(g.full, true);
  assert.equal(g.inferAbsence, false);
  assert.equal(
    evaluateSnapshotGate(
      decodeSnapshot(batch()),
      {
        fullCount: 1,
        fullReceiptId: "prior",
        source: "28hse_agent_540",
        scopeId: "agent:540",
        policyVersion: "no-hermes-v2",
        parserVersion: "fixture-v2",
        applied: true,
        full: true,
      },
      { absenceEnabled: true },
    ).inferAbsence,
    true,
  );
});
test("T24 isolated invalid row never establishes full baseline", () => {
  const d = decodeSnapshot(batch([row(), row("456", { deal_type: "unknown" })]));
  const g = evaluateSnapshotGate(d, null);
  assert.equal(g.allowed, true);
  assert.equal(g.full, false);
  assert.equal(g.inferAbsence, false);
});
test("terminal page evidence required; advertised total cannot assert completion", () => {
  const b = batch();
  b.meta.pages = b.meta.pages.slice(0, 1);
  b.meta.advertised_count = 1;
  assert.equal(evaluateSnapshotGate(decodeSnapshot(b), null).allowed, false);
});
export { row, batch };

test("unaccounted discovered IDs cannot establish a full snapshot", () => {
  const b = batch();
  b.meta.pages[0].ids.push("999");
  assert.equal(evaluateSnapshotGate(decodeSnapshot(b), null).allowed, false);
});
test("exact 30 percent drop passes only structural gate", () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(String(i + 1)));
  assert.equal(evaluateSnapshotGate(decodeSnapshot(batch(rows)), { fullCount: 10 }).allowed, true);
});
test("page evidence malformed types fail closed without throwing", () => {
  const b = batch();
  b.meta.pages = [null];
  assert.equal(evaluateSnapshotGate(decodeSnapshot(b), null).allowed, false);
});

test("source URL identity and placeholder units fail closed", () => {
  for (const source_url of [
    "https://www.28hse.com/buy/example/property-999",
    "https://www.28hse.com/rent/example/property-123",
    "https://www.28hse.com/login",
  ])
    assert.equal(decodeSnapshot(batch([row("123", { source_url })])).records.length, 0);
  assert.equal(exactUnitIdentity(row("123", { unit: "UNKNOWN" })).key, null);
  assert.notEqual(
    exactUnitIdentity(row()).key,
    exactUnitIdentity(row("123", { deal_type: "rent" })).key,
  );
});
test("valid source without valid offer remains explicit unpublished evidence", () => {
  const r = decodeSnapshot(batch([row("123", { price: null })])).records[0];
  assert.equal(r.sourceIdentityValid, true);
  assert.equal(r.offerValid, false);
  assert.equal(r.publicationEligible, false);
});
test("absence needs server authority and scoped applied baseline", () => {
  const d = decodeSnapshot(batch());
  assert.equal(
    evaluateSnapshotGate(d, { fullCount: 1, fullReceiptId: "other" }, { absenceEnabled: true })
      .allowed,
    false,
  );
  assert.equal(evaluateSnapshotGate(d, null, { absenceEnabled: true }).inferAbsence, false);
});
test("unknown discovered ID cannot hide behind unrelated rejection", () => {
  const b = batch();
  b.meta.pages[0].ids.push("999");
  b.meta.worker_rejected_count = 1;
  b.meta.rejected_records = [{ scope: "sale", property_id: "888", reason: "invalid" }];
  assert.equal(evaluateSnapshotGate(decodeSnapshot(b), null).allowed, false);
});
test("global Property.hk advert unions branches only when content agrees", () => {
  const r = { ...row("P1"), source_url: "https://www.property.hk/example/P1", branch_code: "EPW" };
  const b = batch([r, { ...r, branch_code: "EPS" }]);
  b.source = "propertyhk";
  b.branches = ["EPW", "EPS", "EPT"];
  b.meta.scope_id = "branches:EPW,EPS,EPT";
  const d = decodeSnapshot(b, { idScope: "global", verifySourceUrl: () => true });
  assert.equal(d.records.length, 1);
  assert.deepEqual(d.records[0].branches, ["EPS", "EPW"]);
});

test("rejected evidence is normalized scoped unique and bounded", () => {
  const b = batch();
  b.meta.pages[0].ids.push("999");
  b.meta.worker_rejected_count = 1;
  b.meta.rejected_records = [{ scope: "sale", property_id: "#999", reason: "invalid_record" }];
  assert.equal(evaluateSnapshotGate(decodeSnapshot(b), null).allowed, true);
  b.meta.rejected_records[0].scope = "unknown";
  assert.equal(evaluateSnapshotGate(decodeSnapshot(b), null).allowed, false);
});
test("aliases must be owned strings and duplicate occurrences remain traceable", () => {
  assert.equal(exactUnitIdentity(row(), { "ESTATE PHASE 1": 42 }).key, null);
  const d = decodeSnapshot(batch([row(), row()]));
  assert.equal(d.records[0].sourceOccurrences.length, 2);
});

test("daily lifecycle defaults active and accepts only consistent explicit terminal states", () => {
  assert.equal(decodeSnapshot(batch()).records[0].sourceStatus, "active");
  assert.equal(decodeSnapshot(batch()).records[0].sourceStatusReason, null);
  for (const [deal, reason] of [
    ["sale", "sold"],
    ["rent", "rented"],
  ]) {
    const terminal = row("123", {
      deal_type: deal,
      source_url: `https://www.28hse.com/${deal === "sale" ? "buy" : "rent"}/example/property-123`,
      source_status: "delisted",
      source_status_reason: reason,
    });
    const record = decodeSnapshot(batch([terminal])).records[0];
    assert.equal(record.sourceStatus, "delisted");
    assert.equal(record.sourceStatusReason, reason);
    assert.equal(record.offerValid, false);
    assert.ok(record.publicationReasons.includes("source_terminal"));
  }
  for (const lifecycle of [
    { source_status: "sold" },
    { source_status: null },
    { source_status: "delisted" },
    { source_status: "active", source_status_reason: "sold" },
    { source_status: "delisted", source_status_reason: "rented" },
    { source_status: "delisted", source_status_reason: "unknown" },
    { source_status_reason: "sold" },
  ])
    assert.equal(
      decodeSnapshot(batch([row("123", lifecycle)])).rejects[0].code,
      "invalid_source_lifecycle",
    );
});
test("differing lifecycle duplicate IDs conflict and negotiable amounts remain null", () => {
  const decoded = decodeSnapshot(
    batch([row(), row("123", { source_status: "delisted", source_status_reason: "sold" })]),
  );
  assert.equal(decoded.records.length, 0);
  assert.equal(decoded.rejects.length, 2);
  const record = decodeSnapshot(batch([row("123", { price: null })])).records[0];
  assert.equal(record.fields.price, null);
  assert.equal(record.offerValid, false);
});
test("Property.hk rejected detail is not permission for a partial business apply", () => {
  const r = { ...row("P1"), source_url: "https://www.property.hk/example/P1", branch_code: "EPW" };
  const b = sourceBatch([r], undefined, "propertyhk");
  b.meta.pages[0].ids.push("missing");
  b.meta.worker_rejected_count = 1;
  b.meta.rejected_records = [{ scope: "EPW", property_id: "missing", reason: "invalid_record" }];
  const d = decodeSnapshot(b, { idScope: "global", verifySourceUrl: () => true });
  assert.equal(d.source, "propertyhk");
  assert.equal(d.records.length, 1);
  const g = evaluateSnapshotGate(d, null);
  assert.equal(g.allowed, false);
  assert.equal(g.full, false);
  assert.equal(g.inferAbsence, false);
});
test("one Property.hk branch collapse cannot hide behind stable merged inventory", () => {
  const r = {
    ...row("P1"),
    source_url: "https://www.property.hk/example/P1",
    branch_code: "EPW",
    branch_memberships: ["EPW", "EPT"],
  };
  const b = sourceBatch([r], undefined, "propertyhk");
  const d = decodeSnapshot(b, { idScope: "global", verifySourceUrl: () => true });
  assert.equal(d.records.length, 1);
  const g = evaluateSnapshotGate(d, { fullCount: 1, branchCounts: { EPW: 1, EPS: 1, EPT: 1 } });
  assert.equal(g.allowed, false);
  assert.ok(g.reasons.includes("branch_count_drop_EPS"));
});
