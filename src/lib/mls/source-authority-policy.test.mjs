import assert from "node:assert/strict";
import test from "node:test";
import { SnapshotError, POLICY_VERSION } from "./ingestion-contract.mjs";
import { SOURCE_28HSE, SOURCE_OLD_SITE } from "./source-contract.mjs";
import {
  SOURCE_AUTHORITY_POLICY,
  sourceAuthorityPolicy,
  authorityRecordAllowed,
  authorityDomConflictApproved,
  preferredAuthorityRecords,
} from "./source-authority-policy.mjs";

const CAPTURE = "2026-11-14T02:34:35.753890Z";
const NOW = Date.parse("2026-11-14T03:45:00Z");
const options = { now: () => NOW };
function policyRow() {
  return {
    source: SOURCE_28HSE,
    scope_id: "agent:540",
    policy_version: POLICY_VERSION,
    config: {
      source_authority: {
        version: SOURCE_AUTHORITY_POLICY,
        approved: true,
        approval_ref: "USER-20261114:28hse-property-authority",
      },
    },
  };
}
const rule = () => sourceAuthorityPolicy(policyRow());
function record({
  id = "4060450",
  deal = "sale",
  agency = "A123456",
  stamp = CAPTURE,
  conflict = false,
} = {}) {
  const url = `https://www.28hse.com/${deal === "sale" ? "buy" : "rent"}/apartment/property-${id}`;
  const raw = {
    property_id: id,
    deal_type: deal,
    agency_property_no: agency,
    source_url: url,
    captured_at: stamp,
    bedrooms: 4,
    raw_payload: {
      source_conflicts: conflict
        ? [{ field: "bedrooms", dom: 4, json_ld: 1, resolution: "dom", status: "review" }]
        : [],
      provider_provenance: { contentSha256: "b".repeat(64), fetchedAt: stamp, resolvedUrl: url },
      incremental: { detail_fetched_at: stamp, detail_body_sha256: "b".repeat(64) },
    },
  };
  return {
    source: SOURCE_28HSE,
    externalId: id,
    advertisementId: id,
    dealType: deal,
    agencyPropertyNo: agency,
    sourceUrl: url,
    sourceStatus: "active",
    sourceIdentityValid: true,
    urlIdentityVerified: true,
    fetchedAt: stamp,
    fields: { bedrooms: 4, price: "9500000" },
    raw,
    sourceOccurrences: [{ index: 0, branch: null, sourceUrl: url, raw: structuredClone(raw) }],
  };
}
function eachRaw(value, change) {
  [value.raw, ...value.sourceOccurrences.map((occurrence) => occurrence.raw)].forEach(change);
}
function status(code, statusCode) {
  return (error) =>
    error instanceof SnapshotError && error.code === code && error.status === statusCode;
}

test("only the scoped trusted approved policy row yields a frozen normalized rule", () => {
  const row = policyRow();
  const before = structuredClone(row);
  assert.deepEqual(sourceAuthorityPolicy(row), {
    version: SOURCE_AUTHORITY_POLICY,
    approved: true,
    approval_ref: row.config.source_authority.approval_ref,
    source: SOURCE_28HSE,
    scope_id: "agent:540",
    policy_version: POLICY_VERSION,
  });
  assert.ok(Object.isFrozen(sourceAuthorityPolicy(row)));
  assert.deepEqual(row, before);
});

for (const [name, change] of [
  ["unapproved", (row) => (row.config.source_authority.approved = false)],
  ["missing approval", (row) => delete row.config.source_authority.approved],
  ["wire source", (row) => (row.source = "28hse")],
  ["old site", (row) => (row.source = SOURCE_OLD_SITE)],
  ["other source", (row) => (row.source = "propertyhk")],
  ["other scope", (row) => (row.scope_id = "agent:541")],
  ["other policy", (row) => (row.policy_version = "other-policy")],
  ["missing config", (row) => delete row.config],
])
  test("authority is disabled for " + name, () => {
    const row = policyRow();
    change(row);
    assert.equal(sourceAuthorityPolicy(row), null);
  });

test("missing policy is disabled", () => {
  assert.equal(sourceAuthorityPolicy(null), null);
  assert.equal(sourceAuthorityPolicy(undefined), null);
  assert.deepEqual(preferredAuthorityRecords([record()], null, options), []);
  assert.equal(authorityRecordAllowed(record(), null, options), false);
  assert.equal(authorityDomConflictApproved(record(), null, options), false);
});

