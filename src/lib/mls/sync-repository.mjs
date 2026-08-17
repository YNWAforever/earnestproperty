import {
  SOURCE_28HSE,
  SOURCE_OLD_SITE,
  buildMatchKey,
  normalizePropertyNo,
  stableObservationHash,
} from "./source-contract.mjs";

const SOURCES = new Set([SOURCE_28HSE, SOURCE_OLD_SITE]);
const DEAL_TYPES = new Set(["sale", "rent"]);
const RUN_MODES = new Set(["shadow", "publish"]);
const RUN_STATUSES = new Set([
  "running",
  "shadow_healthy",
  "healthy",
  "degraded",
  "blocked",
  "failed",
  "lock_skipped",
]);
const FINAL_RUN_STATUSES = new Set([...RUN_STATUSES].filter((status) => status !== "running"));
const LINK_STATUSES = new Set(["proposed", "active", "rejected"]);
const MEDIA_ELIGIBILITIES = new Set(["eligible", "rejected", "upload_failed"]);
const BATCH_SIZE = 200;
const MAX_JSON_BYTES = 1_000_000;
const MAX_INT = 2_147_483_647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const CREDENTIAL_VALUE_PATTERN_SOURCE = String.raw`(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)`;
const CREDENTIAL_LABEL_PATTERN_SOURCE = String.raw`(?:x[-_ ]?)?api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|passwd`;
const AUTHORIZATION_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b(authorization)\s*[:=]\s*(?:(?:bearer|basic)\s+)?${CREDENTIAL_VALUE_PATTERN_SOURCE}`,
  "gi",
);
const STANDALONE_SCHEME_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b(bearer|basic)\s+${CREDENTIAL_VALUE_PATTERN_SOURCE}`,
  "gi",
);
const NAMED_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b(${CREDENTIAL_LABEL_PATTERN_SOURCE})(?:\s*[:=]\s*|\s+(?:(?:is|was)(?:\s*[:=]\s*|\s+))?)${CREDENTIAL_VALUE_PATTERN_SOURCE}`,
  "gi",
);
const OBSERVATION_KEYS = new Set([
  "schemaVersion",
  "source",
  "externalId",
  "dealType",
  "sourceUrl",
  "propertyNoRaw",
  "propertyNoNormalized",
  "matchKey",
  "fields",
  "rawFields",
  "mediaCandidates",
  "sourceUpdatedAt",
  "discoveredAt",
  "fetchedAt",
  "contentHash",
  "validationState",
  "quarantineReasons",
  "parseWarnings",
]);
const OWNED_MEDIA_INPUT_KEYS = new Set([
  "url",
  "pathname",
  "contentType",
  "sizeBytes",
  "contentHash",
  "ownerType",
  "ownerId",
  "createdBy",
]);
const MEDIA_RECORD_INPUT_KEYS = new Set([
  "observationId",
  "propertyId",
  "sourceUrl",
  "contentHash",
  "ownedMediaAssetId",
  "detectedMime",
  "sizeBytes",
  "width",
  "height",
  "eligibility",
  "rejectionReason",
]);

function isPlainRecord(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainRecord(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.size && ownKeys.every((key) => typeof key === "string" && keys.has(key))
  );
}

function exactInputSnapshot(value, keys) {
  if (!hasExactKeys(value, keys)) return null;
  return Object.freeze(Object.fromEntries([...keys].map((key) => [key, value[key]])));
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function requireUuid(value, label) {
  if (!isUuid(value)) throw new TypeError(`${label} must be a canonical UUID`);
  return value;
}

function isSource(value) {
  return SOURCES.has(value);
}

function isDealType(value) {
  return DEAL_TYPES.has(value);
}

function isExternalId(value) {
  return typeof value === "string" && EXTERNAL_ID_PATTERN.test(value);
}

function requireSafeText(value, label, { max = 500, nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function isCanonicalDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function requireDate(value, label) {
  if (!isCanonicalDate(value)) throw new TypeError(`${label} must be a canonical date`);
  return value;
}

function canonicalTimestamp(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  ) {
    return value;
  }
  return null;
}

function isTimestamp(value) {
  return canonicalTimestamp(value) != null;
}

function requireTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const canonical = canonicalTimestamp(value);
  if (canonical == null) throw new TypeError(`${label} must be a canonical timestamp`);
  return canonical;
}

function requireObservationTimestamp(value, label, { nullable = false, allowDate = false } = {}) {
  if (value === null) {
    if (nullable) return null;
    throw new TypeError(`${label} must be an ISO timestamp string`);
  }
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new TypeError(`${label} must be an ISO timestamp string`);
  }
  if (allowDate && isCanonicalDate(value)) return value;
  const matched = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!matched) throw new TypeError(`${label} must be an ISO timestamp string`);
  const [, year, month, day, hourText, minuteText, secondText, zone] = matched;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (!isCanonicalDate(`${year}-${month}-${day}`) || hour > 23 || minute > 59 || second > 59) {
    throw new TypeError(`${label} must be an ISO timestamp string`);
  }
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      throw new TypeError(`${label} must be an ISO timestamp string`);
    }
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp string`);
  }
  return value;
}

function observationTimestampInstant(value) {
  return new Date(value).toISOString();
}

function requireUrl(value, label = "URL") {
  if (typeof value !== "string" || value.length > 2_048 || value !== value.trim()) {
    throw new TypeError(`${label} is invalid`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function inspectJson(value, seen = new Set(), depth = 0) {
  if (depth > 50) throw new TypeError("JSON nesting is too deep");
  if (value == null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return;
  }
  if (typeof value !== "object") throw new TypeError("JSON contains an unsupported value");
  if (seen.has(value)) throw new TypeError("JSON contains a cycle");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) inspectJson(child, seen, depth + 1);
  } else {
    if (!isPlainRecord(value)) throw new TypeError("JSON objects must be plain records");
    for (const [key, child] of Object.entries(value)) {
      if (!key || key.length > 500) throw new TypeError("JSON contains an invalid key");
      inspectJson(child, seen, depth + 1);
    }
  }
  seen.delete(value);
}

function serializeJson(value, label) {
  try {
    inspectJson(value);
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
      throw new TypeError(`${label} JSON is too large`);
    }
    return serialized;
  } catch (error) {
    if (error instanceof TypeError && /JSON/.test(error.message)) throw error;
    throw new TypeError(`${label} JSON is invalid`, { cause: error });
  }
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJsonValue(value[key])]),
    );
  }
  return value;
}

function databaseJson(value, label) {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value);
    } catch (error) {
      throw new TypeError(`${label} is invalid JSON`, { cause: error });
    }
  }
  serializeJson(decoded, label);
  return decoded;
}

function jsonEqual(left, right) {
  return JSON.stringify(stableJsonValue(left)) === JSON.stringify(stableJsonValue(right));
}

function isDeepFrozen(value, seen = new Set()) {
  if (value == null || typeof value !== "object") return true;
  if (seen.has(value) || !Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => isDeepFrozen(value[key], seen));
}

