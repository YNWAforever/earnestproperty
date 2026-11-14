import { createHash } from "node:crypto";
import { SnapshotError, POLICY_VERSION, canonicalJson } from "./ingestion-contract.mjs";
import { validIncrementalTimestamp } from "./incremental-contract.mjs";
import { SOURCE_28HSE } from "./source-contract.mjs";

const DIGEST = /^[a-f0-9]{64}$/;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (reason) => {
  throw new SnapshotError("invalid_source_authority_evidence", 422, { reason });
};
const recordKey = (id, deal) => JSON.stringify([id, deal]);

function identity(record) {
  if (
    !object(record) ||
    record.source !== SOURCE_28HSE ||
    record.sourceIdentityValid !== true ||
    record.urlIdentityVerified !== true ||
    typeof record.externalId !== "string" ||
    !/^\d{1,160}$/.test(record.externalId) ||
    !["sale", "rent"].includes(record.dealType) ||
    typeof record.sourceUrl !== "string" ||
    !record.sourceUrl.startsWith("https://www.28hse.com/") ||
    !validIncrementalTimestamp(record.fetchedAt)
  )
    fail("invalid_record_identity");
  let url;
  try {
    url = new URL(record.sourceUrl);
  } catch {
    fail("invalid_record_identity");
  }
  const path = url.pathname.match(/^\/(buy|rent)\/[^/%]+\/property-(\d+)\/?$/);
  if (
    url.origin !== "https://www.28hse.com" ||
    url.username ||
    url.port ||
    url.search ||
    url.hash ||
    !path ||
    path[1] !== (record.dealType === "sale" ? "buy" : "rent") ||
    path[2] !== record.externalId
  )
    fail("invalid_record_identity");
}

function rawCopies(record) {
  if (
    !object(record.raw) ||
    !Array.isArray(record.sourceOccurrences) ||
    !record.sourceOccurrences.length ||
    record.sourceOccurrences.some(
      (occurrence) =>
        !object(occurrence) || occurrence.sourceUrl !== record.sourceUrl || !object(occurrence.raw),
    )
  )
    fail("invalid_occurrences");
  return [record.raw, ...record.sourceOccurrences.map((occurrence) => occurrence.raw)];
}

function rawCapture(raw, record, candidate) {
  const delta = raw.raw_payload?.incremental;
  if (
    ![record.externalId, "#" + record.externalId].includes(raw.property_id) ||
    raw.deal_type !== record.dealType ||
    raw.source_url !== record.sourceUrl ||
    raw.agency_property_no !== record.agencyPropertyNo ||
    raw.captured_at !== record.fetchedAt ||
    raw.captured_at !== candidate.detail_fetched_at ||
    ["index_only", "cached"].includes(raw.observation_kind) ||
    !object(raw.raw_payload) ||
    !object(delta) ||
    delta.mode !== "index-delta-v1" ||
    delta.detail_fetched_at !== raw.captured_at ||
    delta.detail_body_sha256 !== candidate.detail_body_sha256 ||
    canonicalJson(raw.raw_payload.source_conflicts ?? []) !==
      canonicalJson(record.raw.raw_payload.source_conflicts ?? [])
  )
    fail("record_capture_mismatch");
  const existing = raw.raw_payload.provider_provenance;
  if (
    existing !== undefined &&
    (!object(existing) ||
      existing.contentSha256 !== candidate.detail_body_sha256 ||
      existing.fetchedAt !== candidate.detail_fetched_at ||
      existing.resolvedUrl !== record.sourceUrl)
  )
    fail("existing_provenance_mismatch");
}

function sourceResponse(evidence, record, digest) {
  const responses = evidence.requests.filter(
    (response) => response?.url === record.sourceUrl && response.status === 200,
  );
  if (!responses.length) fail("source_response_missing");
  if (
    responses.some(
      (response) =>
        typeof response.html !== "string" ||
        !response.html.trim() ||
        Buffer.byteLength(response.html) > 2 * 1024 * 1024 ||
        sha256(response.html) !== digest,
    )
  )
    fail("source_html_digest_mismatch");
}

