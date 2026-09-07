import test from "node:test";
import assert from "node:assert/strict";
import { decodeSnapshot } from "./ingestion-contract.mjs";
import { selectSourceFields } from "./source-selection.mjs";
import { batch, row } from "./ingestion-test-fixtures.mjs";
test("company metadata is validated, retained, and participates in duplicate identity", () => {
  assert.equal(
    decodeSnapshot(batch([row("1", { agency_property_no: "A034601" })])).records[0]
      .agencyPropertyNo,
    "A034601",
  );
  assert.equal(
    decodeSnapshot(batch([row("1", { agency_property_no: "bad code" })])).rejects[0].code,
    "invalid_agency_property_no",
  );
  assert.equal(
    decodeSnapshot(
      batch([
        row("1", { agency_property_no: "A034601" }),
        row("1", { agency_property_no: "A034602" }),
      ]),
    ).records.length,
    0,
  );
});
const ad = (id, extra = {}) => ({
  source: "28hse_agent_540",
  external_listing_id: id,
  observation_id: id,
  source_status: "active",
  raw_identity: { agency_property_no: "A034601" },
  fields: { price: "100", estate: "Estate" },
  ...extra,
});
test("consistent ads choose a stable whole advertisement, regardless of input order", () => {
  const a = ad("100", { fields: { price: "100", estate: "Estate", description: "first" } }),
    b = ad("200", { fields: { price: "100", estate: "Estate", description: "second" } });
  assert.equal(selectSourceFields([b, a]).values.description, "first");
  assert.deepEqual(selectSourceFields([b, a]), selectSourceFields([a, b]));
});
test("material and explicit lifecycle conflicts hold projection with evidence", () => {
  for (const change of [
    { fields: { price: "200", estate: "Estate" } },
    { source_status: "delisted", source_status_reason: "sold" },
    { raw_identity: { agency_property_no: "A034602" } },
  ]) {
    const selected = selectSourceFields([ad("1"), ad("2", change)]);
    assert.equal(selected.ambiguous, true);
    assert.ok(selected.conflicts.length);
  }
});
test("inferred absence of one advertisement does not hide an active compatible ad", () => {
  const selected = selectSourceFields([
    ad("1"),
    ad("2", { source_status: "delisted", source_status_reason: null }),
  ]);
  assert.equal(selected.ambiguous, false);
  assert.equal(selected.lifecycle, "active");
});
