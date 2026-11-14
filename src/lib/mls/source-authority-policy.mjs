import { SnapshotError, POLICY_VERSION, canonicalJson } from "./ingestion-contract.mjs";
import { validIncrementalTimestamp } from "./incremental-contract.mjs";
import { SOURCE_28HSE } from "./source-contract.mjs";

export const SOURCE_AUTHORITY_POLICY = "28hse-authority-v1";
const SCOPE = "agent:540";
const APPROVAL_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_AGE_US = 36n * 3600n * 1000000n;
const FUTURE_SKEW_US = 60n * 1000000n;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, names) =>
  object(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...names].sort());
const approvedRule = (rule) =>
  object(rule) &&
  rule.version === SOURCE_AUTHORITY_POLICY &&
  rule.approved === true &&
  typeof rule.approval_ref === "string" &&
  APPROVAL_REF.test(rule.approval_ref) &&
  rule.source === SOURCE_28HSE &&
  rule.scope_id === SCOPE &&
  rule.policy_version === POLICY_VERSION;

// Only a row read by the caller from the trusted policy table can enable authority.
export function sourceAuthorityPolicy(policyRow) {
  const rule = policyRow?.config?.source_authority;
  if (
    policyRow?.source !== SOURCE_28HSE ||
    policyRow.scope_id !== SCOPE ||
    policyRow.policy_version !== POLICY_VERSION ||
    rule?.approved !== true
  )
    return null;
  if (
    !object(rule) ||
    rule.version !== SOURCE_AUTHORITY_POLICY ||
    typeof rule.approval_ref !== "string" ||
    !APPROVAL_REF.test(rule.approval_ref)
  )
    throw new SnapshotError("invalid_source_authority_policy", 503);
  return Object.freeze({
    version: SOURCE_AUTHORITY_POLICY,
    approved: true,
    approval_ref: rule.approval_ref,
    source: SOURCE_28HSE,
    scope_id: SCOPE,
    policy_version: POLICY_VERSION,
  });
}

function micros(stamp) {
  if (!validIncrementalTimestamp(stamp)) return null;
  const fraction = (stamp.match(/\.(\d+)Z$/)?.[1] ?? "").padEnd(6, "0");
  return BigInt(Date.parse(stamp.slice(0, 19) + "Z")) * 1000n + BigInt(fraction);
}

function currentMicros(now) {
  const value = typeof now === "function" ? now() : now;
  return typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) * 1000n : null;
}

function fresh(stamp, now) {
  const value = micros(stamp);
  return (
    value !== null && now !== null && now - value <= MAX_AGE_US && value - now <= FUTURE_SKEW_US
  );
}

function identityAllowed(record) {
  if (
    !object(record) ||
    record.source !== SOURCE_28HSE ||
    record.sourceIdentityValid !== true ||
    record.urlIdentityVerified !== true ||
    typeof record.agencyPropertyNo !== "string" ||
    !/^[A-Z][0-9]{6}$/.test(record.agencyPropertyNo) ||
    !["sale", "rent"].includes(record.dealType) ||
    typeof record.externalId !== "string" ||
    !/^\d{1,160}$/.test(record.externalId) ||
    (record.advertisementId !== undefined && record.advertisementId !== record.externalId) ||
    typeof record.sourceUrl !== "string"
  )
    return false;
  try {
    const url = new URL(record.sourceUrl);
    const path = url.pathname.match(/^\/(buy|rent)\/[^/%]+\/property-(\d+)\/?$/);
    return (
      url.origin === "https://www.28hse.com" &&
      !url.username &&
      record.sourceUrl.startsWith("https://www.28hse.com/") &&
      !url.port &&
      !url.search &&
      !url.hash &&
      !!path &&
      path[1] === (record.dealType === "sale" ? "buy" : "rent") &&
      path[2] === record.externalId
    );
  } catch {
    return false;
  }
}

function rawCopies(record) {
  if (
    !object(record.raw) ||
    !Array.isArray(record.sourceOccurrences) ||
    !record.sourceOccurrences.length ||
    record.sourceOccurrences.length > 10000 ||
    record.sourceOccurrences.some(
      (occurrence) =>
        !object(occurrence) || occurrence.sourceUrl !== record.sourceUrl || !object(occurrence.raw),
    )
  )
    return null;
  return [record.raw, ...record.sourceOccurrences.map((occurrence) => occurrence.raw)];
}