for (const [name, value] of [
  ["wrong version", { version: "future-authority", approved: true, approval_ref: "approved" }],
  ["missing reference", { version: SOURCE_AUTHORITY_POLICY, approved: true }],
  ["blank reference", { version: SOURCE_AUTHORITY_POLICY, approved: true, approval_ref: " " }],
  [
    "unbounded reference",
    { version: SOURCE_AUTHORITY_POLICY, approved: true, approval_ref: "a".repeat(161) },
  ],
  [
    "control character",
    { version: SOURCE_AUTHORITY_POLICY, approved: true, approval_ref: "user\nheader" },
  ],
])
  test("malformed approved policy fails closed: " + name, () => {
    const row = policyRow();
    row.config.source_authority = value;
    assert.throws(() => sourceAuthorityPolicy(row), status("invalid_source_authority_policy", 503));
  });

test("clean fresh identity-bound original capture is allowed without mutation", () => {
  const value = record();
  const before = structuredClone(value);
  assert.equal(authorityRecordAllowed(value, rule(), options), true);
  assert.equal(authorityDomConflictApproved(value, rule(), options), true);
  assert.deepEqual(value, before);
});

test("clean incremental evidence need not invent provider provenance", () => {
  const value = record();
  eachRaw(value, (raw) => delete raw.raw_payload.provider_provenance);
  assert.equal(authorityRecordAllowed(value, rule(), options), true);
  assert.equal(authorityDomConflictApproved(value, rule(), options), true);
});

for (const [name, change] of [
  ["other source", (value) => (value.source = SOURCE_OLD_SITE)],
  ["unverified source", (value) => (value.sourceIdentityValid = false)],
  ["unverified URL", (value) => (value.urlIdentityVerified = false)],
  ["missing company number", (value) => (value.agencyPropertyNo = null)],
  ["noncanonical company number", (value) => (value.agencyPropertyNo = "a123456")],
  ["invalid deal", (value) => (value.dealType = "lease")],
  ["non-numeric ID", (value) => (value.externalId = "ad123")],
  ["conflicting advertisement", (value) => (value.advertisementId = "123")],
  ["wrong URL ID", (value) => (value.sourceUrl = value.sourceUrl.replace("4060450", "123"))],
  ["wrong URL deal", (value) => (value.sourceUrl = value.sourceUrl.replace("/buy/", "/rent/"))],
  [
    "foreign URL",
    (value) => (value.sourceUrl = value.sourceUrl.replace("www.28hse.com", "evil.example")),
  ],
  ["URL query", (value) => (value.sourceUrl += "?agent=540")],
  ["URL fragment", (value) => (value.sourceUrl += "#other")],
  [
    "URL userinfo",
    (value) => (value.sourceUrl = value.sourceUrl.replace("https://", "https://u@")),
  ],
  ["missing raw", (value) => delete value.raw],
  ["missing original timestamp", (value) => eachRaw(value, (raw) => delete raw.captured_at)],
  ["envelope timestamp replacing capture", (value) => (value.fetchedAt = "2026-11-14T03:00:00Z")],
  ["cached detail", (value) => eachRaw(value, (raw) => (raw.observation_kind = "cached"))],
  [
    "index-only observation",
    (value) => eachRaw(value, (raw) => (raw.observation_kind = "index_only")),
  ],
  ["raw identity mismatch", (value) => (value.raw.agency_property_no = "B123456")],
  ["missing occurrences", (value) => delete value.sourceOccurrences],
  ["empty occurrences", (value) => (value.sourceOccurrences = [])],
  ["occurrence source URL mismatch", (value) => (value.sourceOccurrences[0].sourceUrl += "?other")],
  [
    "occurrence capture mismatch",
    (value) => (value.sourceOccurrences[0].raw.captured_at = "2026-11-14T02:30:00Z"),
  ],
  [
    "provider time mismatch",
    (value) => (value.raw.raw_payload.provider_provenance.fetchedAt = "2026-11-14T02:30:00Z"),
  ],
  [
    "provider URL mismatch",
    (value) => (value.raw.raw_payload.provider_provenance.resolvedUrl += "?other"),
  ],
  [
    "invalid provider hash",
    (value) => (value.raw.raw_payload.provider_provenance.contentSha256 = "bad"),
  ],
  [
    "incremental hash mismatch",
    (value) => (value.raw.raw_payload.incremental.detail_body_sha256 = "c".repeat(64)),
  ],
  [
    "incremental time mismatch",
    (value) => (value.raw.raw_payload.incremental.detail_fetched_at = "2026-11-14T02:30:00Z"),
  ],
])
  test("record cannot gain authority through " + name, () => {
    const value = record();
    change(value);
    assert.equal(authorityRecordAllowed(value, rule(), options), false);
    assert.equal(authorityDomConflictApproved(value, rule(), options), false);
    assert.throws(
      () => preferredAuthorityRecords([value], rule(), options),
      status("invalid_source_authority_record", 422),
    );
  });

