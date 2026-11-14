import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SnapshotError, POLICY_VERSION } from "./ingestion-contract.mjs";
import { SOURCE_28HSE } from "./source-contract.mjs";
import { authorityRecordsFromEvidence } from "./source-authority-evidence.mjs";
import {
  authorityDomConflictApproved,
  sourceAuthorityPolicy,
  SOURCE_AUTHORITY_POLICY,
} from "./source-authority-policy.mjs";

const stamp = "2026-11-14T02:34:35.753890Z";
const now = Date.parse("2026-11-14T03:45:00Z");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const url = "https://www.28hse.com/buy/apartment/property-4060450";
  const html =
    "<!doctype html><html><head><title>Offline fixture</title></head><body><h1>4 房</h1></body></html>";
  const digest = sha256(html);
  const raw = {
    property_id: "4060450",
    deal_type: "sale",
    agency_property_no: "A123456",
    source_url: url,
    captured_at: stamp,
    bedrooms: 4,
    raw_payload: {
      source_conflicts: [
        { field: "bedrooms", dom: 4, json_ld: 1, resolution: "dom", status: "review" },
      ],
      incremental: { mode: "index-delta-v1", detail_fetched_at: stamp, detail_body_sha256: digest },
    },
  };
  const record = {
    source: SOURCE_28HSE,
    externalId: "4060450",
    advertisementId: "4060450",
    dealType: "sale",
    agencyPropertyNo: "A123456",
    sourceUrl: url,
    sourceIdentityValid: true,
    urlIdentityVerified: true,
    fetchedAt: stamp,
    fields: { bedrooms: 4, price: "9500000" },
    raw,
    sourceOccurrences: [{ index: 0, branch: null, sourceUrl: url, raw: structuredClone(raw) }],
  };
  const body = Buffer.from(
    JSON.stringify({
      success: true,
      data: {
        rawHtml: html,
        metadata: { url, sourceURL: url, statusCode: 200, proxyUsed: "basic" },
      },
    }),
  );
  return {
    batch: {
      source: SOURCE_28HSE,
      scopeId: "agent:540",
      policyVersion: POLICY_VERSION,
      records: [record],
      payload: { listings: [raw] },
    },
    evidence: {
      errors: [],
      selected_candidates: [
        {
          property_id: "4060450",
          deal_type: "sale",
          source_url: url,
          status: "fetched",
          detail_fetched_at: stamp,
          detail_body_sha256: digest,
        },
      ],
      requests: [{ url, status: 200, html }],
      provider_requests: [
        {
          request: { url, proxy: "basic" },
          provider_status: 200,
          body_base64: body.toString("base64"),
          body_sha256: sha256(body),
        },
      ],
    },
  };
}
function providerChange(f, change) {
  const response = f.evidence.provider_requests[0];
  const parsed = JSON.parse(Buffer.from(response.body_base64, "base64").toString("utf8"));
  change(parsed);
  const bytes = Buffer.from(JSON.stringify(parsed));
  response.body_base64 = bytes.toString("base64");
  response.body_sha256 = sha256(bytes);
}
function errorMatches(error) {
  return (
    error instanceof SnapshotError &&
    error.code === "invalid_source_authority_evidence" &&
    error.status === 422
  );
}
function approvedRule() {
  return sourceAuthorityPolicy({
    source: SOURCE_28HSE,
    scope_id: "agent:540",
    policy_version: POLICY_VERSION,
    config: {
      source_authority: {
        version: SOURCE_AUTHORITY_POLICY,
        approved: true,
        approval_ref: "USER-20261114-authority",
      },
    },
  });
}

test("verified HTML and provider JSON chain enriches clones and preserves pinned inputs", () => {
  const f = fixture();
  const before = structuredClone(f);
  assert.equal(authorityDomConflictApproved(f.batch.records[0], approvedRule(), { now }), false);
  const records = authorityRecordsFromEvidence(f.batch, f.evidence);
  const provenance = records[0].raw.raw_payload.provider_provenance;
  assert.deepEqual(provenance, {
    contentSha256: f.evidence.selected_candidates[0].detail_body_sha256,
    fetchedAt: stamp,
    resolvedUrl: f.batch.records[0].sourceUrl,
  });
  assert.notEqual(provenance.contentSha256, f.evidence.provider_requests[0].body_sha256);
  assert.deepEqual(records[0].sourceOccurrences[0].raw.raw_payload.provider_provenance, provenance);
  assert.equal(authorityDomConflictApproved(records[0], approvedRule(), { now }), true);
  assert.notEqual(records[0], f.batch.records[0]);
  assert.notEqual(records[0].raw, f.batch.records[0].raw);
  assert.deepEqual(f, before);
  records[0].raw.raw_payload.source_conflicts[0].dom = 99;
  assert.deepEqual(f, before);
});