function requireStringArray(value, label, { maxItems = 200, maxLength = 500 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be a bounded string array`);
  }
  for (const item of value) requireSafeText(item, label, { max: maxLength });
  if (new Set(value).size !== value.length) throw new TypeError(`${label} contains duplicates`);
  return value;
}

function validateListingFields(fields) {
  if (!isPlainRecord(fields)) throw new TypeError("observation fields must be a plain record");
  const stringFields = new Set([
    "title_zh",
    "title_en",
    "estate_slug",
    "district_slug",
    "address",
    "floor",
    "orientation",
    "description",
    "status",
  ]);
  const numberFields = new Set([
    "price",
    "rent",
    "saleable_area",
    "gross_area",
    "bedrooms",
    "bathrooms",
  ]);
  for (const [key, value] of Object.entries(fields)) {
    if (stringFields.has(key)) {
      if (value !== null && (typeof value !== "string" || value.length > 20_000)) {
        throw new TypeError(`observation field ${key} is invalid`);
      }
    } else if (numberFields.has(key)) {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new TypeError(`observation field ${key} is invalid`);
      }
    } else if (key === "features") {
      if (value !== null) requireStringArray(value, "observation features", { maxItems: 200 });
    } else {
      throw new TypeError(`observation field ${key} is unsupported`);
    }
  }
}

function validateMediaCandidate(candidate) {
  if (!isPlainRecord(candidate)) throw new TypeError("observation media candidate is invalid");
  requireUrl(candidate.url, "observation media URL");
  const categories = new Set([
    "listing_photo",
    "map",
    "floorplan",
    "qr",
    "vr",
    "branded",
    "unknown",
  ]);
  if (!categories.has(candidate.category) || typeof candidate.isPrimary !== "boolean") {
    throw new TypeError("observation media candidate is invalid");
  }
  for (const key of ["rejected", "eligible", "contextRejected"]) {
    if (candidate[key] != null && typeof candidate[key] !== "boolean") {
      throw new TypeError("observation media candidate is invalid");
    }
  }
  if (candidate.rejectionReason != null) {
    requireSafeText(candidate.rejectionReason, "media rejection reason", { max: 500 });
  }
  for (const key of ["rejectionReasons", "contextRejectionMarkers"]) {
    if (candidate[key] != null) requireStringArray(candidate[key], key, { maxItems: 100 });
  }
}

function validateObservation(observation) {
  if (!hasExactKeys(observation, OBSERVATION_KEYS) || !isDeepFrozen(observation)) {
    throw new TypeError("SourceObservation must be complete and deeply immutable");
  }
  if (observation.schemaVersion !== 1 || !isSource(observation.source)) {
    throw new TypeError("SourceObservation schema or source is invalid");
  }
  if (!isExternalId(observation.externalId) || !isDealType(observation.dealType)) {
    throw new TypeError("SourceObservation identity is invalid");
  }
  requireUrl(observation.sourceUrl, "observation source URL");
  if (observation.propertyNoRaw !== null && typeof observation.propertyNoRaw !== "string") {
    throw new TypeError("SourceObservation property number is invalid");
  }
  const propertyNo = normalizePropertyNo(observation.propertyNoNormalized);
  const normalizedRawPropertyNo = normalizePropertyNo(observation.propertyNoRaw);
  const normalizedIdentityIsValid =
    observation.propertyNoNormalized == null
      ? observation.propertyNoNormalized === null &&
        observation.matchKey === null &&
        normalizedRawPropertyNo === null &&
        observation.validationState === "quarantined"
      : propertyNo === observation.propertyNoNormalized &&
        normalizedRawPropertyNo === propertyNo &&
        observation.matchKey === buildMatchKey(propertyNo, observation.dealType);
  if (!normalizedIdentityIsValid) {
    throw new TypeError("SourceObservation normalized identity is invalid");
  }
  validateListingFields(observation.fields);
  if (!isPlainRecord(observation.rawFields)) {
    throw new TypeError("SourceObservation rawFields are invalid");
  }
  if (!Array.isArray(observation.mediaCandidates) || observation.mediaCandidates.length > 500) {
    throw new TypeError("SourceObservation mediaCandidates are invalid");
  }
  observation.mediaCandidates.forEach(validateMediaCandidate);
  requireObservationTimestamp(observation.sourceUpdatedAt, "SourceObservation sourceUpdatedAt", {
    nullable: true,
    allowDate: true,
  });
  requireObservationTimestamp(observation.discoveredAt, "SourceObservation discoveredAt");
  requireObservationTimestamp(observation.fetchedAt, "SourceObservation fetchedAt");
  if (!HASH_PATTERN.test(observation.contentHash)) {
    throw new TypeError("SourceObservation content hash is invalid");
  }
  if (!new Set(["valid", "quarantined"]).has(observation.validationState)) {
    throw new TypeError("SourceObservation validation state is invalid");
  }
  requireStringArray(observation.quarantineReasons, "observation quarantine reasons");
  requireStringArray(observation.parseWarnings, "observation parse warnings");
  if ((observation.validationState === "valid") !== (observation.quarantineReasons.length === 0)) {
    throw new TypeError("SourceObservation validation evidence is inconsistent");
  }
  const expectedHash = stableObservationHash({
    schemaVersion: observation.schemaVersion,
    source: observation.source,
    externalId: observation.externalId,
    dealType: observation.dealType,
    propertyNoNormalized: observation.propertyNoNormalized,
    fields: observation.fields,
    rawFields: observation.rawFields,
    mediaCandidates: observation.mediaCandidates,
    sourceUpdatedAt: observation.sourceUpdatedAt,
  });
  if (expectedHash !== observation.contentHash) {
    throw new TypeError("SourceObservation content hash does not match its evidence");
  }
  const payload = serializeJson(
    {
      schemaVersion: observation.schemaVersion,
      fields: observation.fields,
      rawFields: observation.rawFields,
      sourceUpdatedAt: observation.sourceUpdatedAt,
      parseWarnings: observation.parseWarnings,
    },
    "observation payload",
  );
  const media = serializeJson(observation.mediaCandidates, "observation mediaCandidates");
  return { payload, media };
}

function observationIdentity(value) {
  return `${value.source}\u0000${value.externalId}\u0000${value.dealType}`;
}

function chunks(values, size = BATCH_SIZE) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function validateQueryResult(result, label) {
  if (
    !isPlainRecord(result) ||
    !Array.isArray(result.rows) ||
    (result.rowCount != null && (!Number.isInteger(result.rowCount) || result.rowCount < 0))
  ) {
    throw new TypeError(`${label} returned a malformed database result`);
  }
  return result.rows;
}

function subtractDays(dateValue, count) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function hongKongMidnightUtc(dateValue) {
  return new Date(`${dateValue}T00:00:00+08:00`).toISOString();
}

function redactedText(value, label, { max = 1_000, nullable = true } = {}) {
  if (value == null) {
    if (nullable) return null;
    throw new TypeError(`${label} must be text`);
  }
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
  let text = value.trim();
  if (!text) {
    if (nullable) return null;
    throw new TypeError(`${label} must not be empty`);
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new TypeError(`${label} contains unsafe control characters`);
  }
  text = text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(AUTHORIZATION_CREDENTIAL_PATTERN, "$1=[redacted]")
    .replace(NAMED_CREDENTIAL_PATTERN, "$1 [redacted]")
    .replace(STANDALONE_SCHEME_CREDENTIAL_PATTERN, "$1 [redacted]")
    .replace(/\b(?:sk|pk)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
  if (text.length > max) text = `${text.slice(0, Math.max(0, max - 1))}…`;
  return text;
}

function validateSourceStatus(value) {
  if (!isPlainRecord(value)) throw new TypeError("sourceStatus JSON is invalid");
  for (const [source, status] of Object.entries(value)) {
    if (
      !isSource(source) ||
      !isPlainRecord(status) ||
      status.source !== source ||
      typeof status.healthy !== "boolean"
    ) {
      throw new TypeError("sourceStatus JSON is invalid");
    }
    requireStringArray(status.reasons, "source status reasons", { maxItems: 200 });
    if (status.healthy === status.reasons.length > 0) {
      throw new TypeError("sourceStatus health and reasons are inconsistent");
    }
  }
  return serializeJson(value, "sourceStatus");
}

function validateEvaluation(evaluation) {
  if (!isPlainRecord(evaluation)) throw new TypeError("run evaluation is invalid");
  if (!isPlainRecord(evaluation.counts)) throw new TypeError("counts must be a JSON record");
  if (!isPlainRecord(evaluation.baselines)) {
    throw new TypeError("baselines must be a JSON record");
  }
  return {
    sourceStatus: validateSourceStatus(evaluation.sourceStatus),
    counts: serializeJson(evaluation.counts, "counts"),
    baselines: serializeJson(evaluation.baselines, "baselines"),
  };
}

function sourceStatusPair(sourceStatus) {
  const hse28 = sourceStatus[SOURCE_28HSE];
  const oldSite = sourceStatus[SOURCE_OLD_SITE];
  return {
    hse28,
    oldSite,
    hse28Healthy: isPlainRecord(hse28) && hse28.source === SOURCE_28HSE && hse28.healthy === true,
    hse28Unhealthy:
      isPlainRecord(hse28) && hse28.source === SOURCE_28HSE && hse28.healthy === false,
    oldSiteHealthy:
      isPlainRecord(oldSite) && oldSite.source === SOURCE_OLD_SITE && oldSite.healthy === true,
    oldSiteUnhealthy:
      isPlainRecord(oldSite) && oldSite.source === SOURCE_OLD_SITE && oldSite.healthy === false,
  };
}

function validateCompletionSemantics(completion) {
  if (completion.status === "failed" || completion.status === "lock_skipped") return;
  const status = sourceStatusPair(completion.sourceStatus);
  const consistent =
    completion.status === "healthy" || completion.status === "shadow_healthy"
      ? status.hse28Healthy && status.oldSiteHealthy
      : completion.status === "degraded"
        ? status.hse28Healthy && status.oldSiteUnhealthy
        : completion.status === "blocked"
          ? status.hse28Unhealthy && (status.oldSiteHealthy || status.oldSiteUnhealthy)
          : false;
  if (!consistent) {
    throw new TypeError("final run status is inconsistent with source health");
  }
}

function validatePersistedObservationRow(row, expectedByIdentity) {
  const persistedPropertyNo = row?.property_no_normalized;
  let payload;
  let mediaCandidates;
  let discoveredAt;
  let fetchedAt;
  try {
    payload = databaseJson(row?.payload, "persisted observation payload");
    mediaCandidates = databaseJson(row?.media_candidates, "persisted observation media candidates");
    discoveredAt = requireTimestamp(row?.discovered_at, "persisted observation discovered_at");
    fetchedAt = requireTimestamp(row?.fetched_at, "persisted observation fetched_at");
  } catch (error) {
    throw new TypeError("persisted observation row is invalid", { cause: error });
  }
  const valid =
    isPlainRecord(row) &&
    isUuid(row.id) &&
    isSource(row.source) &&
    isExternalId(row.external_listing_id) &&
    isDealType(row.deal_type) &&
    typeof row.source_url === "string" &&
    (row.property_no_raw == null || typeof row.property_no_raw === "string") &&
    (persistedPropertyNo === null ||
      (typeof persistedPropertyNo === "string" &&
        normalizePropertyNo(persistedPropertyNo) === persistedPropertyNo)) &&
    HASH_PATTERN.test(row.content_hash) &&
    hasExactKeys(
      payload,
      new Set(["schemaVersion", "fields", "rawFields", "sourceUpdatedAt", "parseWarnings"]),
    ) &&
    Array.isArray(mediaCandidates) &&
    new Set(["valid", "quarantined"]).has(row.validation_state) &&
    Array.isArray(row.quarantine_reasons) &&
    Array.isArray(row.parse_warnings);
  if (!valid) throw new TypeError("persisted observation row is invalid");
  try {
    requireUrl(row.source_url, "persisted observation source URL");
    requireStringArray(row.quarantine_reasons, "persisted observation quarantine reasons");
    requireStringArray(row.parse_warnings, "persisted observation parse warnings");
  } catch (error) {
    throw new TypeError("persisted observation row is invalid", { cause: error });
  }
  const identity = observationIdentity({
    source: row.source,
    externalId: row.external_listing_id,
    dealType: row.deal_type,
  });
  const expected = expectedByIdentity.get(identity);
  if (
    !expected ||
    row.source_url !== expected.sourceUrl ||
    row.property_no_raw !== expected.propertyNoRaw ||
    row.property_no_normalized !== expected.propertyNoNormalized ||
    row.content_hash !== expected.contentHash ||
    row.validation_state !== expected.validationState ||
    discoveredAt !== observationTimestampInstant(expected.discoveredAt) ||
    fetchedAt !== observationTimestampInstant(expected.fetchedAt) ||
    !jsonEqual(payload, {
      schemaVersion: expected.schemaVersion,
      fields: expected.fields,
      rawFields: expected.rawFields,
      sourceUpdatedAt: expected.sourceUpdatedAt,
      parseWarnings: expected.parseWarnings,
    }) ||
    !jsonEqual(mediaCandidates, expected.mediaCandidates) ||
    !jsonEqual(row.quarantine_reasons, expected.quarantineReasons) ||
    !jsonEqual(row.parse_warnings, expected.parseWarnings)
  ) {
    throw new TypeError("persisted observation row does not match immutable evidence");
  }
  return Object.freeze({
    id: row.id,
    source: row.source,
    externalId: row.external_listing_id,
    dealType: row.deal_type,
    propertyNoNormalized: row.property_no_normalized,
    matchKey: buildMatchKey(row.property_no_normalized, row.deal_type),
    contentHash: row.content_hash,
  });
}

export function createSyncRepository(options = {}) {
  const client = options.client;
  if (!client || typeof client.query !== "function") {
    throw new TypeError("client.query is required for the sync repository");
  }

  function operationSignal(operation) {
    if (operation == null) return null;
    if (
      !isPlainRecord(operation) ||
      Reflect.ownKeys(operation).some((key) => key !== "signal") ||
      (operation.signal != null && !(operation.signal instanceof AbortSignal))
    ) {
      throw new TypeError("repository operation signal is invalid");
    }
    return operation.signal ?? null;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }
  }

  async function query(statement, params = [], label = "repository query", operation) {
    const signal = operationSignal(operation);
    throwIfAborted(signal);
    const result = await client.query(statement, params);
    throwIfAborted(signal);
    return validateQueryResult(result, label);
  }

  async function beginRun(input) {
    if (!isPlainRecord(input)) throw new TypeError("beginRun input is invalid");
    requireDate(input.scheduledFor, "scheduledFor");
    if (!RUN_MODES.has(input.mode)) throw new TypeError("mode is invalid");
    requireSafeText(input.parserVersion, "parserVersion", { max: 160 });
    await query(
      `UPDATE listing_sync_runs
          SET status = 'failed',
              finished_at = now(),
              failure_code = $1,
              failure_summary = $2
        WHERE status = 'running'`,
      ["orphaned_run_reconciled", "orphaned_run_reconciled"],
      "orphan run reconciliation",
    );
    const rows = await query(
      `INSERT INTO listing_sync_runs (scheduled_for, mode, status, parser_version)
       VALUES ($1::date, $2, 'running', $3)
       RETURNING id`,
      [input.scheduledFor, input.mode, input.parserVersion],
      "begin run",
    );
    if (rows.length !== 1 || !isUuid(rows[0]?.id)) {
      throw new TypeError("run row did not return one canonical UUID");
    }
    return { runId: rows[0].id };
  }

  async function saveObservations(runId, observations) {
    requireUuid(runId, "runId");
    if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
    const prepared = [];
    const expectedByIdentity = new Map();
    for (const observation of observations) {
      const identity = observationIdentity(observation ?? {});
      if (expectedByIdentity.has(identity)) {
        throw new TypeError("duplicate observation identity");
      }
      const serialized = validateObservation(observation);
      expectedByIdentity.set(identity, observation);
      prepared.push({ observation, ...serialized });
    }
    const returnedByIdentity = new Map();
    const ids = new Set();
    for (const batch of chunks(prepared)) {
      if (batch.length === 0) continue;
      const insertParams = [];
      const insertValues = batch.map(({ observation, payload, media }, rowIndex) => {
        const start = rowIndex * 15;
        insertParams.push(
          runId,
          observation.source,
          observation.externalId,
          observation.dealType,
          observation.sourceUrl,
          observation.propertyNoRaw,
          observation.propertyNoNormalized,
          payload,
          media,
          observation.contentHash,
          observation.validationState,
          [...observation.quarantineReasons],
          [...observation.parseWarnings],
          observation.discoveredAt,
          observation.fetchedAt,
        );
        return `($${start + 1}::uuid, $${start + 2}, $${start + 3}, $${start + 4}::deal_type, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8}::jsonb, $${start + 9}::jsonb, $${start + 10}, $${start + 11}, $${start + 12}::text[], $${start + 13}::text[], $${start + 14}::timestamptz, $${start + 15}::timestamptz)`;
      });
      await query(
        `INSERT INTO listing_source_observations
          (run_id, source, external_listing_id, deal_type, source_url,
           property_no_raw, property_no_normalized, payload, media_candidates,
           content_hash, validation_state, quarantine_reasons, parse_warnings,
           discovered_at, fetched_at)
         VALUES ${insertValues.join(", ")}
         ON CONFLICT (run_id, source, external_listing_id, deal_type) DO NOTHING`,
        insertParams,
        "save observations",
      );

      const selectParams = [runId];
      const tuples = batch.map(({ observation }, index) => {
        selectParams.push(observation.source, observation.externalId, observation.dealType);
        const start = 2 + index * 3;
        return `($${start}, $${start + 1}, $${start + 2}::deal_type)`;
      });
      const batchExpectedByIdentity = new Map(
        batch.map(({ observation }) => [observationIdentity(observation), observation]),
      );
      const rows = await query(
        `SELECT id, source, external_listing_id, deal_type, source_url,
                property_no_raw, property_no_normalized, payload, media_candidates,
                content_hash, validation_state, quarantine_reasons, parse_warnings,
                discovered_at, fetched_at
           FROM listing_source_observations
          WHERE run_id = $1::uuid
            AND (source, external_listing_id, deal_type) IN (${tuples.join(", ")})
          ORDER BY source, external_listing_id, deal_type, id`,
        selectParams,
        "load persisted observations",
      );
      if (rows.length !== batch.length) {
        throw new TypeError("persisted observation rows do not match the requested batch");
      }
      for (const row of rows) {
        const ref = validatePersistedObservationRow(row, batchExpectedByIdentity);
        const identity = observationIdentity(ref);
        if (returnedByIdentity.has(identity) || ids.has(ref.id)) {
          throw new TypeError("persisted observation rows contain a duplicate");
        }
        returnedByIdentity.set(identity, ref);
        ids.add(ref.id);
      }
    }
    if (returnedByIdentity.size !== observations.length) {
      throw new TypeError("persisted observation rows are missing immutable evidence");
    }
    return observations.map((observation) => {
      const ref = returnedByIdentity.get(observationIdentity(observation));
      if (!ref) throw new TypeError("persisted observation row is missing");
      return ref;
    });
  }

  async function recordRunEvaluation(runId, evaluation) {
    requireUuid(runId, "runId");
    const serialized = validateEvaluation(evaluation);
    const rows = await query(
      `UPDATE listing_sync_runs
          SET source_status = $2::jsonb,
              counts = $3::jsonb,
              baselines = $4::jsonb
        WHERE id = $1::uuid AND status = 'running'
        RETURNING id`,
      [runId, serialized.sourceStatus, serialized.counts, serialized.baselines],
      "record run evaluation",
    );
    if (rows.length !== 1 || rows[0]?.id !== runId) {
      throw new Error("running run was not found for evaluation");
    }
  }

  async function finishRun(runId, completion) {
    requireUuid(runId, "runId");
    if (!isPlainRecord(completion) || !FINAL_RUN_STATUSES.has(completion.status)) {
      throw new TypeError("final run status is invalid");
    }
    const serialized = validateEvaluation(completion);
    validateCompletionSemantics(completion);
    const failureCode =
      completion.failureCode == null
        ? null
        : requireSafeText(completion.failureCode, "failureCode", { max: 160 });
    const failureSummary = redactedText(completion.failureSummary, "failureSummary", {
      max: 1_000,
    });
    const rows = await query(
      `UPDATE listing_sync_runs
          SET status = $2,
              source_status = $3::jsonb,
              counts = $4::jsonb,
              baselines = $5::jsonb,
              failure_code = $6,
              failure_summary = $7,
              finished_at = now()
        WHERE id = $1::uuid AND status = 'running'
        RETURNING id`,
      [
        runId,
        completion.status,
        serialized.sourceStatus,
        serialized.counts,
        serialized.baselines,
        failureCode,
        failureSummary,
      ],
      "finish run",
    );
    if (rows.length !== 1 || rows[0]?.id !== runId) {
      throw new Error("running run was not found for completion");
    }
  }

  function validateCountSnapshot(value, label = "history row") {
    if (
      !isPlainRecord(value) ||
      !Number.isInteger(value.sale) ||
      value.sale < 0 ||
      value.sale > MAX_INT ||
      !Number.isInteger(value.rent) ||
      value.rent < 0 ||
      value.rent > MAX_INT
    ) {
      throw new TypeError(`${label} has an invalid count snapshot`);
    }
    return { sale: value.sale, rent: value.rent };
  }

  async function getHealthyCountHistory(source, limit = 7) {
    if (!isSource(source)) throw new TypeError("source is invalid");
    if (!Number.isInteger(limit) || limit < 1 || limit > 365) {
      throw new TypeError("history limit must be between 1 and 365");
    }
    const rows = await query(
      `WITH date_ranked AS (
         SELECT scheduled_for::text AS scheduled_for,
                counts -> $1 AS snapshot,
                source_status -> $1 AS health,
                row_number() OVER (PARTITION BY scheduled_for ORDER BY finished_at DESC, id DESC) AS date_rank
          FROM listing_sync_runs
          WHERE finished_at IS NOT NULL
       )
       SELECT scheduled_for, snapshot
         FROM date_ranked
        WHERE date_rank = 1 AND health ->> 'healthy' = 'true'
        ORDER BY scheduled_for DESC
        LIMIT $2`,
      [source, limit],
      "healthy count history",
    );
    const seenDates = new Set();
    let priorDate = null;
    return rows.map((row) => {
      if (!isPlainRecord(row) || !isCanonicalDate(row.scheduled_for)) {
        throw new TypeError("history row is invalid");
      }
      if (
        seenDates.has(row.scheduled_for) ||
        (priorDate != null && row.scheduled_for >= priorDate)
      ) {
        throw new TypeError("history rows are duplicated or unordered");
      }
      seenDates.add(row.scheduled_for);
      priorDate = row.scheduled_for;
      return validateCountSnapshot(row.snapshot);
    });
  }

  function allSourcesHealthy(sourceStatus) {
    if (!isPlainRecord(sourceStatus)) return false;
    return [SOURCE_28HSE, SOURCE_OLD_SITE].every(
      (source) =>
        isPlainRecord(sourceStatus[source]) &&
        sourceStatus[source].source === source &&
        sourceStatus[source].healthy === true &&
        Array.isArray(sourceStatus[source].reasons) &&
        sourceStatus[source].reasons.length === 0,
    );
  }

  async function approveShadowRun(runId, approval) {
    requireUuid(runId, "runId");
    if (!isPlainRecord(approval)) throw new TypeError("approval is invalid");
    const reviewer = redactedText(approval.reviewer, "reviewer", {
      max: 200,
      nullable: false,
    });
    const note = redactedText(approval.note, "approval note", { max: 1_000 });
    const rows = await query(
      `UPDATE listing_sync_runs
          SET baseline_approved_at = now(),
              baseline_approved_by = $2,
              baseline_approval_note = $3
        WHERE id = $1::uuid
          AND mode = 'shadow'
          AND status = 'shadow_healthy'
          AND baseline_approved_at IS NULL
          AND source_status -> '${SOURCE_28HSE}' ->> 'healthy' = 'true'
          AND source_status -> '${SOURCE_OLD_SITE}' ->> 'healthy' = 'true'
          AND jsonb_array_length(COALESCE(source_status -> '${SOURCE_28HSE}' -> 'reasons', '[]'::jsonb)) = 0
          AND jsonb_array_length(COALESCE(source_status -> '${SOURCE_OLD_SITE}' -> 'reasons', '[]'::jsonb)) = 0
        RETURNING id, baseline_approved_at`,
      [runId, reviewer, note],
      "approve shadow run",
    );
    if (rows.length !== 1 || rows[0]?.id !== runId) {
      throw new Error("healthy shadow run was not found for approval");
    }
    const approvedAt = requireTimestamp(rows[0].baseline_approved_at, "shadow approval timestamp");
    if (Date.parse(approvedAt) > Date.now()) {
      throw new TypeError("shadow approval timestamp cannot be in the future");
    }
  }

  function validateStreakRow(row, beforeDate) {
    if (
      !isPlainRecord(row) ||
      !isUuid(row.id) ||
      !isCanonicalDate(row.scheduled_for) ||
      !isTimestamp(row.finished_at) ||
      !RUN_STATUSES.has(row.status) ||
      (row.baseline_approved_at != null && !isTimestamp(row.baseline_approved_at)) ||
      !isPlainRecord(row.source_status)
    ) {
      throw new TypeError("shadow streak row is invalid");
    }
    const validated = {
      ...row,
      finished_at: requireTimestamp(row.finished_at, "shadow streak finished_at"),
      baseline_approved_at: requireTimestamp(
        row.baseline_approved_at,
        "shadow streak baseline_approved_at",
        { nullable: true },
      ),
    };
    if (validated.baseline_approved_at != null) {
      if (Date.parse(validated.baseline_approved_at) > Date.now()) {
        throw new TypeError("shadow approval timestamp cannot be in the future");
      }
      if (validated.baseline_approved_at >= hongKongMidnightUtc(beforeDate)) {
        throw new TypeError("shadow approval must predate the prospective publish date");
      }
    }
    return validated;
  }

  async function getApprovedHealthyShadowStreak(beforeDate) {
    requireDate(beforeDate, "beforeDate");
    const rows = await query(
      `WITH ranked AS (
         SELECT id, scheduled_for::text AS scheduled_for, finished_at, status,
                baseline_approved_at, source_status,
                row_number() OVER (PARTITION BY scheduled_for ORDER BY finished_at DESC, id DESC) AS date_rank
           FROM listing_sync_runs
          WHERE scheduled_for < $1::date
            AND mode = 'shadow'
            AND finished_at IS NOT NULL
       )
       SELECT id, scheduled_for, finished_at, status, baseline_approved_at, source_status
         FROM ranked
        ORDER BY scheduled_for DESC, finished_at DESC, id DESC`,
      [beforeDate],
      "approved shadow streak",
    );
    const latestByDate = new Map();
    for (const rawRow of rows) {
      const row = validateStreakRow(rawRow, beforeDate);
      const previous = latestByDate.get(row.scheduled_for);
      if (
        !previous ||
        row.finished_at > previous.finished_at ||
        (row.finished_at === previous.finished_at && row.id > previous.id)
      ) {
        latestByDate.set(row.scheduled_for, row);
      }
    }
    const dates = [...latestByDate.keys()].sort().reverse();
    let expectedDate = subtractDays(beforeDate, 1);
    let length = 0;
    let lastDate = null;
    for (const date of dates) {
      if (date !== expectedDate) break;
      const row = latestByDate.get(date);
      if (
        row.status !== "shadow_healthy" ||
        row.baseline_approved_at == null ||
        !allSourcesHealthy(row.source_status)
      ) {
        break;
      }
      if (lastDate == null) lastDate = date;
      length += 1;
      expectedDate = subtractDays(expectedDate, 1);
    }
    return { length, lastDate };
  }

  function parseRequestedMatchKeys(matchKeys) {
    if (!Array.isArray(matchKeys) || matchKeys.length > 5_000) {
      throw new TypeError("matchKeys must be a bounded array");
    }
    const output = [];
    const seen = new Set();
    for (const matchKey of matchKeys) {
      if (typeof matchKey !== "string") throw new TypeError("match key is invalid");
      const separator = matchKey.indexOf(":");
      const dealType = matchKey.slice(0, separator);
      const propertyNo = matchKey.slice(separator + 1);
      if (
        separator <= 0 ||
        !isDealType(dealType) ||
        normalizePropertyNo(propertyNo) !== propertyNo ||
        buildMatchKey(propertyNo, dealType) !== matchKey
      ) {
        throw new TypeError("match key is invalid");
      }
      if (!seen.has(matchKey)) {
        output.push(matchKey);
        seen.add(matchKey);
      }
    }
    return output;
  }

  function validateCandidateRow(row) {
    const valid =
      isPlainRecord(row) &&
      isUuid(row.id) &&
      typeof row.listing_no === "string" &&
      row.listing_no === row.listing_no.trim() &&
      row.listing_no.length > 0 &&
      row.listing_no.length <= 500 &&
      (row.canonical_property_no == null || typeof row.canonical_property_no === "string") &&
      (row.legacy_property_no == null || typeof row.legacy_property_no === "string") &&
      isDealType(row.deal_type) &&
      isTimestamp(row.updated_at);
    if (!valid) throw new TypeError("candidate row is invalid");
    const canonical =
      row.canonical_property_no == null
        ? normalizePropertyNo(row.legacy_property_no)
        : normalizePropertyNo(row.canonical_property_no);
    const legacy =
      row.legacy_property_no == null ? null : normalizePropertyNo(row.legacy_property_no);
    if (canonical == null || (row.legacy_property_no != null && legacy == null)) {
      throw new TypeError("candidate row has an invalid property number");
    }
    return {
      id: row.id,
      listing_no: row.listing_no,
      canonical_property_no: canonical,
      legacy_property_no: legacy,
      deal_type: row.deal_type,
      updated_at: requireTimestamp(row.updated_at, "candidate updated_at"),
    };
  }

  async function findCanonicalCandidates(matchKeys) {
    const requested = parseRequestedMatchKeys(matchKeys);
    if (requested.length === 0) return [];
    const requestedSet = new Set(requested);
    const dealTypes = [...new Set(requested.map((key) => key.slice(0, key.indexOf(":"))))];
    const found = [];
    const ids = new Set();
    let cursor = null;
    while (true) {
      const rows = await query(
        `SELECT id, listing_no, canonical_property_no, legacy_property_no, deal_type, updated_at
           FROM properties
          WHERE deal_type = ANY($1::deal_type[])
            AND ($2::uuid IS NULL OR id > $2::uuid)
          ORDER BY id ASC LIMIT $3`,
        [dealTypes, cursor, BATCH_SIZE],
        "candidate lookup",
      );
      if (rows.length > BATCH_SIZE) throw new TypeError("candidate page exceeded its bound");
      let prior = cursor;
      for (const rawRow of rows) {
        const row = validateCandidateRow(rawRow);
        if (prior != null && row.id <= prior) {
          throw new TypeError("candidate rows are not deterministically ordered");
        }
        prior = row.id;
        if (ids.has(row.id)) throw new TypeError("candidate rows contain a duplicate UUID");
        ids.add(row.id);
        if (requestedSet.has(buildMatchKey(row.canonical_property_no, row.deal_type)))
          found.push(row);
      }
      if (rows.length < BATCH_SIZE) break;
      const nextCursor = rows.at(-1)?.id;
      if (!isUuid(nextCursor) || nextCursor === cursor) {
        throw new TypeError("candidate cursor did not advance");
      }
      cursor = nextCursor;
    }
    const rank = new Map(requested.map((key, index) => [key, index]));
    return found.sort((left, right) => {
      const leftRank = rank.get(buildMatchKey(left.canonical_property_no, left.deal_type));
      const rightRank = rank.get(buildMatchKey(right.canonical_property_no, right.deal_type));
      return leftRank - rightRank || left.id.localeCompare(right.id);
    });
  }

  function validateExternalIdentities(identities) {
    if (!Array.isArray(identities) || identities.length > 5_000) {
      throw new TypeError("external identities must be a bounded array");
    }
    const output = [];
    const seen = new Set();
    for (const identity of identities) {
      if (
        !isPlainRecord(identity) ||
        !isSource(identity.source) ||
        !isExternalId(identity.externalId) ||
        (identity.dealType != null && !isDealType(identity.dealType))
      ) {
        throw new TypeError("external identity is invalid");
      }
      const key = `${identity.source}\u0000${identity.externalId}`;
      if (!seen.has(key)) {
        output.push({ source: identity.source, externalId: identity.externalId });
        seen.add(key);
      }
    }
    return output;
  }

  function validateSourceLinkRow(row, requested) {
    const valid =
      isPlainRecord(row) &&
      isUuid(row.property_id) &&
      isSource(row.source) &&
      isExternalId(row.external_listing_id) &&
      isDealType(row.deal_type) &&
      typeof row.match_key === "string" &&
      row.match_key ===
        buildMatchKey(row.match_key.slice(row.match_key.indexOf(":") + 1), row.deal_type) &&
      row.link_reason === "exact_property_no_and_deal_type" &&
      LINK_STATUSES.has(row.status);
    if (!valid || !requested.has(`${row.source}\u0000${row.external_listing_id}`)) {
      throw new TypeError("source-link row is invalid");
    }
    return row;
  }

  async function loadSourceLinks(externalIdentities) {
    const identities = validateExternalIdentities(externalIdentities);
    if (identities.length === 0) return [];
    const requested = new Set(
      identities.map((identity) => `${identity.source}\u0000${identity.externalId}`),
    );
    const output = [];
    for (const batch of chunks(identities)) {
      const params = [];
      const tuples = batch.map((identity, index) => {
        params.push(identity.source, identity.externalId);
        return `($${index * 2 + 1}, $${index * 2 + 2})`;
      });
      const rows = await query(
        `SELECT property_id, source, external_listing_id, deal_type, match_key, link_reason, status
           FROM property_source_links
          WHERE (source, external_listing_id) IN (${tuples.join(", ")})
          ORDER BY source, external_listing_id, deal_type, property_id`,
        params,
        "source-link lookup",
      );
      output.push(...rows.map((row) => validateSourceLinkRow(row, requested)));
    }
    return output;
  }

  function validateProposedLinks(runId, links) {
    requireUuid(runId, "runId");
    if (!Array.isArray(links) || links.length > 5_000) {
      throw new TypeError("proposed links must be a bounded array");
    }
    const seen = new Set();
    return links.map((link) => {
      if (!isPlainRecord(link)) throw new TypeError("proposed link is invalid");
      const snapshot = Object.freeze({
        propertyId: link.propertyId,
        source: link.source,
        externalId: link.externalId,
        dealType: link.dealType,
        matchKey: link.matchKey,
        observedAt: link.observedAt,
      });
      const valid =
        isUuid(snapshot.propertyId) &&
        isSource(snapshot.source) &&
        isExternalId(snapshot.externalId) &&
        isDealType(snapshot.dealType) &&
        typeof snapshot.matchKey === "string" &&
        snapshot.matchKey ===
          buildMatchKey(
            snapshot.matchKey.slice(snapshot.matchKey.indexOf(":") + 1),
            snapshot.dealType,
          );
      if (!valid) throw new TypeError("proposed link is invalid");
      requireObservationTimestamp(snapshot.observedAt, "proposed link observedAt");
      const identity = `${snapshot.source}\u0000${snapshot.externalId}\u0000${snapshot.dealType}`;
      if (seen.has(identity)) throw new TypeError("duplicate proposed link identity");
      seen.add(identity);
      return snapshot;
    });
  }

  async function saveProposedLinks(runId, suppliedLinks) {
    const links = validateProposedLinks(runId, suppliedLinks);
    if (links.length === 0) return;
    const targetIds = [...new Set(links.map((link) => link.propertyId))];
    const propertiesById = new Map();
    for (const batch of chunks(targetIds)) {
      const rows = await query(
        `SELECT id, canonical_property_no, legacy_property_no, deal_type
           FROM properties
          WHERE id = ANY($1::uuid[])
          ORDER BY id`,
        [batch],
        "canonical property lookup",
      );
      for (const row of rows) {
        const canonicalPropertyNo =
          row?.canonical_property_no == null
            ? null
            : normalizePropertyNo(row.canonical_property_no);
        const legacyPropertyNo =
          row?.legacy_property_no == null ? null : normalizePropertyNo(row.legacy_property_no);
        const propertyNo = canonicalPropertyNo ?? legacyPropertyNo;
        if (
          !isPlainRecord(row) ||
          !isUuid(row.id) ||
          !targetIds.includes(row.id) ||
          (row.canonical_property_no != null &&
            (typeof row.canonical_property_no !== "string" || canonicalPropertyNo == null)) ||
          (row.legacy_property_no != null &&
            (typeof row.legacy_property_no !== "string" || legacyPropertyNo == null)) ||
          propertyNo == null ||
          !isDealType(row.deal_type) ||
          propertiesById.has(row.id)
        ) {
          throw new TypeError("canonical property row is invalid");
        }
        propertiesById.set(row.id, {
          propertyNo,
          dealType: row.deal_type,
        });
      }
    }
    for (const link of links) {
      const property = propertiesById.get(link.propertyId);
      if (
        !property ||
        property.dealType !== link.dealType ||
        buildMatchKey(property.propertyNo, property.dealType) !== link.matchKey
      ) {
        throw new Error("exact canonical property was not found for proposed link");
      }
    }
    for (const batch of chunks(links)) {
      const params = [];
      const values = batch.map((link, index) => {
        params.push(
          link.propertyId,
          link.source,
          link.externalId,
          link.dealType,
          link.matchKey,
          link.observedAt,
          runId,
        );
        const start = index * 7;
        return `($${start + 1}::uuid, $${start + 2}, $${start + 3}, $${start + 4}::deal_type, $${start + 5}, 'exact_property_no_and_deal_type', 'proposed', $${start + 6}::timestamptz, $${start + 6}::timestamptz, $${start + 7}::uuid)`;
      });
      await query(
        `INSERT INTO property_source_links
          (property_id, source, external_listing_id, deal_type, match_key, link_reason,
           status, first_seen_at, last_seen_at, last_seen_run_id)
         VALUES ${values.join(", ")}
         ON CONFLICT (source, external_listing_id, deal_type) DO NOTHING`,
        params,
        "save proposed links",
      );

      const selectParams = [];
      const tuples = batch.map((link, index) => {
        selectParams.push(link.source, link.externalId, link.dealType);
        const start = index * 3;
        return `($${start + 1}, $${start + 2}, $${start + 3}::deal_type)`;
      });
      const rows = await query(
        `SELECT property_id, source, external_listing_id, deal_type, match_key,
                link_reason, status
           FROM property_source_links
          WHERE (source, external_listing_id, deal_type) IN (${tuples.join(", ")})
          ORDER BY source, external_listing_id, deal_type, property_id`,
        selectParams,
        "verify proposed links",
      );
      if (rows.length !== batch.length) {
        throw new Error("persisted proposed links do not match requested identities");
      }
      const expectedByIdentity = new Map(
        batch.map((link) => [`${link.source}\u0000${link.externalId}\u0000${link.dealType}`, link]),
      );
      const seen = new Set();
      for (const row of rows) {
        const identity = `${row?.source}\u0000${row?.external_listing_id}\u0000${row?.deal_type}`;
        const expected = expectedByIdentity.get(identity);
        if (
          !isPlainRecord(row) ||
          !expected ||
          seen.has(identity) ||
          !isUuid(row.property_id) ||
          !LINK_STATUSES.has(row.status) ||
          row.property_id !== expected.propertyId ||
          row.match_key !== expected.matchKey ||
          row.link_reason !== "exact_property_no_and_deal_type"
        ) {
          throw new Error("existing source-link conflict does not match the exact proposal");
        }
        seen.add(identity);
      }
    }
  }

  function validateStringList(values, label, pattern, limit = 5_000) {
    if (!Array.isArray(values) || values.length > limit) {
      throw new TypeError(`${label} must be a bounded array`);
    }
    const output = [];
    const seen = new Set();
    for (const value of values) {
      if (typeof value !== "string" || !pattern.test(value)) {
        throw new TypeError(`${label} contains an invalid value`);
      }
      if (!seen.has(value)) {
        output.push(value);
        seen.add(value);
      }
    }
    return output;
  }

  async function loadEstateIdsBySlug(slugs) {
    const normalized = validateStringList(slugs, "estate slugs", /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    if (normalized.length === 0) return new Map();
    const output = new Map();
    for (const batch of chunks(normalized)) {
      const rows = await query(
        `SELECT id, slug FROM estates WHERE slug = ANY($1::text[]) ORDER BY slug, id`,
        [batch],
        "estate lookup",
      );
      for (const row of rows) {
        if (
          !isPlainRecord(row) ||
          !isUuid(row.id) ||
          !batch.includes(row.slug) ||
          output.has(row.slug)
        ) {
          throw new TypeError("estate row is invalid or duplicated");
        }
        output.set(row.slug, row.id);
      }
    }
    return output;
  }

  function validatePropertyIds(propertyIds) {
    const ids = validateStringList(propertyIds, "property IDs", UUID_PATTERN);
    return ids;
  }

  function validateFieldStateRow(row, requested) {
    const valid =
      isPlainRecord(row) &&
      isUuid(row.property_id) &&
      requested.has(row.property_id) &&
      typeof row.field_name === "string" &&
      row.field_name === row.field_name.trim() &&
      row.field_name.length > 0 &&
      row.field_name.length <= 160 &&
      typeof row.active_override === "boolean" &&
      (row.winning_observation_id == null || isUuid(row.winning_observation_id)) &&
      isTimestamp(row.updated_at);
    if (!valid) throw new TypeError("field-state row is invalid");
    serializeJson(row.last_published_value, "field-state last published value");
    serializeJson(row.override_value, "field-state override value");
    return {
      ...row,
      updated_at: requireTimestamp(row.updated_at, "field-state updated_at"),
    };
  }

  async function loadFieldStates(propertyIds) {
    const ids = validatePropertyIds(propertyIds);
    if (ids.length === 0) return [];
    const requested = new Set(ids);
    const output = [];
    for (const batch of chunks(ids)) {
      const rows = await query(
        `SELECT property_id, field_name, last_published_value, override_value,
                active_override, winning_observation_id, updated_at
           FROM property_sync_fields
          WHERE property_id = ANY($1::uuid[])
          ORDER BY property_id, field_name`,
        [batch],
        "field-state lookup",
      );
      output.push(...rows.map((row) => validateFieldStateRow(row, requested)));
    }
    return output;
  }

  function validateLifecycleRow(row, requested) {
    const valid =
      isPlainRecord(row) &&
      isUuid(row.property_id) &&
      requested.has(row.property_id) &&
      Number.isInteger(row.consecutive_absent_healthy_runs) &&
      row.consecutive_absent_healthy_runs >= 0 &&
      row.consecutive_absent_healthy_runs <= MAX_INT &&
      (row.last_evaluated_run_id == null || isUuid(row.last_evaluated_run_id)) &&
      (row.inactive_reason == null ||
        (typeof row.inactive_reason === "string" && row.inactive_reason.length <= 500)) &&
      (row.inactive_at == null || isTimestamp(row.inactive_at)) &&
      isTimestamp(row.updated_at);
    if (!valid) throw new TypeError("lifecycle row is invalid");
    return {
      ...row,
      inactive_at: requireTimestamp(row.inactive_at, "lifecycle inactive_at", {
        nullable: true,
      }),
      updated_at: requireTimestamp(row.updated_at, "lifecycle updated_at"),
    };
  }

  async function loadLifecycleStates(propertyIds) {
    const ids = validatePropertyIds(propertyIds);
    if (ids.length === 0) return [];
    const requested = new Set(ids);
    const output = [];
    for (const batch of chunks(ids)) {
      const rows = await query(
        `SELECT property_id, consecutive_absent_healthy_runs, last_evaluated_run_id,
                inactive_reason, inactive_at, updated_at
           FROM property_sync_state
          WHERE property_id = ANY($1::uuid[])
          ORDER BY property_id`,
        [batch],
        "lifecycle lookup",
      );
      output.push(...rows.map((row) => validateLifecycleRow(row, requested)));
    }
    return output;
  }

  function normalizeDatabaseInteger(value, label) {
    if (value == null) return null;
    if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new TypeError(`${label} is outside the safe integer boundary`);
  }

  function validateMediaRow(row, { expectedHash = null, requestedUrls = null } = {}) {
    let sizeBytes;
    try {
      sizeBytes = normalizeDatabaseInteger(row?.size_bytes, "media size_bytes");
    } catch {
      throw new TypeError("media row is invalid");
    }
    const valid =
      isPlainRecord(row) &&
      isUuid(row.id) &&
      typeof row.pathname === "string" &&
      row.pathname === row.pathname.trim() &&
      row.pathname.length > 0 &&
      row.pathname.length <= 1_024 &&
      (row.content_type == null ||
        (typeof row.content_type === "string" &&
          /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(row.content_type))) &&
      (row.content_hash == null || HASH_PATTERN.test(row.content_hash)) &&
      typeof row.owner_type === "string" &&
      row.owner_type === row.owner_type.trim() &&
      row.owner_type.length > 0 &&
      row.owner_type.length <= 160 &&
      (row.owner_id == null || isUuid(row.owner_id)) &&
      (row.created_by == null || isUuid(row.created_by)) &&
      isTimestamp(row.created_at);
    if (!valid) throw new TypeError("media row is invalid");
    requireUrl(row.url, "media row URL");
    if (
      (expectedHash != null && row.content_hash !== expectedHash) ||
      (requestedUrls != null && !requestedUrls.has(row.url))
    ) {
      throw new TypeError("media row does not match the requested identity");
    }
    return {
      id: row.id,
      url: row.url,
      pathname: row.pathname,
      contentType: row.content_type,
      sizeBytes,
      contentHash: row.content_hash,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      createdBy: row.created_by,
      createdAt: requireTimestamp(row.created_at, "media created_at"),
    };
  }

  const MEDIA_PROJECTION = `id, url, pathname, content_type, size_bytes, content_hash,
                            owner_type, owner_id, created_by, created_at`;

  async function findMediaByHash(hash, operation) {
    const signal = operationSignal(operation);
    throwIfAborted(signal);
    if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) {
      throw new TypeError("content hash must be lowercase SHA-256");
    }
    const rows = await query(
      `SELECT ${MEDIA_PROJECTION}
         FROM media_assets
        WHERE content_hash = $1
        ORDER BY id
        LIMIT 2`,
      [hash],
      "media hash lookup",
      operation,
    );
    if (rows.length > 1) throw new TypeError("media hash lookup returned duplicate rows");
    return rows.length === 0 ? null : validateMediaRow(rows[0], { expectedHash: hash });
  }

  async function findMediaByUrls(urls, operation) {
    const signal = operationSignal(operation);
    throwIfAborted(signal);
    if (!Array.isArray(urls) || urls.length > 5_000) {
      throw new TypeError("media URLs must be a bounded array");
    }
    const normalized = [];
    const seen = new Set();
    for (const url of urls) {
      requireUrl(url, "media URL");
      if (!seen.has(url)) {
        normalized.push(url);
        seen.add(url);
      }
    }
    if (normalized.length === 0) return [];
    const output = [];
    const returnedUrls = new Set();
    for (const batch of chunks(normalized)) {
      const requested = new Set(batch);
      const rows = await query(
        `SELECT ${MEDIA_PROJECTION}
           FROM media_assets
          WHERE url = ANY($1::text[])
          ORDER BY url, id`,
        [batch],
        "media URL lookup",
        operation,
      );
      for (const rawRow of rows) {
        const row = validateMediaRow(rawRow, { requestedUrls: requested });
        if (returnedUrls.has(row.url)) {
          throw new TypeError("duplicate media URL database evidence");
        }
        returnedUrls.add(row.url);
        output.push(row);
      }
    }
    return output;
  }

  function validateOwnedMediaInput(input) {
    const snapshot = exactInputSnapshot(input, OWNED_MEDIA_INPUT_KEYS);
    if (snapshot == null) {
      throw new TypeError("owned media input is invalid");
    }
    requireUrl(snapshot.url, "owned media URL");
    requireSafeText(snapshot.pathname, "owned media pathname", { max: 1_024 });
    if (
      snapshot.contentType !== null &&
      (typeof snapshot.contentType !== "string" ||
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(snapshot.contentType))
    ) {
      throw new TypeError("owned media contentType is invalid");
    }
    if (
      snapshot.sizeBytes !== null &&
      (!Number.isSafeInteger(snapshot.sizeBytes) || snapshot.sizeBytes < 0)
    ) {
      throw new TypeError("owned media sizeBytes is invalid");
    }
    if (typeof snapshot.contentHash !== "string" || !HASH_PATTERN.test(snapshot.contentHash)) {
      throw new TypeError("owned media content hash is invalid");
    }
    requireSafeText(snapshot.ownerType, "owned media ownerType", { max: 160 });
    if (snapshot.ownerId !== null) requireUuid(snapshot.ownerId, "owned media ownerId");
    if (snapshot.createdBy !== null) requireUuid(snapshot.createdBy, "owned media createdBy");
    return snapshot;
  }

  async function registerOwnedMedia(suppliedInput, operation) {
    const signal = operationSignal(operation);
    throwIfAborted(signal);
    const input = validateOwnedMediaInput(suppliedInput);
    const insertedRows = await query(
      `INSERT INTO media_assets
        (url, pathname, content_type, size_bytes, content_hash, owner_type, owner_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8::uuid)
       ON CONFLICT (content_hash) WHERE content_hash IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        input.url,
        input.pathname,
        input.contentType,
        input.sizeBytes,
        input.contentHash,
        input.ownerType,
        input.ownerId,
        input.createdBy,
      ],
      "register owned media",
      operation,
    );
    if (insertedRows.length > 1 || (insertedRows.length === 1 && !isUuid(insertedRows[0]?.id))) {
      throw new TypeError("registered media insert returned invalid evidence");
    }
    const rows = await query(
      `SELECT ${MEDIA_PROJECTION}
         FROM media_assets
        WHERE content_hash = $1
        ORDER BY id
        LIMIT 2`,
      [input.contentHash],
      "load registered media",
      operation,
    );
    if (rows.length !== 1) {
      throw new TypeError("registered media winner was missing or duplicated");
    }
    const asset = validateMediaRow(rows[0], { expectedHash: input.contentHash });
    if (asset.contentType !== input.contentType || asset.sizeBytes !== input.sizeBytes) {
      throw new TypeError("registered media winner metadata does not match the requested content");
    }
    const insertedId = insertedRows[0]?.id ?? null;
    if (
      insertedId != null &&
      (asset.id !== insertedId ||
        asset.url !== input.url ||
        asset.pathname !== input.pathname ||
        asset.ownerType !== input.ownerType ||
        asset.ownerId !== input.ownerId ||
        asset.createdBy !== input.createdBy)
    ) {
      throw new TypeError("inserted media ownership binding does not match the request");
    }
    return Object.freeze({
      outcome: insertedId == null ? "existing" : "inserted",
      asset,
    });
  }

  function optionalPositiveInteger(value, label) {
    if (value === null) return null;
    if (!Number.isInteger(value) || value <= 0 || value > MAX_INT) {
      throw new TypeError(`${label} is invalid`);
    }
    return value;
  }

  function validateMediaRecordInput(input) {
    const snapshot = exactInputSnapshot(input, MEDIA_RECORD_INPUT_KEYS);
    if (snapshot == null) {
      throw new TypeError("media record input is invalid");
    }
    requireUuid(snapshot.observationId, "media record observationId");
    if (snapshot.propertyId !== null) requireUuid(snapshot.propertyId, "media record propertyId");
    requireUrl(snapshot.sourceUrl, "media record source URL");
    if (
      snapshot.contentHash !== null &&
      (typeof snapshot.contentHash !== "string" || !HASH_PATTERN.test(snapshot.contentHash))
    ) {
      throw new TypeError("media record content hash is invalid");
    }
    if (snapshot.ownedMediaAssetId !== null) {
      requireUuid(snapshot.ownedMediaAssetId, "media record ownedMediaAssetId");
    }
    if (
      snapshot.detectedMime !== null &&
      (typeof snapshot.detectedMime !== "string" ||
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(snapshot.detectedMime))
    ) {
      throw new TypeError("media record detectedMime is invalid");
    }
    if (
      snapshot.sizeBytes !== null &&
      (!Number.isSafeInteger(snapshot.sizeBytes) || snapshot.sizeBytes < 0)
    ) {
      throw new TypeError("media record sizeBytes is invalid");
    }
    optionalPositiveInteger(snapshot.width, "media record width");
    optionalPositiveInteger(snapshot.height, "media record height");
    if (!MEDIA_ELIGIBILITIES.has(snapshot.eligibility)) {
      throw new TypeError("media record eligibility is invalid");
    }
    if (
      snapshot.eligibility === "eligible" &&
      (!snapshot.contentHash ||
        !snapshot.ownedMediaAssetId ||
        !snapshot.detectedMime ||
        snapshot.sizeBytes === null)
    ) {
      throw new TypeError("eligible media requires persisted hash, asset, MIME, and size evidence");
    }
    if (snapshot.rejectionReason !== null) {
      requireSafeText(snapshot.rejectionReason, "media rejectionReason", { max: 500 });
    }
    return snapshot;
  }

  function validatePersistedMediaRecord(row, expected) {
    let sizeBytes;
    try {
      sizeBytes = normalizeDatabaseInteger(row?.size_bytes, "media record size_bytes");
    } catch (error) {
      throw new TypeError("persisted media record is invalid", { cause: error });
    }
    const valid =
      isPlainRecord(row) &&
      isUuid(row.id) &&
      isUuid(row.observation_id) &&
      (row.property_id == null || isUuid(row.property_id)) &&
      typeof row.source_url === "string" &&
      (row.content_hash == null || HASH_PATTERN.test(row.content_hash)) &&
      (row.owned_media_asset_id == null || isUuid(row.owned_media_asset_id)) &&
      (row.detected_mime == null ||
        (typeof row.detected_mime === "string" &&
          /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(row.detected_mime))) &&
      (row.width == null ||
        (Number.isInteger(row.width) && row.width > 0 && row.width <= MAX_INT)) &&
      (row.height == null ||
        (Number.isInteger(row.height) && row.height > 0 && row.height <= MAX_INT)) &&
      MEDIA_ELIGIBILITIES.has(row.eligibility) &&
      (row.rejection_reason == null ||
        (typeof row.rejection_reason === "string" && row.rejection_reason.length <= 500));
    if (!valid) throw new TypeError("persisted media record is invalid");
    try {
      requireUrl(row.source_url, "persisted media source URL");
    } catch (error) {
      throw new TypeError("persisted media record is invalid", { cause: error });
    }
    const matches =
      row.observation_id === expected.observationId &&
      row.property_id === expected.propertyId &&
      row.source_url === expected.sourceUrl &&
      row.content_hash === expected.contentHash &&
      row.owned_media_asset_id === expected.ownedMediaAssetId &&
      row.detected_mime === expected.detectedMime &&
      sizeBytes === expected.sizeBytes &&
      row.width === expected.width &&
      row.height === expected.height &&
      row.eligibility === expected.eligibility &&
      row.rejection_reason === expected.rejectionReason;
    if (!matches) {
      throw new TypeError("persisted media record provenance does not match the request");
    }
  }

  async function saveMediaRecord(suppliedInput, operation) {
    const signal = operationSignal(operation);
    throwIfAborted(signal);
    const input = validateMediaRecordInput(suppliedInput);
    if (input.ownedMediaAssetId != null) {
      const assetRows = await query(
        `SELECT ${MEDIA_PROJECTION}
           FROM media_assets
          WHERE id = $1::uuid
          ORDER BY id
          LIMIT 2`,
        [input.ownedMediaAssetId],
        "media record asset lookup",
        operation,
      );
      if (assetRows.length !== 1) {
        throw new TypeError("media record owned asset was missing or duplicated");
      }
      const asset = validateMediaRow(assetRows[0]);
      if (
        asset.id !== input.ownedMediaAssetId ||
        asset.contentHash !== input.contentHash ||
        asset.contentType !== input.detectedMime ||
        asset.sizeBytes !== input.sizeBytes
      ) {
        throw new TypeError("media record owned asset binding does not match its provenance");
      }
    }
    const insertedRows = await query(
      `INSERT INTO listing_media_records
        (observation_id, property_id, source_url, content_hash, owned_media_asset_id,
         detected_mime, size_bytes, width, height, eligibility, rejection_reason)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (observation_id, source_url) DO NOTHING
       RETURNING id`,
      [
        input.observationId,
        input.propertyId,
        input.sourceUrl,
        input.contentHash,
        input.ownedMediaAssetId,
        input.detectedMime,
        input.sizeBytes,
        input.width,
        input.height,
        input.eligibility,
        input.rejectionReason,
      ],
      "save media record",
      operation,
    );
    if (insertedRows.length > 1 || (insertedRows.length === 1 && !isUuid(insertedRows[0]?.id))) {
      throw new TypeError("media record insert returned invalid evidence");
    }
    const rows = await query(
      `SELECT id, observation_id, property_id, source_url, content_hash,
              owned_media_asset_id, detected_mime, size_bytes, width, height,
              eligibility, rejection_reason
         FROM listing_media_records
        WHERE observation_id = $1::uuid AND source_url = $2
        ORDER BY id
        LIMIT 2`,
      [input.observationId, input.sourceUrl],
      "load persisted media record",
      operation,
    );
    if (rows.length !== 1) {
      throw new TypeError("persisted media record was missing or duplicated");
    }
    if (insertedRows.length === 1 && rows[0]?.id !== insertedRows[0].id) {
      throw new TypeError("media record insert did not match the authoritative persisted row");
    }
    validatePersistedMediaRecord(rows[0], input);
  }

  async function assertLockSession() {
    const rows = await query("SELECT 1 AS alive", [], "lock session assertion");
    if (rows.length !== 1 || rows[0]?.alive !== 1) {
      throw new Error("lock session assertion failed");
    }
  }

  function validateRunRow(row) {
    const valid =
      isPlainRecord(row) &&
      isUuid(row.id) &&
      isCanonicalDate(row.scheduled_for) &&
      isTimestamp(row.started_at) &&
      (row.finished_at == null || isTimestamp(row.finished_at)) &&
      RUN_MODES.has(row.mode) &&
      RUN_STATUSES.has(row.status) &&
      typeof row.parser_version === "string" &&
      row.parser_version.length > 0 &&
      isPlainRecord(row.source_status) &&
      isPlainRecord(row.counts) &&
      isPlainRecord(row.baselines) &&
      (row.failure_code == null || typeof row.failure_code === "string") &&
      (row.failure_summary == null || typeof row.failure_summary === "string") &&
      (row.baseline_approved_at == null || isTimestamp(row.baseline_approved_at)) &&
      (row.baseline_approved_by == null || typeof row.baseline_approved_by === "string") &&
      (row.baseline_approval_note == null || typeof row.baseline_approval_note === "string") &&
      isTimestamp(row.created_at);
    if (!valid) throw new TypeError("listing sync run row is invalid");
    serializeJson(row.source_status, "run source status");
    serializeJson(row.counts, "run counts");
    serializeJson(row.baselines, "run baselines");
    return {
      ...row,
      started_at: requireTimestamp(row.started_at, "run started_at"),
      finished_at: requireTimestamp(row.finished_at, "run finished_at", { nullable: true }),
      baseline_approved_at: requireTimestamp(row.baseline_approved_at, "run baseline_approved_at", {
        nullable: true,
      }),
      created_at: requireTimestamp(row.created_at, "run created_at"),
    };
  }

  async function getLatestRun() {
    const rows = await query(
      `SELECT id, scheduled_for::text AS scheduled_for, started_at, finished_at,
              mode, status, parser_version,
              source_status, counts, baselines, failure_code, failure_summary,
              baseline_approved_at, baseline_approved_by, baseline_approval_note, created_at
         FROM listing_sync_runs
        ORDER BY started_at DESC, id DESC LIMIT 1`,
      [],
      "latest run lookup",
    );
    if (rows.length > 1) throw new TypeError("latest run query returned too many rows");
    return rows.length === 0 ? null : validateRunRow(rows[0]);
  }

  return Object.freeze({
    approveShadowRun,
    assertLockSession,
    beginRun,
    findCanonicalCandidates,
    findMediaByHash,
    findMediaByUrls,
    finishRun,
    getApprovedHealthyShadowStreak,
    getHealthyCountHistory,
    getLatestRun,
    loadEstateIdsBySlug,
    loadFieldStates,
    loadLifecycleStates,
    loadSourceLinks,
    recordRunEvaluation,
    registerOwnedMedia,
    saveMediaRecord,
    saveObservations,
    saveProposedLinks,
  });
}