for (const [name, stamp, expected] of [
  ["exactly 36h old", "2026-11-12T15:45:00Z", true],
  ["36h plus one microsecond", "2026-11-12T15:44:59.999999Z", false],
  ["future exactly 60s", "2026-11-14T03:46:00Z", true],
  ["future 60s plus one microsecond", "2026-11-14T03:46:00.000001Z", false],
  ["impossible calendar date", "2026-02-30T00:00:00Z", false],
  ["missing timezone", "2026-11-14T02:34:35", false],
  ["invalid timestamp", "not-a-date", false],
])
  test("freshness uses genuine capture: " + name, () => {
    assert.equal(authorityRecordAllowed(record({ stamp }), rule(), options), expected);
  });

for (const invalidNow of [NaN, Infinity, "2026-11-14", undefined])
  test("an invalid injected clock cannot grant authority: " + String(invalidNow), () => {
    assert.equal(authorityRecordAllowed(record(), rule(), { now: () => invalidNow }), false);
  });

test("explicit DOM bedrooms disagreement is approved only against bound capture", () => {
  const value = record({ conflict: true });
  const before = structuredClone(value);
  assert.equal(authorityDomConflictApproved(value, rule(), options), true);
  assert.deepEqual(value, before);
  assert.equal(value.raw.raw_payload.source_conflicts[0].status, "review");
});

for (const [name, change] of [
  [
    "unknown field",
    (value) => eachRaw(value, (raw) => (raw.raw_payload.source_conflicts[0].field = "price")),
  ],
  [
    "extra conflict key",
    (value) => eachRaw(value, (raw) => (raw.raw_payload.source_conflicts[0].approved = true)),
  ],
  [
    "non-DOM resolution",
    (value) =>
      eachRaw(value, (raw) => (raw.raw_payload.source_conflicts[0].resolution = "json_ld")),
  ],
  [
    "noninteger DOM",
    (value) => eachRaw(value, (raw) => (raw.raw_payload.source_conflicts[0].dom = 4.5)),
  ],
  [
    "DOM below range",
    (value) => eachRaw(value, (raw) => (raw.raw_payload.source_conflicts[0].dom = -1)),
  ],
  [
    "DOM above range",
    (value) => eachRaw(value, (raw) => (raw.raw_payload.source_conflicts[0].dom = 101)),
  ],
  [
    "JSON-LD above range",
    (value) => eachRaw(value, (raw) => (raw.raw_payload.source_conflicts[0].json_ld = 101)),
  ],
  [
    "string JSON-LD",
    (value) => eachRaw(value, (raw) => (raw.raw_payload.source_conflicts[0].json_ld = "1")),
  ],
  [
    "equal evidence values",
    (value) => eachRaw(value, (raw) => (raw.raw_payload.source_conflicts[0].json_ld = 4)),
  ],
  ["normalized bedrooms mismatch", (value) => (value.fields.bedrooms = 1)],
  [
    "missing provider provenance",
    (value) => eachRaw(value, (raw) => delete raw.raw_payload.provider_provenance),
  ],
  [
    "multiple conflicts",
    (value) =>
      eachRaw(value, (raw) =>
        raw.raw_payload.source_conflicts.push({ ...raw.raw_payload.source_conflicts[0] }),
      ),
  ],
  ["malformed conflict list", (value) => (value.raw.raw_payload.source_conflicts = {})],
  ["malformed conflict entry", (value) => (value.raw.raw_payload.source_conflicts = [null])],
  [
    "clean top-level hiding occurrence conflict",
    (value) => (value.raw.raw_payload.source_conflicts = []),
  ],
  [
    "clean occurrence contradicting raw",
    (value) => (value.sourceOccurrences[0].raw.raw_payload.source_conflicts = []),
  ],
  [
    "different occurrence conflict",
    (value) => (value.sourceOccurrences[0].raw.raw_payload.source_conflicts[0].json_ld = 2),
  ],
  [
    "different occurrence body",
    (value) => {
      value.sourceOccurrences[0].raw.raw_payload.provider_provenance.contentSha256 = "c".repeat(64);
      value.sourceOccurrences[0].raw.raw_payload.incremental.detail_body_sha256 = "c".repeat(64);
    },
  ],
])
  test("DOM authority never covers " + name, () => {
    const value = record({ conflict: true });
    change(value);
    assert.equal(authorityDomConflictApproved(value, rule(), options), false);
    assert.throws(
      () => preferredAuthorityRecords([value], rule(), options),
      status("invalid_source_authority_record", 422),
    );
  });