test("matching multiple occurrence copies receive independent bound provenance", () => {
  const f = fixture();
  f.batch.records[0].sourceOccurrences.push(
    structuredClone(f.batch.records[0].sourceOccurrences[0]),
  );
  const records = authorityRecordsFromEvidence(f.batch, f.evidence);
  assert.equal(authorityDomConflictApproved(records[0], approvedRule(), { now }), true);
  assert.notEqual(
    records[0].raw.raw_payload.provider_provenance,
    records[0].sourceOccurrences[1].raw.raw_payload.provider_provenance,
  );
});

test("provider html field is supported when rawHtml is absent", () => {
  const f = fixture();
  providerChange(f, (parsed) => {
    parsed.data.html = parsed.data.rawHtml;
    delete parsed.data.rawHtml;
  });
  assert.equal(authorityRecordsFromEvidence(f.batch, f.evidence).length, 1);
});

test("failed provider attempts confer no authority and do not obscure the single success", () => {
  const f = fixture();
  f.evidence.provider_requests.unshift({
    request: { url: f.batch.records[0].sourceUrl },
    provider_status: 402,
    body_base64: "e30=",
    body_sha256: sha256("{}"),
  });
  assert.equal(authorityRecordsFromEvidence(f.batch, f.evidence).length, 1);
});

test("identical successful source responses remain bound to the same HTML digest", () => {
  const f = fixture();
  f.evidence.requests.push(structuredClone(f.evidence.requests[0]));
  assert.equal(authorityRecordsFromEvidence(f.batch, f.evidence).length, 1);
});