function providerResponse(evidence, record, digest) {
  const responses = evidence.provider_requests.filter(
    (response) => response?.request?.url === record.sourceUrl && response.provider_status === 200,
  );
  if (responses.length !== 1) fail("provider_response_missing_or_ambiguous");
  const response = responses[0];
  if (
    typeof response.body_base64 !== "string" ||
    response.body_base64.length > 24 * 1024 * 1024 ||
    typeof response.body_sha256 !== "string" ||
    !DIGEST.test(response.body_sha256)
  )
    fail("invalid_provider_bytes");
  const bytes = Buffer.from(response.body_base64, "base64");
  if (
    bytes.length > 16 * 1024 * 1024 ||
    bytes.toString("base64") !== response.body_base64 ||
    sha256(bytes) !== response.body_sha256
  )
    fail("provider_bytes_digest_mismatch");
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("invalid_provider_json");
  }
  const data = parsed?.data;
  const metadata = data?.metadata;
  if (
    parsed?.success !== true ||
    !object(data) ||
    !object(metadata) ||
    metadata.url !== record.sourceUrl ||
    metadata.sourceURL !== record.sourceUrl ||
    metadata.statusCode !== 200 ||
    metadata.error ||
    data.warning ||
    metadata.cached === true ||
    String(metadata.cacheState ?? "").toLowerCase() === "hit"
  )
    fail("provider_source_metadata_mismatch");
  const fields = ["rawHtml", "html"].filter((field) => Object.hasOwn(data, field));
  if (
    !fields.length ||
    fields.some((field) => typeof data[field] !== "string" || sha256(data[field]) !== digest)
  )
    fail("provider_html_digest_mismatch");
  // This is the resolved URL actually returned by the provider, never a fallback URL.
  return metadata.url;
}

export function authorityRecordsFromEvidence(batch, evidence) {
  if (
    !object(batch) ||
    batch.source !== SOURCE_28HSE ||
    batch.scopeId !== "agent:540" ||
    batch.policyVersion !== POLICY_VERSION ||
    !Array.isArray(batch.records) ||
    batch.records.length > 10000 ||
    !object(evidence) ||
    !Array.isArray(evidence.errors) ||
    evidence.errors.length ||
    !Array.isArray(evidence.selected_candidates) ||
    !Array.isArray(evidence.requests) ||
    !Array.isArray(evidence.provider_requests)
  )
    fail("invalid_evidence_envelope");
  const seen = new Set();
  return batch.records.map((record) => {
    identity(record);
    const key = recordKey(record.externalId, record.dealType);
    if (seen.has(key)) fail("duplicate_record_identity");
    seen.add(key);
    const matches = evidence.selected_candidates.filter(
      (candidate) => recordKey(candidate?.property_id, candidate?.deal_type) === key,
    );
    if (matches.length !== 1) fail("candidate_missing_or_ambiguous");
    const candidate = matches[0];
    if (
      candidate.status !== "fetched" ||
      candidate.source_url !== record.sourceUrl ||
      candidate.detail_fetched_at !== record.fetchedAt ||
      !validIncrementalTimestamp(candidate.detail_fetched_at) ||
      typeof candidate.detail_body_sha256 !== "string" ||
      !DIGEST.test(candidate.detail_body_sha256)
    )
      fail("candidate_capture_mismatch");
    const copies = rawCopies(record);
    for (const raw of copies) rawCapture(raw, record, candidate);
    sourceResponse(evidence, record, candidate.detail_body_sha256);
    const resolvedUrl = providerResponse(evidence, record, candidate.detail_body_sha256);
    const result = structuredClone(record);
    for (const raw of rawCopies(result)) {
      raw.raw_payload.provider_provenance = {
        ...raw.raw_payload.provider_provenance,
        contentSha256: candidate.detail_body_sha256,
        fetchedAt: candidate.detail_fetched_at,
        resolvedUrl,
      };
    }
    return result;
  });
}