test("every duplicate occurrence is checked and matching multiple copies are permitted", () => {
  const value = record({ conflict: true });
  value.sourceOccurrences.push(structuredClone(value.sourceOccurrences[0]));
  assert.equal(authorityDomConflictApproved(value, rule(), options), true);
  value.sourceOccurrences[1].raw.raw_payload.source_conflicts[0].field = "bathrooms";
  assert.equal(authorityDomConflictApproved(value, rule(), options), false);
});

test("clean records with no pending conflict do not require a conflict acknowledgement", () => {
  const value = record();
  eachRaw(value, (raw) => delete raw.raw_payload.source_conflicts);
  assert.equal(authorityDomConflictApproved(value, rule(), options), true);
});

test("latest genuine capture wins within company and deal; numeric ad ID breaks ties", () => {
  const first = record({ id: "9", stamp: "2026-11-14T02:00:00.000001Z" });
  const latest = record({ id: "10", stamp: "2026-11-14T02:00:00.000002Z" });
  const numericTie = record({ id: "100", stamp: latest.fetchedAt });
  const separateRent = record({ id: "20", deal: "rent" });
  const separateAgency = record({ id: "30", agency: "B123456" });
  const inputs = [first, latest, numericTie, separateRent, separateAgency];
  const before = structuredClone(inputs);
  const expected = [separateRent, numericTie, separateAgency];
  assert.deepEqual(preferredAuthorityRecords(inputs, rule(), options), expected);
  assert.deepEqual(preferredAuthorityRecords([...inputs].reverse(), rule(), options), expected);
  assert.deepEqual(inputs, before);
  assert.equal(preferredAuthorityRecords(inputs, rule(), options)[1], numericTie);
});

test("numeric ID ordering handles IDs beyond Number precision without conversion loss", () => {
  const small = record({ id: "9007199254740992" });
  const large = record({ id: "9007199254740993" });
  assert.deepEqual(preferredAuthorityRecords([small, large], rule(), options), [large]);
});

test("selection uses one clock sample and rejects any invalid record instead of hiding it", () => {
  let calls = 0;
  const clock = () => {
    calls++;
    return NOW;
  };
  preferredAuthorityRecords([record(), record({ deal: "rent" })], rule(), { now: clock });
  assert.equal(calls, 1);
  const old = record({ id: "123", stamp: "2026-11-01T00:00:00Z" });
  assert.throws(
    () => preferredAuthorityRecords([record(), old], rule(), options),
    status("invalid_source_authority_record", 422),
  );
  assert.throws(
    () => preferredAuthorityRecords({}, rule(), options),
    status("invalid_source_authority_records", 422),
  );
  assert.throws(
    () => preferredAuthorityRecords([], { version: SOURCE_AUTHORITY_POLICY }, options),
    status("invalid_source_authority_policy", 503),
  );
});

test("contradictory same-ad same-capture details are rejected instead of input-order selection", () => {
  const first = record();
  const second = record();
  second.fields.price = "1";
  assert.throws(
    () => preferredAuthorityRecords([first, second], rule(), options),
    status("conflicting_source_authority_records", 422),
  );
});

for (const [id, stamp, bedrooms] of [
  ["4060450", "2026-11-14T02:34:35.753890Z", 4],
  ["4097587", "2026-11-14T02:34:41.476388Z", 3],
  ["4097588", "2026-11-14T02:34:43.748058Z", 4],
])
  test("captured bedrooms disagreement is bound to its original timestamp: " + id, () => {
    const value = record({ id, stamp, conflict: true });
    value.fields.bedrooms = bedrooms;
    eachRaw(value, (raw) => {
      raw.bedrooms = bedrooms;
      raw.raw_payload.source_conflicts[0].dom = bedrooms;
    });
    assert.equal(authorityDomConflictApproved(value, rule(), options), true);
    value.fetchedAt = "2026-11-14T03:45:00Z";
    assert.equal(authorityDomConflictApproved(value, rule(), options), false);
  });