function captureBound(raw, record) {
  if (raw.property_id !== record.externalId && raw.property_id !== "#" + record.externalId)
    return false;
  if (
    raw.deal_type !== record.dealType ||
    raw.source_url !== record.sourceUrl ||
    raw.agency_property_no !== record.agencyPropertyNo ||
    raw.captured_at !== record.fetchedAt ||
    ["index_only", "cached"].includes(raw.observation_kind) ||
    !object(raw.raw_payload)
  )
    return false;
  const provider = raw.raw_payload.provider_provenance;
  const delta = raw.raw_payload.incremental;
  if (
    provider !== undefined &&
    (!object(provider) ||
      provider.fetchedAt !== raw.captured_at ||
      provider.resolvedUrl !== record.sourceUrl ||
      typeof provider.contentSha256 !== "string" ||
      !DIGEST.test(provider.contentSha256))
  )
    return false;
  if (
    delta !== undefined &&
    (!object(delta) ||
      delta.detail_fetched_at !== raw.captured_at ||
      typeof delta.detail_body_sha256 !== "string" ||
      !DIGEST.test(delta.detail_body_sha256) ||
      (provider !== undefined && delta.detail_body_sha256 !== provider.contentSha256))
  )
    return false;
  return true;
}

export function authorityRecordAllowed(record, rule, { now = Date.now } = {}) {
  if (!approvedRule(rule) || !identityAllowed(record)) return false;
  const time = currentMicros(now);
  const copies = rawCopies(record);
  return (
    fresh(record.fetchedAt, time) &&
    copies !== null &&
    copies.every((raw) => captureBound(raw, record) && fresh(raw.captured_at, time))
  );
}

function conflictsOf(raw) {
  const conflicts = raw.raw_payload.source_conflicts;
  if (conflicts === undefined) return [];
  if (
    !Array.isArray(conflicts) ||
    conflicts.some((conflict) => !object(conflict) || typeof conflict.status !== "string")
  )
    return null;
  return conflicts;
}

// Authority accepts the visible bedroom count only for this tightly bound parser conflict.
// It never removes the original conflict or approves an unknown discrepancy.
export function authorityDomConflictApproved(record, rule, { now = Date.now } = {}) {
  if (!authorityRecordAllowed(record, rule, { now })) return false;
  const copies = rawCopies(record);
  const conflicts = copies.map(conflictsOf);
  if (conflicts.some((items) => items === null)) return false;
  if (!conflicts.some((items) => items.some((conflict) => conflict.status === "review")))
    return true;
  const first = conflicts[0];
  if (first.length !== 1) return false;
  const conflict = first[0];
  if (
    !exactKeys(conflict, ["field", "dom", "json_ld", "resolution", "status"]) ||
    conflict.field !== "bedrooms" ||
    conflict.resolution !== "dom" ||
    conflict.status !== "review" ||
    !Number.isInteger(conflict.dom) ||
    conflict.dom < 0 ||
    conflict.dom > 100 ||
    !Number.isInteger(conflict.json_ld) ||
    conflict.json_ld < 0 ||
    conflict.json_ld > 100 ||
    conflict.dom === conflict.json_ld ||
    record.fields?.bedrooms !== conflict.dom
  )
    return false;
  const provider = record.raw.raw_payload.provider_provenance;
  if (!object(provider)) return false;
  return copies.every((raw, index) => {
    const evidence = raw.raw_payload.provider_provenance;
    return (
      canonicalJson(conflicts[index]) === canonicalJson(first) &&
      object(evidence) &&
      evidence.contentSha256 === provider.contentSha256 &&
      evidence.fetchedAt === record.fetchedAt &&
      evidence.resolvedUrl === record.sourceUrl
    );
  });
}

export function preferredAuthorityRecords(records, rule, { now = Date.now } = {}) {
  if (rule === null || rule === undefined) return [];
  if (!approvedRule(rule)) throw new SnapshotError("invalid_source_authority_policy", 503);
  if (!Array.isArray(records) || records.length > 10000)
    throw new SnapshotError("invalid_source_authority_records", 422);
  const time = typeof now === "function" ? now() : now;
  const groups = new Map();
  for (const record of records) {
    if (!authorityDomConflictApproved(record, rule, { now: time }))
      throw new SnapshotError("invalid_source_authority_record", 422);
    const key = JSON.stringify([record.agencyPropertyNo, record.dealType]);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const sorted = [...group].sort((a, b) => {
        const captureA = micros(a.fetchedAt);
        const captureB = micros(b.fetchedAt);
        if (captureA !== captureB) return captureA > captureB ? -1 : 1;
        const idA = BigInt(a.externalId);
        const idB = BigInt(b.externalId);
        if (idA !== idB) return idA > idB ? -1 : 1;
        return b.externalId.localeCompare(a.externalId);
      });
      const winner = sorted[0];
      if (
        sorted.some(
          (record) =>
            record !== winner &&
            record.externalId === winner.externalId &&
            micros(record.fetchedAt) === micros(winner.fetchedAt) &&
            (canonicalJson(record.fields) !== canonicalJson(winner.fields) ||
              record.sourceUrl !== winner.sourceUrl ||
              record.sourceStatus !== winner.sourceStatus),
        )
      )
        throw new SnapshotError("conflicting_source_authority_records", 422);
      return winner;
    });
}
