import assert from "node:assert/strict";
import test from "node:test";
import { chooseRelationship, selectSourceFields, selectWholeContact } from "./source-selection.mjs";
import { SOURCE_28HSE } from "./source-contract.mjs";
import { POLICY_VERSION } from "./ingestion-contract.mjs";
import { SOURCE_AUTHORITY_POLICY } from "./source-authority-policy.mjs";
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
const authorityAd = (id, overrides = {}) => ({
  source: SOURCE_28HSE,
  external_listing_id: id,
  observation_id: `observation-${id}`,
  scope_id: "agent:540",
  policy_version: POLICY_VERSION,
  deal_type: "sale",
  source_status: "active",
  source_status_reason: null,
  raw_identity: { agency_property_no: "C014574" },
  fetched_at: "2026-11-14T02:00:00.123Z",
  policy_config: {
    company_number_identity: { approved: true },
    source_authority: {
      version: SOURCE_AUTHORITY_POLICY,
      approved: true,
      approval_ref: "USER:source-priority",
    },
  },
  fields: { title: `Advertisement ${id}`, price: "100", estate: "Estate" },
  ...overrides,
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

test("saved partial observations cannot widen fields, clear missing values or revive on later selection", () => {
  const saved = {
    ...primary,
    fields: { price: "5380000", description: "Unapproved saved text", bathrooms: null },
    projection: { mode: "controlled-patch-v1", fields: ["price", "bathrooms"] },
  };
  for (const sources of [[saved], [saved, secondary], [secondary, saved]]) {
    const selected = selectSourceFields(sources);
    assert.equal(selected.values.price, "5380000");
    assert.equal(selected.values.description, undefined);
    assert.equal(selected.values.saleable_area, undefined);
    assert.deepEqual(selected.clearFields, []);
    assert.equal(selected.lifecycle, null);
  }
  const renewed = selectSourceFields([primary, secondary]);
  assert.equal(renewed.values.description, "Primary raw");
  assert.equal(renewed.lifecycle, "active");
});

test("unrecognized saved projection metadata fails closed without downgrading to full authority", () => {
  for (const projection of [
    {},
    { mode: "future" },
    { mode: "controlled-patch-v1", fields: null },
  ]) {
    const selected = selectSourceFields([{ ...primary, projection }, secondary]);
    assert.deepEqual(selected.values, {});
    assert.deepEqual(selected.clearFields, []);
    assert.equal(selected.lifecycle, null);
  }
});

test("later accepted full-snapshot absence still deactivates a saved-patched primary", () => {
  const saved = {
    ...primary,
    source_status: "delisted",
    projection: { mode: "controlled-patch-v1", fields: ["price"] },
  };
  for (const sources of [[saved], [saved, secondary]]) {
    const selected = selectSourceFields(sources);
    assert.equal(selected.lifecycle, "inactive");
    assert.equal(selected.values.description, undefined);
    assert.deepEqual(selected.clearFields, []);
  }
});

test("contact freshness uses capture, never acceptance of old saved evidence", () => {
  const contact = { name: "Synthetic contact", phone: "12345678" };
  const now = "2026-09-10T12:00:00Z";
  const accepted = { ...primary, contact, last_accepted_at: now };
  for (const fetched_at of ["2026-09-01T00:00:00Z", null, "invalid"]) {
    assert.equal(selectWholeContact([{ ...accepted, fetched_at }], { now }), null);
  }
  const captured = "2026-09-10T11:00:00Z";
  assert.equal(
    selectWholeContact([{ ...accepted, fetched_at: captured }], { now }).observedAt,
    captured,
  );
});
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
      { ...primary, contact: { name: "A", phone: null }, fetched_at: "2026-09-07T00:00:00Z" },
      {
        ...secondary,
        contact: { name: "B", phone: "12345678" },
        fetched_at: "2026-09-07T00:00:00Z",
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
          fetched_at: "2020-01-01T00:00:00Z",
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
            fetched_at: "2026-09-07T00:00:00Z",
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

test("no authorized nullable winner emits an explicit clearing decision without erasing required fields", () => {
  const selection = selectSourceFields([
    { ...primary, fields: { price: "100", description: null } },
    secondary,
  ]);
  assert.ok(selection.clearFields?.includes("description"));
  assert.equal(selection.clearFields.includes("title"), false);
  assert.equal(selection.clearFields.includes("district"), false);
  assert.equal(selection.provenance.description.reason, "no_authorized_source");
  assert.ok(selectSourceFields([{ ...primary, fields: {} }]).clearFields.includes("bathrooms"));
});

test("approved same-reference advertisements select the latest actual microsecond capture with an audit decision", () => {
  const old = authorityAd("4097589", {
    captured_at: "2026-11-14T02:00:00.123001Z",
    fields: { price: "110", title: "Old", description: "Old description" },
  });
  const latest = authorityAd("4068170", {
    captured_at: "2026-11-14T02:00:00.123002Z",
    fields: { price: "100", title: "Latest", description: "Current description" },
  });
  const selected = selectSourceFields([old, latest]);
  assert.deepEqual(selected, selectSourceFields([latest, old]));
  assert.equal(selected.ambiguous, false);
  assert.equal(selected.values.price, "100");
  assert.equal(selected.values.description, "Current description");
  assert.equal(selected.provenance.price.observationId, latest.observation_id);
  assert.equal(selected.provenance.price.reason, "source_authority_latest");
  const conflict = selected.conflicts.find((item) => item.field === "price");
  assert.equal(conflict.resolution, "keep_latest_28hse");
  assert.equal(conflict.primaryAdvertisementId, "4068170");
  assert.equal(conflict.secondaryAdvertisementId, "4097589");
  assert.equal(conflict.primaryObservedAt, latest.captured_at);
  assert.equal(conflict.authority.approval_ref, "USER:source-priority");
});

test("equal approved capture times choose numeric advertisement ID descending", () => {
  const nine = authorityAd("9", { fields: { price: "90" } });
  const ten = authorityAd("10", { fields: { price: "100" } });
  assert.equal(selectSourceFields([nine, ten]).values.price, "100");
  assert.deepEqual(selectSourceFields([nine, ten]), selectSourceFields([ten, nine]));
});

test("missing authority identity, capture, scope or approval retains default conflicting-ad hold", () => {
  for (const override of [
    { raw_identity: {} },
    { raw_identity: { agency_property_no: "invalid" } },
    { raw_identity: { agency_property_no: "C014575" } },
    { scope_id: null },
    { scope_id: "agent:999" },
    { policy_version: "unapproved" },
    { deal_type: "rent" },
    { fetched_at: null },
    { captured_at: "invalid" },
    { source_status: "unknown" },
    { policy_config: { company_number_identity: { approved: true } } },
    { policy_config: { source_authority: { approved: false } } },
  ]) {
    const first = authorityAd("4068170", { fields: { price: "110" } });
    const invalid = authorityAd("4097589", { ...override, fields: { price: "100" } });
    assert.equal(selectSourceFields([first, invalid]).ambiguous, true, JSON.stringify(override));
  }
  assert.throws(
    () =>
      selectSourceFields([
        authorityAd("1", {
          policy_config: {
            source_authority: { approved: true, version: "unknown", approval_ref: "owner" },
          },
        }),
      ]),
    /invalid_source_authority_policy/,
  );
});

test("authority does not change unapproved deterministic whole-advertisement selection", () => {
  const old = authorityAd("4068170", {
    policy_config: {},
    fields: { price: "100", description: "Old" },
  });
  const fresh = authorityAd("4097589", {
    policy_config: {},
    captured_at: "2026-11-14T03:00:00Z",
    fields: { price: "100", description: "New" },
  });
  // Legacy company approval is still required whenever a DB config was supplied.
  old.policy_config.company_number_identity = { approved: true };
  fresh.policy_config.company_number_identity = { approved: true };
  assert.equal(selectSourceFields([fresh, old]).values.description, "Old");
  assert.equal(selectSourceFields([fresh, { ...old, fields: { price: "120" } }]).ambiguous, true);
});

test("ambiguous lower-priority rows cannot quarantine approved primary data or supply missing values", () => {
  const approved = authorityAd("4068170", {
    fields: { price: "100", bedrooms: 0, saleable_area: null, floor: null },
  });
  const lower = {
    ...secondary,
    external_listing_id: "one",
    unit_key: "one",
    deal_type: "sale",
    fields: { price: "200", saleable_area: "500", floor: "13" },
  };
  const other = {
    ...lower,
    external_listing_id: "two",
    unit_key: "two",
    fields: { price: "300", saleable_area: "600" },
  };
  for (const sources of [
    [approved, lower, other],
    [other, approved, lower],
    [approved, { ...lower, source_status: "unknown" }],
  ]) {
    const selected = selectSourceFields(sources);
    assert.equal(selected.ambiguous, false);
    assert.equal(selected.values.price, "100");
    assert.equal(selected.values.bedrooms, 0);
    assert.equal(selected.values.saleable_area, undefined);
    assert.equal(selected.values.floor, undefined);
    assert.deepEqual(selected.clearFields, []);
    assert.equal(selected.lifecycle, "active");
  }
  const notApproved = { ...approved, policy_config: {} };
  assert.equal(selectSourceFields([notApproved, lower, other]).ambiguous, true);
});

test("lower-priority authority config cannot authorize an unapproved primary or replace a known fact", () => {
  const unapproved = authorityAd("4068170", { policy_config: {}, fields: { price: "100" } });
  const lower = {
    ...secondary,
    ...authorityAd("4097589"),
    source: "propertyhk",
    unit_key: "one",
    fields: { price: "200" },
  };
  const conflict = selectSourceFields([unapproved, lower]);
  assert.equal(conflict.values.price, "100");
  assert.equal(conflict.provenance.price.reason, "primary");
  assert.equal(
    selectSourceFields([unapproved, lower, { ...lower, unit_key: "two" }]).ambiguous,
    true,
  );
});

test("approved latest lifecycle preserves inferred absence and explicit terminal chronology", () => {
  const active = authorityAd("4068170", { captured_at: "2026-11-14T02:00:00Z" });
  const inferred = authorityAd("4097589", {
    source_status: "delisted",
    captured_at: "2026-11-14T03:00:00Z",
  });
  assert.equal(selectSourceFields([active, inferred]).lifecycle, "active");
  const sold = { ...inferred, source_status_reason: "sold" };
  assert.equal(selectSourceFields([active, sold]).lifecycle, "inactive");
  assert.equal(
    selectSourceFields([{ ...active, captured_at: "2026-11-14T04:00:00Z" }, sold]).lifecycle,
    "active",
  );
});

test("approved source ordering never widens a controlled projection", () => {
  const approved = authorityAd("4068170", {
    projection: { mode: "controlled-patch-v1", fields: ["price"] },
    fields: { price: "100", description: "Not approved here" },
  });
  const selected = selectSourceFields([approved, secondary]);
  assert.equal(selected.values.price, "100");
  assert.equal(selected.values.description, undefined);
  assert.deepEqual(selected.clearFields, []);
  assert.equal(selected.lifecycle, null);
});

test("verified Property.hk exact equivalent advertisements may share canonical with explicit consistency", () => {
  const fields = {
    price: "5380000",
    estate: "ESTATE",
    district: "TEST",
    block: "2",
    floor: "12",
    unit: "A",
  };
  const r = {
    ...record,
    fields,
    sourceStatus: "active",
    sourceStatusReason: null,
    exactMatchEligible: true,
  };
  const state = {
    source: "propertyhk",
    external_listing_id: "a",
    deal_type: "sale",
    property_id: "one",
    unit_key: r.unitKey,
    fields,
    source_status: "active",
    source_status_reason: null,
  };
  assert.equal(chooseRelationship(r, null, [state]).propertyId, "one");
  assert.equal(
    chooseRelationship({ ...r, fields: { ...fields, price: "6000000" } }, null, [state])
      .holdProjection,
    true,
  );
  assert.equal(
    chooseRelationship({ ...r, exactMatchEligible: false }, null, [state]).propertyId,
    null,
  );
  const secondaryState = { ...state, observation_id: "o1" };
  const chosen = selectSourceFields([
    secondaryState,
    { ...secondaryState, external_listing_id: "b", observation_id: "o2" },
  ]);
  assert.equal(chosen.ambiguous, false);
  assert.equal(chosen.values.price, "5380000");
  assert.equal(
    selectSourceFields([
      secondaryState,
      { ...secondaryState, fields: { ...fields, price: "6000000" } },
    ]).ambiguous,
    true,
  );
  assert.equal(
    selectSourceFields([
      { ...secondaryState, unit_key: null },
      { ...secondaryState, unit_key: null },
    ]).ambiguous,
    true,
  );
});