for (const [name, change] of [
  ["wrong source batch", (f) => (f.batch.source = "propertyhk")],
  ["wrong scope", (f) => (f.batch.scopeId = "agent:541")],
  ["wrong policy", (f) => (f.batch.policyVersion = "other")],
  ["evidence errors", (f) => f.evidence.errors.push({ reason: "failed" })],
  ["missing candidate", (f) => (f.evidence.selected_candidates = [])],
  [
    "ambiguous candidate",
    (f) => f.evidence.selected_candidates.push(structuredClone(f.evidence.selected_candidates[0])),
  ],
  ["wrong candidate ID", (f) => (f.evidence.selected_candidates[0].property_id = "123")],
  ["wrong candidate deal", (f) => (f.evidence.selected_candidates[0].deal_type = "rent")],
  ["pending candidate", (f) => (f.evidence.selected_candidates[0].status = "pending")],
  ["candidate URL mismatch", (f) => (f.evidence.selected_candidates[0].source_url += "?other")],
  [
    "candidate capture mismatch",
    (f) => (f.evidence.selected_candidates[0].detail_fetched_at = "2026-11-14T03:45:00Z"),
  ],
  [
    "candidate digest mismatch",
    (f) => (f.evidence.selected_candidates[0].detail_body_sha256 = "a".repeat(64)),
  ],
  [
    "malformed candidate digest",
    (f) => (f.evidence.selected_candidates[0].detail_body_sha256 = "bad"),
  ],
  [
    "record re-dated to envelope time",
    (f) => (f.batch.records[0].fetchedAt = "2026-11-14T03:45:00Z"),
  ],
  ["unverified record URL", (f) => (f.batch.records[0].urlIdentityVerified = false)],
  ["duplicate decoded record", (f) => f.batch.records.push(structuredClone(f.batch.records[0]))],
  [
    "raw original time mismatch",
    (f) => (f.batch.records[0].raw.captured_at = "2026-11-14T03:45:00Z"),
  ],
  [
    "raw incremental hash mismatch",
    (f) => (f.batch.records[0].raw.raw_payload.incremental.detail_body_sha256 = "a".repeat(64)),
  ],
  [
    "raw incremental time mismatch",
    (f) =>
      (f.batch.records[0].raw.raw_payload.incremental.detail_fetched_at = "2026-11-14T03:45:00Z"),
  ],
  [
    "raw incremental mode mismatch",
    (f) => (f.batch.records[0].raw.raw_payload.incremental.mode = "other"),
  ],
  ["raw source identity mismatch", (f) => (f.batch.records[0].raw.property_id = "123")],
  ["raw company mismatch", (f) => (f.batch.records[0].raw.agency_property_no = "B123456")],
  ["cached raw", (f) => (f.batch.records[0].raw.observation_kind = "cached")],
  ["missing occurrence", (f) => (f.batch.records[0].sourceOccurrences = [])],
  ["wrong occurrence URL", (f) => (f.batch.records[0].sourceOccurrences[0].sourceUrl += "?other")],
  [
    "wrong occurrence capture",
    (f) => (f.batch.records[0].sourceOccurrences[0].raw.captured_at = "2026-11-14T03:45:00Z"),
  ],
  [
    "wrong occurrence hash",
    (f) =>
      (f.batch.records[0].sourceOccurrences[0].raw.raw_payload.incremental.detail_body_sha256 =
        "a".repeat(64)),
  ],
  [
    "conflicting occurrence DOM",
    (f) => (f.batch.records[0].sourceOccurrences[0].raw.raw_payload.source_conflicts[0].dom = 3),
  ],
  [
    "existing provenance mismatch",
    (f) =>
      (f.batch.records[0].raw.raw_payload.provider_provenance = {
        fetchedAt: stamp,
        contentSha256: "a".repeat(64),
        resolvedUrl: f.batch.records[0].sourceUrl,
      }),
  ],
  ["missing source response", (f) => (f.evidence.requests = [])],
  ["failed source response", (f) => (f.evidence.requests[0].status = 403)],
  ["source HTML mismatch", (f) => (f.evidence.requests[0].html += "changed")],
  [
    "another successful source HTML",
    (f) => f.evidence.requests.push({ ...f.evidence.requests[0], html: "different" }),
  ],
  ["missing provider", (f) => (f.evidence.provider_requests = [])],
  [
    "ambiguous provider",
    (f) => f.evidence.provider_requests.push(structuredClone(f.evidence.provider_requests[0])),
  ],
  ["wrong provider request URL", (f) => (f.evidence.provider_requests[0].request.url += "?other")],
  ["failed provider", (f) => (f.evidence.provider_requests[0].provider_status = 403)],
  [
    "provider body digest mismatch",
    (f) => (f.evidence.provider_requests[0].body_sha256 = "a".repeat(64)),
  ],
  ["noncanonical provider base64", (f) => (f.evidence.provider_requests[0].body_base64 += " ")],
  [
    "provider JSON malformed",
    (f) => {
      f.evidence.provider_requests[0].body_base64 = Buffer.from("{").toString("base64");
      f.evidence.provider_requests[0].body_sha256 = sha256("{");
    },
  ],
  ["provider reports failure", (f) => providerChange(f, (parsed) => (parsed.success = false))],
  [
    "provider source URL mismatch",
    (f) => providerChange(f, (parsed) => (parsed.data.metadata.sourceURL += "?other")),
  ],
  [
    "provider resolved URL mismatch",
    (f) => providerChange(f, (parsed) => (parsed.data.metadata.url += "?other")),
  ],
  [
    "missing actual resolved URL",
    (f) => providerChange(f, (parsed) => delete parsed.data.metadata.url),
  ],
  [
    "missing actual source URL",
    (f) => providerChange(f, (parsed) => delete parsed.data.metadata.sourceURL),
  ],
  [
    "provider source not 200",
    (f) => providerChange(f, (parsed) => (parsed.data.metadata.statusCode = 403)),
  ],
  [
    "provider cached result",
    (f) => providerChange(f, (parsed) => (parsed.data.metadata.cached = true)),
  ],
  [
    "provider HTML mismatch",
    (f) => providerChange(f, (parsed) => (parsed.data.rawHtml += "changed")),
  ],
  [
    "provider second HTML field contradicts rawHtml",
    (f) => providerChange(f, (parsed) => (parsed.data.html = "different")),
  ],
  ["provider no HTML", (f) => providerChange(f, (parsed) => delete parsed.data.rawHtml)],
])
  test("evidence authority rejects " + name + " without mutating inputs", () => {
    const f = fixture();
    change(f);
    const before = structuredClone(f);
    assert.throws(() => authorityRecordsFromEvidence(f.batch, f.evidence), errorMatches);
    assert.deepEqual(f, before);
  });

test("a provider JSON body hash cannot substitute for the source HTML hash", () => {
  const f = fixture();
  const wrong = f.evidence.provider_requests[0].body_sha256;
  f.evidence.selected_candidates[0].detail_body_sha256 = wrong;
  for (const raw of [
    f.batch.records[0].raw,
    ...f.batch.records[0].sourceOccurrences.map((item) => item.raw),
  ])
    raw.raw_payload.incremental.detail_body_sha256 = wrong;
  assert.throws(() => authorityRecordsFromEvidence(f.batch, f.evidence), errorMatches);
});

test("empty delta yields no invented fresh records", () => {
  const f = fixture();
  f.batch.records = [];
  f.batch.payload.listings = [];
  f.evidence.selected_candidates = [];
  assert.deepEqual(authorityRecordsFromEvidence(f.batch, f.evidence), []);
});
