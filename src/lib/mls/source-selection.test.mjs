import assert from "node:assert/strict";
import test from "node:test";
import { chooseRelationship, selectSourceFields, selectWholeContact } from "./source-selection.mjs";
const record = {
  source: "propertyhk",
  externalId: "p1",
  dealType: "sale",
  unitKey: "unit-sale",
  identity: { estate: "ESTATE", district: "TEST", phase: "", block: "2", floor: "12", unit: "A" },
};
test("T14 T18 existing source relationship precedes exact match and missing-unit reuse", () => {
  assert.equal(
    chooseRelationship(
      { ...record, unitKey: null },
      { property_id: "original", unit_key: null, raw_identity: {} },
      [],
    ).propertyId,
    "original",
  );
  assert.equal(
    chooseRelationship(record, null, [
      {
        property_id: "target",
        source: "28hse_agent_540",
        deal_type: "sale",
        unit_key: "unit-sale",
      },
    ]).propertyId,
    "target",
  );
});
test("T15 T19 T20 only unique compatible cross-source offers match", () => {
  const c = {
    property_id: "one",
    source: "28hse_agent_540",
    deal_type: "sale",
    unit_key: "unit-sale",
  };
  assert.equal(
    chooseRelationship(record, null, [c, { ...c, property_id: "two" }]).reason,
    "ambiguous_exact_unit",
  );
  assert.equal(chooseRelationship(record, null, [{ ...c, deal_type: "rent" }]).propertyId, null);
  assert.equal(chooseRelationship(record, null, [{ ...c, source: "propertyhk" }]).propertyId, null);
  assert.equal(chooseRelationship({ ...record, unitKey: null }, null, [c]).propertyId, null);
});
test("material identity correction retains property and requests review", () => {
  const r = chooseRelationship(
    record,
    { property_id: "original", unit_key: "old", raw_identity: { ...record.identity, unit: "B" } },
    [],
  );
  assert.equal(r.propertyId, "original");
  assert.equal(r.holdProjection, true);
  assert.equal(r.reason, "identity_changed");
});
const primary = {
  source: "28hse_agent_540",
  observation_id: "p",
  source_status: "active",
  fields: { price: "5380000", description: "Primary raw", saleable_area: null, bedrooms: 0 },
};
const secondary = {
  source: "propertyhk",
  observation_id: "s",
  source_status: "active",
  fields: { price: "5500000", description: "Secondary text", saleable_area: "520.5", bedrooms: 2 },
};
test("T21 T22 primary conflict and narrow fallback preserve zero and raw description", () => {
  let s = selectSourceFields([primary, secondary]);
  assert.equal(s.values.price, "5380000");
  assert.equal(s.values.description, "Primary raw");
  assert.equal(s.values.saleable_area, "520.5");
  assert.equal(s.values.bedrooms, 0);
  assert.ok(s.conflicts.some((c) => c.field === "price"));
  s = selectSourceFields([
    { ...primary, fields: { ...primary.fields, saleable_area: "530" } },
    secondary,
  ]);
  assert.equal(s.values.saleable_area, "530");
  assert.equal(s.provenance.saleable_area.source, "28hse_agent_540");
});
test("secondary cannot replace missing primary identity or text and cannot revive primary absence", () => {
  const s = selectSourceFields([
    { ...primary, source_status: "delisted", fields: { ...primary.fields, title: null } },
    secondary,
  ]);
  assert.equal(s.values.title, undefined);
  assert.equal(s.lifecycle, "inactive");
});
test("T23 contacts remain whole and inactive/stale contacts cannot win", () => {
  const contact = selectWholeContact(
    [
      { ...primary, contact: { name: "A", phone: null }, last_accepted_at: "2026-09-07T00:00:00Z" },
      {
        ...secondary,
        contact: { name: "B", phone: "12345678" },
        last_accepted_at: "2026-09-07T00:00:00Z",
      },
    ],
    { now: "2026-09-07T01:00:00Z", maxAgeHours: 48 },
  );
  assert.equal(contact.contact.name, "B");
  assert.equal(contact.contact.phone, "12345678");
  assert.equal(
    selectWholeContact(
      [
        {
          ...secondary,
          contact: { name: "B", phone: "12345678" },
          last_accepted_at: "2020-01-01T00:00:00Z",
        },
      ],
      { now: "2026-09-07T01:00:00Z", maxAgeHours: 48 },
    ),
    null,
  );
});

test("same-source advertisements cannot collapse through a secondary link", () => {
  const r = { ...record, source: "28hse_agent_540" };
  const candidates = [
    { property_id: "one", source: "propertyhk", deal_type: "sale", unit_key: r.unitKey },
    { property_id: "one", source: "28hse_agent_540", deal_type: "sale", unit_key: r.unitKey },
  ];
  assert.equal(chooseRelationship(r, null, candidates).propertyId, null);
});

test("review: incomplete identity retains source match, duplicate targets fail closed", () => {
  const record = { source: "propertyhk", dealType: "sale", unitKey: null, identity: {} };
  assert.equal(
    chooseRelationship(record, { property_id: "p", unit_key: "known", raw_identity: {} }).unitKey,
    "known",
  );
  const result = chooseRelationship({ ...record, unitKey: "u" }, null, [
    { source: "28hse_agent_540", deal_type: "sale", unit_key: "u", property_id: "p" },
    { source: "propertyhk", deal_type: "sale", unit_key: "u", property_id: "q" },
  ]);
  assert.equal(result.propertyId, null);
  assert.equal(result.reason, "same_source_duplicate");
  assert.deepEqual(result.candidates, ["q"]);
});
test("review: lifecycle and contacts require recognized positive evidence", () => {
  assert.equal(selectSourceFields([]).lifecycle, null);
  assert.equal(
    selectSourceFields([{ source: "28hse_agent_540", source_status: "unknown" }]).lifecycle,
    null,
  );
  for (const item of [
    { source: "propertyhk", phone: "-----" },
    { source: "unknown", phone: "12345678" },
  ]) {
    assert.equal(
      selectWholeContact(
        [
          {
            ...item,
            source_status: "active",
            last_accepted_at: "2026-09-07T00:00:00Z",
            contact: { name: "A", phone: item.phone },
          },
        ],
        { now: "2026-09-07T01:00:00Z" },
      ),
      null,
    );
  }
});

test("quoted source unit-price conflicts remain visible even though public PSF is derived", () => {
  const result = selectSourceFields([
    {
      source: "28hse_agent_540",
      source_status: "active",
      observation_id: "p",
      fields: { gross_unit_price: "100", saleable_unit_price: "200" },
    },
    {
      source: "propertyhk",
      source_status: "active",
      observation_id: "s",
      fields: { gross_unit_price: "101", saleable_unit_price: "201" },
    },
  ]);
  assert.deepEqual(
    result.conflicts.map((c) => c.field),
    ["gross_unit_price", "saleable_unit_price"],
  );
  assert.equal(result.values.gross_unit_price, "100");
});
