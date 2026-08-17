import {
  SOURCE_28HSE,
  SOURCE_OLD_SITE,
  buildMatchKey,
  normalizePropertyNo,
  stableObservationHash,
} from "./source-contract.mjs";
import { normalizeCanonicalFieldValue } from "./reconcile.mjs";

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
const ROW_VERSION_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/;

function wrappedCredentialPattern(atomPattern) {
  return String.raw`(?:${atomPattern}|\(\s*${atomPattern}\s*\)|\[\s*${atomPattern}\s*\]|\{\s*${atomPattern}\s*\})`;
}

const CREDENTIAL_LABEL_PATTERN_SOURCE = String.raw`(?:x[-_ ]?)?api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|passwd`;
const CREDENTIAL_LABEL_VALUE_SEPARATOR_PATTERN_SOURCE = String.raw`(?:\s*[:=]\s*|\s+(?:(?:is|was)(?:\s*[:=]\s*|\s+))?)`;
const CREDENTIAL_CHAIN_LABEL_VALUE_SEPARATOR_PATTERN_SOURCE = String.raw`(?:\s*[:=]\s*|\s+(?:is|was)(?:\s*[:=]\s*|\s+))`;
const CREDENTIAL_CHAIN_BOUNDARY_PATTERN_SOURCE = String.raw`:\s*(?:${CREDENTIAL_LABEL_PATTERN_SOURCE})${CREDENTIAL_CHAIN_LABEL_VALUE_SEPARATOR_PATTERN_SOURCE}`;
const CREDENTIAL_UNQUOTED_ATOM_PATTERN_SOURCE = String.raw`(?:(?!${CREDENTIAL_CHAIN_BOUNDARY_PATTERN_SOURCE})[^\s,;()[\]{}])+`;
const CREDENTIAL_ATOM_PATTERN_SOURCE = String.raw`(?:"[^"\r\n]*"|'[^'\r\n]*'|${CREDENTIAL_UNQUOTED_ATOM_PATTERN_SOURCE})`;
const CREDENTIAL_VALUE_PATTERN_SOURCE = wrappedCredentialPattern(CREDENTIAL_ATOM_PATTERN_SOURCE);
const CREDENTIAL_SCHEME_SEPARATOR_PATTERN_SOURCE = String.raw`(?:\s*:\s*|\s+)`;
const BASIC_CREDENTIAL_TOKEN_PATTERN_SOURCE = String.raw`[A-Za-z0-9+/]+={0,2}`;
const BASIC_CREDENTIAL_ATOM_PATTERN_SOURCE = String.raw`(?:${BASIC_CREDENTIAL_TOKEN_PATTERN_SOURCE}|"${BASIC_CREDENTIAL_TOKEN_PATTERN_SOURCE}"|'${BASIC_CREDENTIAL_TOKEN_PATTERN_SOURCE}')`;
const BASIC_CREDENTIAL_VALUE_PATTERN_SOURCE = wrappedCredentialPattern(
  BASIC_CREDENTIAL_ATOM_PATTERN_SOURCE,
);
const CREDENTIAL_TERMINAL_PATTERN_SOURCE = String.raw`(?=$|\s|[,;:.!?)]|\]|\})`;
const CREDENTIAL_LABEL_START_PATTERN_SOURCE = String.raw`(?:^|(?<=[\s(\[{:;,]))`;
const AUTHORIZATION_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b(authorization)\s*[:=]\s*(?:(?:bearer|basic)${CREDENTIAL_SCHEME_SEPARATOR_PATTERN_SOURCE})?${CREDENTIAL_VALUE_PATTERN_SOURCE}`,
  "gi",
);
const STANDALONE_COLON_SCHEME_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b(bearer|basic)\s*:\s*${CREDENTIAL_VALUE_PATTERN_SOURCE}`,
  "gi",
);
const STANDALONE_BEARER_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b(bearer)\s+${CREDENTIAL_VALUE_PATTERN_SOURCE}`,
  "gi",
);
const STANDALONE_BASIC_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b(basic)\s+(${BASIC_CREDENTIAL_VALUE_PATTERN_SOURCE})${CREDENTIAL_TERMINAL_PATTERN_SOURCE}`,
  "gi",
);
const NAMED_CREDENTIAL_PATTERN = new RegExp(
  String.raw`${CREDENTIAL_LABEL_START_PATTERN_SOURCE}(${CREDENTIAL_LABEL_PATTERN_SOURCE})${CREDENTIAL_LABEL_VALUE_SEPARATOR_PATTERN_SOURCE}${CREDENTIAL_VALUE_PATTERN_SOURCE}`,
  "giu",
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
const MEDIA_CANDIDATE_REQUIRED_KEYS = Object.freeze(["url", "category", "isPrimary"]);
const MEDIA_CANDIDATE_OPTIONAL_KEYS = Object.freeze([
  "rejected",
  "eligible",
  "contextRejected",
  "rejectionReason",
  "rejectionReasons",
  "contextRejectionMarkers",
]);
const MEDIA_CANDIDATE_KEYS = new Set([
  ...MEDIA_CANDIDATE_REQUIRED_KEYS,
  ...MEDIA_CANDIDATE_OPTIONAL_KEYS,
]);
const MEDIA_CANDIDATE_CATEGORIES = new Set([
  "listing_photo",
  "map",
  "floorplan",
  "qr",
  "vr",
  "branded",
  "unknown",
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
const PUBLICATION_BATCH_REQUIRED_KEYS = new Set(["runId", "mode", "publishEnabled", "proposals"]);
const PUBLICATION_BATCH_KEYS = new Set([...PUBLICATION_BATCH_REQUIRED_KEYS, "signal"]);
const PUBLICATION_PROPOSAL_KEYS = new Set([
  "kind",
  "propertyId",
  "expectedUpdatedAt",
  "canonical",
  "links",
  "fields",
  "lifecycle",
  "events",
]);
const CANONICAL_WRITE_KEYS = new Set([
  "listing_no",
  "canonical_property_no",
  "title_zh",
  "title_en",
  "deal_type",
  "estate_id",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "description",
  "images",
  "status",
]);
const SOURCE_LINK_WRITE_KEYS = new Set([
  "source",
  "externalId",
  "dealType",
  "matchKey",
  "observedAt",
]);
const RECONCILED_FIELD_WRITE_KEYS = new Set([
  "fieldName",
  "lastPublishedValue",
  "overrideValue",
  "activeOverride",
  "winningObservationId",
]);
const LIFECYCLE_WRITE_KEYS = new Set([
  "consecutiveAbsentHealthyRuns",
  "inactiveReason",
  "inactiveAt",
]);
const LISTING_CHANGE_EVENT_KEYS = new Set([
  "changeType",
  "fieldName",
  "oldValue",
  "newValue",
  "winningObservationId",
  "reason",
]);
const RECONCILED_FIELD_NAMES = Object.freeze([
  "title_zh",
  "title_en",
  "estate_id",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "description",
  "images",
  "status",
]);
const RECONCILED_FIELD_SET = new Set(RECONCILED_FIELD_NAMES);
const PROPERTY_STATUSES = new Set(["draft", "active", "sold", "rented", "offline", "inactive"]);
const CHANGE_TYPES = new Set(["new", "changed", "inactive", "reactivated", "link_change"]);
const PUBLICATION_RUN_ROW_KEYS = new Set([
  "id",
  "scheduled_for",
  "started_at",
  "mode",
  "status",
  "source_status",
  "hong_kong_date",
]);
const PUBLICATION_BASELINE_ROW_KEYS = new Set(["source_status"]);
const PUBLICATION_STREAK_ROW_KEYS = new Set([
  "id",
  "scheduled_for",
  "started_at",
  "status",
  "source_status",
  "baseline_approved_at",
  "date_rank",
]);
const PUBLICATION_OBSERVATION_ROW_KEYS = new Set([
  "id",
  "run_id",
  "source",
  "external_listing_id",
  "deal_type",
  "property_no_normalized",
  "validation_state",
  "fetched_at",
  "payload",
  "media_candidates",
  "content_hash",
]);
const PUBLICATION_MEDIA_ROW_KEYS = new Set([
  "id",
  "observation_id",
  "property_id",
  "source_url",
  "eligibility",
  "owned_media_asset_id",
  "record_content_hash",
  "owned_url",
  "asset_content_hash",
]);
const LOCKED_PROPERTY_ROW_KEYS = new Set([
  "id",
  "updated_at_token",
  "updated_at_matches_expected",
  ...CANONICAL_WRITE_KEYS,
]);
const LOCKED_FIELD_STATE_ROW_KEYS = new Set([
  "property_id",
  "field_name",
  "last_published_value",
  "override_value",
  "active_override",
  "winning_observation_id",
]);
const LOCKED_LIFECYCLE_ROW_KEYS = new Set([
  "property_id",
  "consecutive_absent_healthy_runs",
  "last_evaluated_run_id",
  "inactive_reason",
  "inactive_at_token",
]);
const QUERY_RESULT_REQUIRED_KEYS = new Set(["rows", "rowCount"]);
const QUERY_RESULT_ALLOWED_KEYS = new Set([
  "rows",
  "rowCount",
  "command",
  "fields",
  "oid",
  "_parsers",
  "_types",
  "RowCtor",
  "rowAsArray",
  "parseRow",
  "_prebuiltEmptyResultObject",
]);

export class PublicationError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PublicationError";
    this.code = options.code ?? "MLS_PUBLICATION_FAILED";
    this.cleanupErrors = Object.freeze([...(options.cleanupErrors ?? [])]);
  }
}

export class PublicationGateError extends PublicationError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "MLS_PUBLICATION_GATE" });
    this.name = "PublicationGateError";
  }
}

export class PublicationConflictError extends PublicationError {
  constructor(message, { propertyId = null, cause, cleanupErrors } = {}) {
    super(message, {
      cause,
      cleanupErrors,
      code: "MLS_PUBLICATION_CONFLICT",
    });
    this.name = "PublicationConflictError";
    this.propertyId = propertyId;
  }
}

export class PublicationOutcomeUnknownError extends PublicationError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "MLS_PUBLICATION_OUTCOME_UNKNOWN" });
    this.name = "PublicationOutcomeUnknownError";
  }
}

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

function databaseErrorCode(error) {
  if (error == null || (typeof error !== "object" && typeof error !== "function")) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
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

function requireRowVersion(value, label) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a lossless PostgreSQL timestamp token`);
  }
  const matched = ROW_VERSION_PATTERN.exec(value);
  if (!matched) {
    throw new TypeError(`${label} must be a lossless PostgreSQL timestamp token`);
  }
  const [, year, month, day, hourText, minuteText, secondText] = matched;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (!isCanonicalDate(`${year}-${month}-${day}`) || hour > 23 || minute > 59 || second > 59) {
    throw new TypeError(`${label} must be a lossless PostgreSQL timestamp token`);
  }
  return value;
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

function databaseJsonSnapshot(value, label) {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value);
    } catch (error) {
      throw new TypeError(`${label} is invalid JSON`, { cause: error });
    }
  }
  const snapshot = snapshotDataGraph(decoded, label);
  serializeJson(snapshot, label);
  return snapshot;
}

function databaseDecodedJsonSnapshot(value, label) {
  const snapshot = snapshotDataGraph(value, label);
  serializeJson(snapshot, label);
  return snapshot;
}

function jsonEqual(left, right) {
  return JSON.stringify(stableJsonValue(left)) === JSON.stringify(stableJsonValue(right));
}

function requireDataPropertyGraph(value, seen = new Set()) {
  if (value == null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError("SourceObservation graph must contain only data properties");
    }
    requireDataPropertyGraph(descriptor.value, seen);
  }
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

function requireExactArrayDataProperties(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = new Set(["length"]);
  for (let index = 0; index < value.length; index += 1) expected.add(String(index));
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== expected.size ||
    ownKeys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    throw new TypeError(`${label} arrays must contain only dense index data properties`);
  }
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label} arrays must contain only data properties`);
    }
    if (key !== "length" && !descriptor.enumerable) {
      throw new TypeError(`${label} array indexes must be enumerable data properties`);
    }
  }
  return descriptors;
}

function snapshotDataGraph(value, label, seen = new Map(), depth = 0) {
  if (depth > 50) throw new TypeError(`${label} nesting is too deep`);
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value !== "object") throw new TypeError(`${label} contains an unsupported value`);
  if (seen.has(value)) throw new TypeError(`${label} contains a cycle`);
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new TypeError(`${label} must contain only plain records and arrays`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label} contains an accessor at ${key}`);
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} contains an unexpected symbol key`);
  }
  const output = Array.isArray(value) ? [] : {};
  seen.set(value, output);
  if (Array.isArray(value)) {
    requireExactArrayDataProperties(value, label);
    for (let index = 0; index < value.length; index += 1) {
      output.push(snapshotDataGraph(descriptors[index].value, label, seen, depth + 1));
    }
  } else {
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) throw new TypeError(`${label} contains an unexpected hidden key`);
      output[key] = snapshotDataGraph(descriptor.value, label, seen, depth + 1);
    }
  }
  seen.delete(value);
  return Object.freeze(output);
}

function snapshotPublicationBatch(suppliedInput) {
  if (!isPlainRecord(suppliedInput)) {
    throw new TypeError("publication batch must be a plain record");
  }
  const descriptors = Object.getOwnPropertyDescriptors(suppliedInput);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !PUBLICATION_BATCH_KEYS.has(key))) {
    throw new TypeError("publication batch contains an unexpected key");
  }
  for (const key of PUBLICATION_BATCH_REQUIRED_KEYS) {
    if (!Object.hasOwn(descriptors, key))
      throw new TypeError(`publication batch is missing ${key}`);
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      throw new TypeError("publication batch must contain only enumerable data properties");
    }
  }
  const signal = descriptors.signal?.value ?? null;
  if (signal != null && !(signal instanceof AbortSignal)) {
    throw new TypeError("publication batch signal must be an AbortSignal");
  }
  const graph = Object.fromEntries(
    [...PUBLICATION_BATCH_REQUIRED_KEYS].map((key) => [key, descriptors[key].value]),
  );
  const snapshot = snapshotDataGraph(graph, "publication batch");
  return Object.freeze(signal == null ? snapshot : { ...snapshot, signal });
}

function requireExactRecord(value, keys, label) {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a plain record`);
  const ownKeys = Reflect.ownKeys(value);
  const unexpected = ownKeys.find((key) => typeof key !== "string" || !keys.has(key));
  if (unexpected !== undefined) throw new TypeError(`${label} contains an unexpected key`);
  const missing = [...keys].find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) throw new TypeError(`${label} is missing ${missing}`);
  return value;
}

function requireProposalRecord(value, label) {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a plain record`);
  const ownKeys = Reflect.ownKeys(value);
  const unexpected = ownKeys.find(
    (key) => typeof key !== "string" || !PUBLICATION_PROPOSAL_KEYS.has(key),
  );
  if (unexpected !== undefined) throw new TypeError(`${label} contains an unexpected key`);
  for (const key of ["kind", "canonical", "links", "fields", "lifecycle", "events"]) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing ${key}`);
  }
  if (value.kind === "update") {
    if (!Object.hasOwn(value, "propertyId") || !Object.hasOwn(value, "expectedUpdatedAt")) {
      throw new TypeError(`${label} update is missing expected row version evidence`);
    }
  } else if (value.kind === "new") {
    if (Object.hasOwn(value, "propertyId") || Object.hasOwn(value, "expectedUpdatedAt")) {
      throw new TypeError(`${label} new rows must not supply existing row identity`);
    }
  } else {
    throw new TypeError(`${label}.kind is invalid`);
  }
  return value;
}

function requireNullableText(value, label, max = 2_000) {
  if (value === null) return null;
  if (value === undefined) throw new TypeError(`${label} must be text or null`);
  return requireSafeText(value, label, { max });
}

function requireNullableNumber(value, label, { integer = false, minimum = 0 } = {}) {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new TypeError(`${label} must be a number or null`);
  }
  return value;
}

function validateCanonicalWrite(value, label) {
  requireExactRecord(value, CANONICAL_WRITE_KEYS, label);
  requireSafeText(value.listing_no, `${label}.listing_no`, { max: 160 });
  requireSafeText(value.canonical_property_no, `${label}.canonical_property_no`, { max: 160 });
  if (normalizePropertyNo(value.canonical_property_no) !== value.canonical_property_no) {
    throw new TypeError(`${label}.canonical_property_no must be normalized`);
  }
  requireSafeText(value.title_zh, `${label}.title_zh`, { max: 1_000 });
  requireNullableText(value.title_en, `${label}.title_en`, 1_000);
  if (!isDealType(value.deal_type)) throw new TypeError(`${label}.deal_type is invalid`);
  if (value.estate_id === undefined) {
    throw new TypeError(`${label}.estate_id must be a UUID or null`);
  }
  if (value.estate_id !== null) requireUuid(value.estate_id, `${label}.estate_id`);
  requireSafeText(value.district_slug, `${label}.district_slug`, { max: 160 });
  requireNullableText(value.address, `${label}.address`, 2_000);
  requireNullableNumber(value.price, `${label}.price`);
  requireNullableNumber(value.rent, `${label}.rent`);
  requireNullableNumber(value.saleable_area, `${label}.saleable_area`, { integer: true });
  requireNullableNumber(value.gross_area, `${label}.gross_area`, { integer: true });
  requireNullableNumber(value.bedrooms, `${label}.bedrooms`, { integer: true });
  requireNullableNumber(value.bathrooms, `${label}.bathrooms`, { integer: true });
  requireNullableText(value.floor, `${label}.floor`, 200);
  requireNullableText(value.orientation, `${label}.orientation`, 200);
  requireStringArray(value.features, `${label}.features`, { maxItems: 200, maxLength: 500 });
  requireNullableText(value.description, `${label}.description`, 100_000);
  if (!Array.isArray(value.images) || value.images.length > 200) {
    throw new TypeError(`${label}.images must be a bounded array`);
  }
  for (const image of value.images) requireUrl(image, `${label}.images URL`);
  if (new Set(value.images).size !== value.images.length) {
    throw new TypeError(`${label}.images contains duplicates`);
  }
  if (!PROPERTY_STATUSES.has(value.status)) throw new TypeError(`${label}.status is invalid`);
  if (value.deal_type === "sale" && !(value.price > 0)) {
    throw new TypeError(`${label}.price is required for a sale`);
  }
  if (value.deal_type === "rent" && !(value.rent > 0)) {
    throw new TypeError(`${label}.rent is required for a rental`);
  }
  serializeJson(value.features, `${label}.features`);
  serializeJson(value.images, `${label}.images`);
  return value;
}

function validateSourceLinkWrite(value, canonical, label) {
  requireExactRecord(value, SOURCE_LINK_WRITE_KEYS, label);
  if (!isSource(value.source)) throw new TypeError(`${label}.source is invalid`);
  if (!isExternalId(value.externalId)) throw new TypeError(`${label}.externalId is invalid`);
  if (value.dealType !== canonical.deal_type) throw new TypeError(`${label}.dealType is invalid`);
  const expectedMatchKey = buildMatchKey(canonical.canonical_property_no, canonical.deal_type);
  if (value.matchKey !== expectedMatchKey) throw new TypeError(`${label}.matchKey is invalid`);
  requireObservationTimestamp(value.observedAt, `${label}.observedAt`);
  return value;
}

function validateReconciledFieldWrite(value, canonical, label) {
  requireExactRecord(value, RECONCILED_FIELD_WRITE_KEYS, label);
  if (!RECONCILED_FIELD_SET.has(value.fieldName)) {
    throw new TypeError(`${label}.fieldName is invalid`);
  }
  serializeJson(value.lastPublishedValue, `${label}.lastPublishedValue`);
  serializeJson(value.overrideValue, `${label}.overrideValue`);
  if (typeof value.activeOverride !== "boolean") {
    throw new TypeError(`${label}.activeOverride must be boolean`);
  }
  if (value.winningObservationId === undefined) {
    throw new TypeError(`${label}.winningObservationId must be a UUID or null`);
  }
  if (value.winningObservationId !== null) {
    requireUuid(value.winningObservationId, `${label}.winningObservationId`);
  }
  if (value.activeOverride && value.winningObservationId != null) {
    throw new TypeError(`${label} staff override cannot claim a winning observation`);
  }
  const publishedValue = value.activeOverride ? value.overrideValue : value.lastPublishedValue;
  if (!jsonEqual(publishedValue, canonical[value.fieldName])) {
    throw new TypeError(`${label} does not match the canonical field`);
  }
  return value;
}

function validateLifecycleWrite(value, canonical, label) {
  requireExactRecord(value, LIFECYCLE_WRITE_KEYS, label);
  if (
    !Number.isInteger(value.consecutiveAbsentHealthyRuns) ||
    value.consecutiveAbsentHealthyRuns < 0 ||
    value.consecutiveAbsentHealthyRuns > MAX_INT
  ) {
    throw new TypeError(`${label}.consecutiveAbsentHealthyRuns is invalid`);
  }
  requireNullableText(value.inactiveReason, `${label}.inactiveReason`, 500);
  if (value.inactiveAt === undefined) {
    throw new TypeError(`${label}.inactiveAt must be a timestamp or null`);
  }
  if (value.inactiveAt !== null) {
    requireRowVersion(value.inactiveAt, `${label}.inactiveAt`);
  }
  if ((value.inactiveReason == null) !== (value.inactiveAt == null)) {
    throw new TypeError(`${label} inactivity reason and timestamp must be paired`);
  }
  if (canonical.status === "inactive") {
    if (
      value.consecutiveAbsentHealthyRuns !== 2 ||
      value.inactiveReason == null ||
      value.inactiveAt == null
    ) {
      throw new TypeError(`${label} inactive status requires the two-healthy-run lifecycle state`);
    }
  } else if (value.inactiveReason != null || value.inactiveAt != null) {
    throw new TypeError(`${label} active lifecycle cannot retain inactive reason or time`);
  } else if (
    ["draft", "sold", "rented", "offline"].includes(canonical.status) &&
    value.consecutiveAbsentHealthyRuns !== 0
  ) {
    throw new TypeError(`${label} terminal status requires a zero lifecycle counter`);
  } else if (canonical.status === "active" && value.consecutiveAbsentHealthyRuns > 1) {
    throw new TypeError(`${label} active status cannot exceed one healthy absence`);
  }
  return value;
}

function validateListingChangeEvent(value, canonical, label) {
  requireExactRecord(value, LISTING_CHANGE_EVENT_KEYS, label);
  if (!CHANGE_TYPES.has(value.changeType)) throw new TypeError(`${label}.changeType is invalid`);
  if (value.fieldName === undefined) {
    throw new TypeError(`${label}.fieldName must be text or null`);
  }
  if (value.fieldName !== null) {
    requireSafeText(value.fieldName, `${label}.fieldName`, { max: 160 });
  }
  serializeJson(value.oldValue, `${label}.oldValue`);
  serializeJson(value.newValue, `${label}.newValue`);
  if (jsonEqual(value.oldValue, value.newValue)) {
    throw new TypeError(`${label} does not describe a real change`);
  }
  if (value.changeType === "changed") {
    if (!RECONCILED_FIELD_SET.has(value.fieldName)) {
      throw new TypeError(`${label}.fieldName is invalid for a changed event`);
    }
    if (!jsonEqual(value.newValue, canonical[value.fieldName])) {
      throw new TypeError(`${label}.newValue does not match the canonical field`);
    }
    if (
      value.fieldName === "status" &&
      (value.oldValue === "inactive" || value.newValue === "inactive")
    ) {
      throw new TypeError(`${label} status transition must use inactive or reactivated`);
    }
  }
  if (["inactive", "reactivated"].includes(value.changeType) && value.fieldName !== "status") {
    throw new TypeError(`${label}.fieldName must be status`);
  }
  if (
    ["inactive", "reactivated"].includes(value.changeType) &&
    !jsonEqual(value.newValue, canonical.status)
  ) {
    throw new TypeError(`${label}.newValue must equal the canonical status`);
  }
  if (value.changeType === "inactive" && canonical.status !== "inactive") {
    throw new TypeError(`${label} inactive event requires canonical status inactive`);
  }
  if (value.changeType === "reactivated" && value.oldValue !== "inactive") {
    throw new TypeError(`${label} reactivated event must start from inactive`);
  }
  if (
    value.changeType === "new" &&
    (value.fieldName !== null || value.oldValue !== null || !jsonEqual(value.newValue, canonical))
  ) {
    throw new TypeError(`${label} new event must contain the exact canonical row`);
  }
  if (value.changeType === "link_change" && value.fieldName !== null) {
    throw new TypeError(`${label} link change fieldName must be null`);
  }
  if (value.winningObservationId === undefined) {
    throw new TypeError(`${label}.winningObservationId must be a UUID or null`);
  }
  if (value.winningObservationId !== null) {
    requireUuid(value.winningObservationId, `${label}.winningObservationId`);
  }
  requireSafeText(value.reason, `${label}.reason`, { max: 500 });
  return value;
}

function validatePublicationBatch(suppliedInput) {
  const input = snapshotPublicationBatch(suppliedInput);
  requireUuid(input.runId, "publication batch runId");
  if (!RUN_MODES.has(input.mode)) throw new TypeError("publication batch mode is invalid");
  if (typeof input.publishEnabled !== "boolean") {
    throw new TypeError("publication batch publishEnabled must be boolean");
  }
  if (!Array.isArray(input.proposals) || input.proposals.length > 1_000) {
    throw new TypeError("publication batch proposals must be a bounded array");
  }
  const propertyIds = new Set();
  const listingNumbers = new Set();
  const canonicalIdentities = new Set();
  const linkIdentities = new Set();
  const winningObservationOwners = new Map();
  for (let index = 0; index < input.proposals.length; index += 1) {
    const proposal = requireProposalRecord(input.proposals[index], `publication proposal ${index}`);
    const canonical = validateCanonicalWrite(
      proposal.canonical,
      `publication proposal ${index}.canonical`,
    );
    if (listingNumbers.has(canonical.listing_no)) {
      throw new TypeError("publication batch contains a duplicate listing number");
    }
    listingNumbers.add(canonical.listing_no);
    const canonicalIdentity = `${canonical.deal_type}\u0000${canonical.canonical_property_no}`;
    if (canonicalIdentities.has(canonicalIdentity)) {
      throw new TypeError("publication batch contains a duplicate canonical identity");
    }
    canonicalIdentities.add(canonicalIdentity);
    if (proposal.kind === "update") {
      requireUuid(proposal.propertyId, `publication proposal ${index}.propertyId`);
      requireRowVersion(
        proposal.expectedUpdatedAt,
        `publication proposal ${index}.expectedUpdatedAt`,
      );
      if (propertyIds.has(proposal.propertyId)) {
        throw new TypeError("publication batch contains a duplicate property UUID");
      }
      propertyIds.add(proposal.propertyId);
    }
    if (!Array.isArray(proposal.links) || proposal.links.length > 20) {
      throw new TypeError(`publication proposal ${index}.links must be a bounded array`);
    }
    for (let linkIndex = 0; linkIndex < proposal.links.length; linkIndex += 1) {
      const link = validateSourceLinkWrite(
        proposal.links[linkIndex],
        canonical,
        `publication proposal ${index}.links[${linkIndex}]`,
      );
      const identity = observationIdentity(link);
      if (linkIdentities.has(identity)) {
        throw new TypeError("publication batch contains a duplicate source link");
      }
      linkIdentities.add(identity);
    }
    if (
      !Array.isArray(proposal.fields) ||
      proposal.fields.length !== RECONCILED_FIELD_NAMES.length
    ) {
      throw new TypeError(`publication proposal ${index} must contain each field exactly once`);
    }
    const fieldNames = new Set();
    for (const field of proposal.fields) {
      if (!isPlainRecord(field) || typeof field.fieldName !== "string") {
        throw new TypeError(`publication proposal ${index} contains an invalid field`);
      }
      if (fieldNames.has(field.fieldName)) {
        throw new TypeError(`publication proposal ${index} contains a duplicate field`);
      }
      fieldNames.add(field.fieldName);
    }
    fieldNames.clear();
    for (let fieldIndex = 0; fieldIndex < proposal.fields.length; fieldIndex += 1) {
      const field = validateReconciledFieldWrite(
        proposal.fields[fieldIndex],
        canonical,
        `publication proposal ${index}.fields[${fieldIndex}]`,
      );
      if (fieldNames.has(field.fieldName)) {
        throw new TypeError(`publication proposal ${index} contains a duplicate field`);
      }
      fieldNames.add(field.fieldName);
    }
    if (RECONCILED_FIELD_NAMES.some((fieldName) => !fieldNames.has(fieldName))) {
      throw new TypeError(`publication proposal ${index} must contain each field exactly once`);
    }
    const imageField = proposal.fields.find((field) => field.fieldName === "images");
    if (proposal.kind === "new" && proposal.links.length === 0) {
      throw new TypeError("new publication requires a current-run source link");
    }
    if (proposal.kind === "new" && canonical.images.length === 0) {
      throw new TypeError("new publication requires an owned primary image");
    }
    if (proposal.kind === "new" && imageField.winningObservationId == null) {
      throw new TypeError("new publication images require a current-run winning observation");
    }
    if (
      proposal.kind === "new" &&
      proposal.fields.some(
        (field) =>
          field.fieldName !== "images" &&
          field.activeOverride !== true &&
          field.winningObservationId == null &&
          field.lastPublishedValue != null &&
          (!Array.isArray(field.lastPublishedValue) || field.lastPublishedValue.length > 0),
      )
    ) {
      throw new TypeError("new automated values require current-run winning observations");
    }
    if (proposal.fields.some((field) => field.activeOverride) && proposal.links.length === 0) {
      throw new TypeError("staff override publication requires a current-run source link");
    }
    if (proposal.kind === "new" && proposal.fields.some((field) => field.activeOverride)) {
      throw new TypeError("new publication cannot contain an active override");
    }
    for (const winnerId of new Set(
      proposal.fields
        .map((field) => field.winningObservationId)
        .filter((winnerId) => winnerId != null),
    )) {
      const owner = winningObservationOwners.get(winnerId);
      if (owner !== undefined && owner !== index) {
        throw new TypeError("one winning observation cannot publish multiple properties");
      }
      winningObservationOwners.set(winnerId, index);
    }
    validateLifecycleWrite(
      proposal.lifecycle,
      canonical,
      `publication proposal ${index}.lifecycle`,
    );
    if (!Array.isArray(proposal.events) || proposal.events.length > 500) {
      throw new TypeError(`publication proposal ${index}.events must be a bounded array`);
    }
    const eventKeys = new Set();
    for (let eventIndex = 0; eventIndex < proposal.events.length; eventIndex += 1) {
      const event = validateListingChangeEvent(
        proposal.events[eventIndex],
        canonical,
        `publication proposal ${index}.events[${eventIndex}]`,
      );
      const key = serializeJson(stableJsonValue(event), "publication event identity");
      if (eventKeys.has(key))
        throw new TypeError("publication proposal contains a duplicate event");
      eventKeys.add(key);
      if (event.winningObservationId != null) {
        const owner = winningObservationOwners.get(event.winningObservationId);
        if (owner !== undefined && owner !== index) {
          throw new TypeError("one winning observation cannot publish multiple properties");
        }
        winningObservationOwners.set(event.winningObservationId, index);
      }
    }
  }
  return input;
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
  if (
    !isPlainRecord(candidate) ||
    MEDIA_CANDIDATE_REQUIRED_KEYS.some((key) => !Object.hasOwn(candidate, key)) ||
    Reflect.ownKeys(candidate).some((key) => !MEDIA_CANDIDATE_KEYS.has(key))
  ) {
    throw new TypeError("observation media candidate is invalid");
  }
  const snapshot = {
    url: candidate.url,
    category: candidate.category,
    isPrimary: candidate.isPrimary,
  };
  requireUrl(snapshot.url, "observation media URL");
  if (
    !MEDIA_CANDIDATE_CATEGORIES.has(snapshot.category) ||
    typeof snapshot.isPrimary !== "boolean"
  ) {
    throw new TypeError("observation media candidate is invalid");
  }
  for (const key of ["rejected", "eligible", "contextRejected"]) {
    if (Object.hasOwn(candidate, key)) {
      const value = candidate[key];
      if (typeof value !== "boolean") {
        throw new TypeError("observation media candidate is invalid");
      }
      snapshot[key] = value;
    }
  }
  if (Object.hasOwn(candidate, "rejectionReason")) {
    const rejectionReason = candidate.rejectionReason;
    if (typeof rejectionReason !== "string") {
      throw new TypeError("observation media candidate is invalid");
    }
    requireSafeText(rejectionReason, "media rejection reason", { max: 500 });
    snapshot.rejectionReason = rejectionReason;
  }
  for (const key of ["rejectionReasons", "contextRejectionMarkers"]) {
    if (Object.hasOwn(candidate, key)) {
      const values = candidate[key];
      requireStringArray(values, key, { maxItems: 100 });
      snapshot[key] = Object.freeze([...values]);
    }
  }
  return Object.freeze(snapshot);
}

function validateObservation(observation) {
  requireDataPropertyGraph(observation);
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
  const mediaCandidates = Object.freeze(
    observation.mediaCandidates.map((candidate) => validateMediaCandidate(candidate)),
  );
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
    mediaCandidates,
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
  const media = serializeJson(mediaCandidates, "observation mediaCandidates");
  return { payload, media, mediaCandidates };
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

function validateQueryResult(result, label, options = {}) {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError(`${label} returned a malformed database result`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(result);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        !QUERY_RESULT_ALLOWED_KEYS.has(key) ||
        !Object.hasOwn(descriptors[key], "value"),
    ) ||
    [...QUERY_RESULT_REQUIRED_KEYS].some((key) => !Object.hasOwn(descriptors, key))
  ) {
    throw new TypeError(`${label} returned a malformed database result`);
  }
  const rows = descriptors.rows.value;
  const rowCount = descriptors.rowCount.value;
  try {
    requireExactArrayDataProperties(rows, `${label} rows`);
  } catch (error) {
    throw new TypeError(`${label} returned a malformed database result`, { cause: error });
  }
  if (rowCount != null && (!Number.isInteger(rowCount) || rowCount < 0)) {
    throw new TypeError(`${label} returned a malformed database result`);
  }
  const command = descriptors.command?.value;
  const fields = descriptors.fields?.value;
  const oid = descriptors.oid?.value;
  if (command !== undefined && command !== null && typeof command !== "string") {
    throw new TypeError(`${label} returned a malformed database result`);
  }
  if (fields !== undefined) {
    try {
      requireExactArrayDataProperties(fields, `${label} fields`);
    } catch (error) {
      throw new TypeError(`${label} returned a malformed database result`, { cause: error });
    }
  }
  if (oid !== undefined && oid !== null && (!Number.isInteger(oid) || oid < 0)) {
    throw new TypeError(`${label} returned a malformed database result`);
  }

  if (options.expectedCommand != null) {
    if (
      !Object.hasOwn(descriptors, "command") ||
      !Object.hasOwn(descriptors, "fields") ||
      !Object.hasOwn(descriptors, "oid") ||
      command !== options.expectedCommand
    ) {
      throw new TypeError(
        `${label} returned command ${String(command)} instead of ${options.expectedCommand}`,
      );
    }
    if (["BEGIN", "COMMIT", "ROLLBACK", "LOCK"].includes(options.expectedCommand)) {
      if (rows.length !== 0 || rowCount !== null || fields.length !== 0) {
        throw new TypeError(`${label} returned a malformed transaction command result`);
      }
    } else if (rowCount !== rows.length) {
      throw new TypeError(`${label} returned an inconsistent rowCount`);
    }
  }
  return Object.freeze({ rows, rowCount, command, fields, oid });
}

function subtractDays(dateValue, count) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function hongKongMidnightUtc(dateValue) {
  return new Date(`${dateValue}T00:00:00+08:00`).toISOString();
}

function redactStandaloneBasic(match, label, credential) {
  let unwrapped = credential.trim();
  const wrappers = new Map([
    ['"', '"'],
    ["'", "'"],
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]);
  while (wrappers.get(unwrapped[0]) === unwrapped.at(-1)) {
    unwrapped = unwrapped.slice(1, -1).trim();
  }
  const decoded = Buffer.from(unwrapped, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  if (canonical === unwrapped.replace(/=+$/, "") && decoded.includes(0x3a)) {
    return `${label} [redacted]`;
  }
  return match;
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
    .replace(STANDALONE_COLON_SCHEME_CREDENTIAL_PATTERN, "$1 [redacted]")
    .replace(STANDALONE_BEARER_CREDENTIAL_PATTERN, "$1 [redacted]")
    .replace(STANDALONE_BASIC_CREDENTIAL_PATTERN, redactStandaloneBasic)
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
    if (Object.hasOwn(status, "baselineRequired") && typeof status.baselineRequired !== "boolean") {
      throw new TypeError("sourceStatus baselineRequired must be boolean");
    }
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
    row.discovered_at_matches_input !== true ||
    row.fetched_at_matches_input !== true ||
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
      throw signal.reason === undefined
        ? new DOMException("The operation was aborted", "AbortError")
        : signal.reason;
    }
  }

  async function query(statement, params = [], label = "repository query", operation) {
    const signal = operationSignal(operation);
    throwIfAborted(signal);
    const result = await client.query(statement, params);
    throwIfAborted(signal);
    return validateQueryResult(result, label).rows;
  }

  async function publicationQuery(
    statement,
    params,
    label,
    expectedCommand,
    operation,
    { checkAfter = true } = {},
  ) {
    const signal = operationSignal(operation);
    throwIfAborted(signal);
    const result = await client.query(statement, params);
    if (checkAfter) throwIfAborted(signal);
    const validated = validateQueryResult(result, label, { expectedCommand });
    return validated.rows;
  }

  async function beginRun(input) {
    if (!isPlainRecord(input)) throw new TypeError("beginRun input is invalid");
    const evidence = Object.freeze({
      scheduledFor: input.scheduledFor,
      mode: input.mode,
      parserVersion: input.parserVersion,
    });
    requireDate(evidence.scheduledFor, "scheduledFor");
    if (!RUN_MODES.has(evidence.mode)) throw new TypeError("mode is invalid");
    requireSafeText(evidence.parserVersion, "parserVersion", { max: 160 });
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
      [evidence.scheduledFor, evidence.mode, evidence.parserVersion],
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
    const requestedObservations = Object.freeze([...observations]);
    const prepared = [];
    const expectedByIdentity = new Map();
    for (const observation of requestedObservations) {
      const { mediaCandidates, ...serialized } = validateObservation(observation);
      const evidence = Object.freeze({ ...observation, mediaCandidates });
      const identity = observationIdentity(evidence);
      if (expectedByIdentity.has(identity)) {
        throw new TypeError("duplicate observation identity");
      }
      expectedByIdentity.set(identity, evidence);
      prepared.push({ observation: evidence, ...serialized });
    }
    Object.freeze(prepared);
    const orderedIdentities = Object.freeze(
      prepared.map(({ observation }) => observationIdentity(observation)),
    );
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
        selectParams.push(
          observation.source,
          observation.externalId,
          observation.dealType,
          observation.discoveredAt,
          observation.fetchedAt,
        );
        const start = 2 + index * 5;
        return `($${start}, $${start + 1}, $${start + 2}::deal_type, $${start + 3}::timestamptz, $${start + 4}::timestamptz)`;
      });
      const batchExpectedByIdentity = new Map(
        batch.map(({ observation }) => [observationIdentity(observation), observation]),
      );
      const rows = await query(
        `SELECT id, source, external_listing_id, deal_type, source_url,
                property_no_raw, property_no_normalized, payload, media_candidates,
                content_hash, validation_state, quarantine_reasons, parse_warnings,
                discovered_at, fetched_at,
                discovered_at = requested.expected_discovered_at AS discovered_at_matches_input,
                fetched_at = requested.expected_fetched_at AS fetched_at_matches_input
           FROM listing_source_observations
           JOIN (VALUES ${tuples.join(", ")}) AS requested(
                  expected_source, expected_external_listing_id, expected_deal_type,
                  expected_discovered_at, expected_fetched_at
                )
             ON source = requested.expected_source
            AND external_listing_id = requested.expected_external_listing_id
            AND deal_type = requested.expected_deal_type
          WHERE run_id = $1::uuid
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
    if (returnedByIdentity.size !== orderedIdentities.length) {
      throw new TypeError("persisted observation rows are missing immutable evidence");
    }
    return orderedIdentities.map((identity) => {
      const ref = returnedByIdentity.get(identity);
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
      typeof row.updated_at === "string";
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
      updated_at: requireRowVersion(row.updated_at, "candidate updated_at"),
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
        `SELECT id, listing_no, canonical_property_no, legacy_property_no, deal_type,
                to_char(updated_at AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
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
      Object.hasOwn(row, "winning_observation_id") &&
      (row.winning_observation_id === null || isUuid(row.winning_observation_id)) &&
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
      Object.hasOwn(row, "last_evaluated_run_id") &&
      (row.last_evaluated_run_id === null || isUuid(row.last_evaluated_run_id)) &&
      Object.hasOwn(row, "inactive_reason") &&
      (row.inactive_reason === null ||
        (typeof row.inactive_reason === "string" && row.inactive_reason.length <= 500)) &&
      Object.hasOwn(row, "inactive_at") &&
      (row.inactive_at === null || isTimestamp(row.inactive_at)) &&
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
      Object.hasOwn(row, "content_type") &&
      (row.content_type === null ||
        (typeof row.content_type === "string" &&
          /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(row.content_type))) &&
      Object.hasOwn(row, "content_hash") &&
      (row.content_hash === null ||
        (typeof row.content_hash === "string" && HASH_PATTERN.test(row.content_hash))) &&
      typeof row.owner_type === "string" &&
      row.owner_type === row.owner_type.trim() &&
      row.owner_type.length > 0 &&
      row.owner_type.length <= 160 &&
      Object.hasOwn(row, "owner_id") &&
      (row.owner_id === null || isUuid(row.owner_id)) &&
      Object.hasOwn(row, "created_by") &&
      (row.created_by === null || isUuid(row.created_by)) &&
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

  function exactPublicationRow(row, keys, label) {
    if (row != null && typeof row === "object") {
      const descriptors = Object.getOwnPropertyDescriptors(row);
      if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, "value"))) {
        throw new TypeError(`${label} contains an accessor instead of a data property`);
      }
    }
    try {
      return requireExactRecord(row, keys, label);
    } catch (error) {
      throw new TypeError(`${label} has an unexpected key or invalid shape`, { cause: error });
    }
  }

  function healthyPublicationSource(sourceStatus, source) {
    const decision = sourceStatus[source];
    return (
      isPlainRecord(decision) &&
      decision.source === source &&
      decision.healthy === true &&
      Array.isArray(decision.reasons) &&
      decision.reasons.length === 0 &&
      decision.baselineRequired !== true
    );
  }

  function publicationBaselineRequired(sourceStatus) {
    return [...SOURCES].some((source) => sourceStatus[source]?.baselineRequired === true);
  }

  async function precheckPublicationBaselineGate(runId, operation) {
    const rows = await publicationQuery(
      `SELECT source_status
         FROM listing_sync_runs
        WHERE id = $1
        LIMIT 2`,
      [runId],
      "publication baseline preflight",
      "SELECT",
      operation,
    );
    if (rows.length !== 1) {
      throw new PublicationGateError("publish run is missing before publication");
    }
    const row = exactPublicationRow(
      rows[0],
      PUBLICATION_BASELINE_ROW_KEYS,
      "publication baseline preflight row",
    );
    const sourceStatus = databaseJsonSnapshot(
      row.source_status,
      "publication baseline preflight source_status",
    );
    validateSourceStatus(sourceStatus);
    if (publicationBaselineRequired(sourceStatus)) {
      throw new PublicationGateError("publication baseline is still required for a current source");
    }
  }

  function validatePublicationRunRow(row, runId) {
    exactPublicationRow(row, PUBLICATION_RUN_ROW_KEYS, "publication run row");
    const sourceStatus = databaseJsonSnapshot(row.source_status, "publication run source_status");
    const startedAt = requireRowVersion(row.started_at, "publication run started_at");
    const valid =
      row.id === runId &&
      isCanonicalDate(row.scheduled_for) &&
      row.mode === "publish" &&
      row.status === "running" &&
      isPlainRecord(sourceStatus) &&
      isCanonicalDate(row.hong_kong_date);
    if (!valid)
      throw new PublicationGateError("publish run is missing, not running, or not publish mode");
    validateSourceStatus(sourceStatus);
    if (publicationBaselineRequired(sourceStatus)) {
      throw new PublicationGateError("publication baseline is still required for a current source");
    }
    if (!healthyPublicationSource(sourceStatus, SOURCE_28HSE)) {
      throw new PublicationGateError("persisted 28Hse evaluation is not healthy");
    }
    if (!isPlainRecord(sourceStatus[SOURCE_OLD_SITE])) {
      throw new PublicationGateError("persisted old-site evaluation is missing");
    }
    return Object.freeze({
      ...row,
      source_status: sourceStatus,
      started_at: startedAt,
    });
  }

  function validatePublicationStreak(rows, run) {
    const seenDates = new Set();
    let expectedDate = null;
    let qualifying = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = exactPublicationRow(
        rows[index],
        PUBLICATION_STREAK_ROW_KEYS,
        "publication shadow streak row",
      );
      const sourceStatus = databaseJsonSnapshot(
        row.source_status,
        "publication shadow source_status",
      );
      let approvedAt;
      try {
        requireRowVersion(row.started_at, "publication shadow started_at");
        approvedAt = requireRowVersion(row.baseline_approved_at, "publication shadow approval");
      } catch (error) {
        throw new PublicationGateError("seven approved healthy shadow runs are required", {
          cause: error,
        });
      }
      if (
        !isUuid(row.id) ||
        !isCanonicalDate(row.scheduled_for) ||
        row.status !== "shadow_healthy" ||
        !isPlainRecord(sourceStatus) ||
        row.date_rank !== 1
      ) {
        throw new PublicationGateError("seven approved healthy shadow runs are required");
      }
      if (seenDates.has(row.scheduled_for)) {
        throw new TypeError("publication shadow streak rows contain a duplicate date");
      }
      seenDates.add(row.scheduled_for);
      validateSourceStatus(sourceStatus);
      if (approvedAt >= run.started_at) {
        throw new PublicationGateError("shadow approval must be strictly before the publish run");
      }
      if (
        !healthyPublicationSource(sourceStatus, SOURCE_28HSE) ||
        !healthyPublicationSource(sourceStatus, SOURCE_OLD_SITE)
      ) {
        throw new PublicationGateError("seven approved healthy shadow runs are required");
      }
      if (index === 0) {
        const previousDate = subtractDays(run.hong_kong_date, 1);
        if (row.scheduled_for !== run.hong_kong_date && row.scheduled_for !== previousDate) {
          throw new PublicationGateError("seven approved healthy shadow runs are required");
        }
        expectedDate = row.scheduled_for;
      }
      if (row.scheduled_for !== expectedDate) {
        throw new PublicationGateError("seven approved healthy shadow runs are required");
      }
      qualifying += 1;
      expectedDate = subtractDays(expectedDate, 1);
      if (qualifying === 7) return;
    }
    throw new PublicationGateError("seven approved healthy shadow runs are required");
  }

  async function recheckPublicationGate(runId, operation) {
    const runRows = await publicationQuery(
      `SELECT id, scheduled_for::text AS scheduled_for,
              to_char(started_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
              mode, status,
              source_status,
              (started_at AT TIME ZONE 'Asia/Hong_Kong')::date::text AS hong_kong_date
         FROM listing_sync_runs
        WHERE id = $1
        FOR UPDATE`,
      [runId],
      "publication run gate",
      "SELECT",
      operation,
    );
    if (runRows.length !== 1) {
      throw new PublicationGateError("publish run is missing, not running, or not publish mode");
    }
    const run = validatePublicationRunRow(runRows[0], runId);
    const streakRows = await publicationQuery(
      `WITH publication_shadow_streak AS (
         SELECT id, scheduled_for::text AS scheduled_for, started_at, status,
                source_status, baseline_approved_at,
                (row_number() OVER (
                  PARTITION BY scheduled_for
                  ORDER BY COALESCE(finished_at, started_at) DESC, id DESC
                ))::int AS date_rank
           FROM listing_sync_runs
          WHERE mode = 'shadow'
            AND scheduled_for <= $1::date
            AND started_at < $2::timestamptz
       )
       SELECT id, scheduled_for,
              to_char(started_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
              status, source_status,
              to_char(baseline_approved_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS baseline_approved_at,
              date_rank
         FROM publication_shadow_streak
        WHERE date_rank = 1
        ORDER BY scheduled_for DESC, started_at DESC, id DESC
        LIMIT 8`,
      [run.hong_kong_date, run.started_at],
      "publication shadow streak",
      "SELECT",
      operation,
    );
    validatePublicationStreak(streakRows, run);
    return Object.freeze({
      run,
      sourceApproved: Object.freeze({
        [SOURCE_28HSE]: true,
        [SOURCE_OLD_SITE]: healthyPublicationSource(run.source_status, SOURCE_OLD_SITE),
      }),
    });
  }

  function validatePublicationObservationRow(row, expected, label) {
    exactPublicationRow(row, PUBLICATION_OBSERVATION_ROW_KEYS, label);
    const fetchedAt = requireTimestamp(row.fetched_at, `${label}.fetched_at`);
    const payload = databaseJsonSnapshot(row.payload, `${label}.payload`);
    requireExactRecord(
      payload,
      new Set(["schemaVersion", "fields", "rawFields", "sourceUpdatedAt", "parseWarnings"]),
      `${label}.payload`,
    );
    if (payload.schemaVersion !== 1) throw new TypeError(`${label}.payload schema is invalid`);
    validateListingFields(payload.fields);
    if (!isPlainRecord(payload.rawFields)) {
      throw new TypeError(`${label}.payload rawFields is invalid`);
    }
    serializeJson(payload.rawFields, `${label}.payload rawFields`);
    if (payload.sourceUpdatedAt !== null) {
      requireObservationTimestamp(payload.sourceUpdatedAt, `${label}.payload sourceUpdatedAt`, {
        allowDate: true,
      });
    }
    requireStringArray(payload.parseWarnings, `${label}.payload parseWarnings`, {
      maxItems: 200,
      maxLength: 500,
    });
    const mediaCandidates = databaseJsonSnapshot(row.media_candidates, `${label}.media_candidates`);
    if (!Array.isArray(mediaCandidates) || mediaCandidates.length > 200) {
      throw new TypeError(`${label}.media_candidates is invalid`);
    }
    for (const candidate of mediaCandidates) validateMediaCandidate(candidate);
    if (
      !isUuid(row.id) ||
      !isUuid(row.run_id) ||
      !isSource(row.source) ||
      !isExternalId(row.external_listing_id) ||
      !isDealType(row.deal_type) ||
      (row.property_no_normalized != null &&
        normalizePropertyNo(row.property_no_normalized) !== row.property_no_normalized) ||
      row.validation_state !== "valid" ||
      typeof row.content_hash !== "string" ||
      !HASH_PATTERN.test(row.content_hash)
    ) {
      throw new TypeError(`${label} is invalid`);
    }
    if (expected.id != null && row.id !== expected.id) {
      throw new TypeError(`${label} does not match its requested UUID`);
    }
    if (expected.runId != null && row.run_id !== expected.runId) {
      throw new TypeError(`${label} does not match its requested run UUID`);
    }
    if (
      expected.source != null &&
      (row.source !== expected.source ||
        row.external_listing_id !== expected.externalId ||
        row.deal_type !== expected.dealType)
    ) {
      throw new TypeError(`${label} does not match its requested source identity`);
    }
    const computedHash = stableObservationHash({
      schemaVersion: payload.schemaVersion,
      source: row.source,
      externalId: row.external_listing_id,
      dealType: row.deal_type,
      propertyNoNormalized: row.property_no_normalized,
      fields: payload.fields,
      rawFields: payload.rawFields,
      mediaCandidates,
      sourceUpdatedAt: payload.sourceUpdatedAt,
    });
    if (computedHash !== row.content_hash) {
      throw new TypeError(`${label} content hash does not match normalized payload evidence`);
    }
    return Object.freeze({
      ...row,
      fetched_at: fetchedAt,
      payload,
      media_candidates: mediaCandidates,
    });
  }

  async function loadWinningObservations(proposal, runId, sourceApproved, operation) {
    const ids = new Set();
    for (const field of proposal.fields) {
      if (field.winningObservationId != null) ids.add(field.winningObservationId);
    }
    for (const event of proposal.events) {
      if (event.winningObservationId != null) ids.add(event.winningObservationId);
    }
    const byId = new Map();
    for (const id of [...ids].sort()) {
      const rows = await publicationQuery(
        `SELECT id, run_id, source, external_listing_id, deal_type, property_no_normalized,
                validation_state, fetched_at, payload, media_candidates, content_hash
           FROM listing_source_observations
          WHERE id = $1::uuid AND run_id = $2::uuid
          LIMIT 2
          FOR UPDATE`,
        [id, runId],
        "publication winning observation",
        "SELECT",
        operation,
      );
      if (rows.length !== 1) {
        throw new TypeError("publication winning observation is missing or duplicated");
      }
      const observation = validatePublicationObservationRow(
        rows[0],
        { id, runId },
        "publication winning observation row",
      );
      if (!sourceApproved[observation.source]) {
        throw new PublicationGateError(
          "winning observation source did not pass this run's health gate",
        );
      }
      if (
        observation.property_no_normalized !== proposal.canonical.canonical_property_no ||
        observation.deal_type !== proposal.canonical.deal_type
      ) {
        throw new TypeError(
          "publication winning observation does not match the canonical identity",
        );
      }
      if (
        !proposal.links.some(
          (link) =>
            link.source === observation.source &&
            link.externalId === observation.external_listing_id &&
            link.dealType === observation.deal_type,
        )
      ) {
        throw new TypeError("publication winning observation has no exact source link");
      }
      byId.set(id, observation);
    }
    return byId;
  }

  function automatedValuePresent(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  async function validateFieldProvenance(proposal, winningObservations, operation) {
    for (const field of proposal.fields) {
      if (field.activeOverride) continue;
      if (field.winningObservationId == null) continue;
      const observation = winningObservations.get(field.winningObservationId);
      if (!observation) {
        throw new TypeError("publication field winner is not exact current-run evidence");
      }
      if (field.fieldName === "images") continue;
      let sourceValue;
      if (field.fieldName === "description" && observation.source === SOURCE_28HSE) {
        sourceValue = undefined;
      } else if (field.fieldName === "estate_id") {
        const estateSlug = normalizeCanonicalFieldValue(
          "district_slug",
          observation.payload.fields.estate_slug,
        );
        if (estateSlug != null && field.lastPublishedValue != null) {
          const rows = await publicationQuery(
            `SELECT id
               FROM estates
              WHERE slug = $1 AND id = $2::uuid
              ORDER BY id
              LIMIT 2
              FOR SHARE`,
            [estateSlug, field.lastPublishedValue],
            "publication estate provenance",
            "SELECT",
            operation,
          );
          if (rows.length !== 1) {
            throw new TypeError("publication estate value lacks exact source-slug evidence");
          }
          exactPublicationRow(rows[0], new Set(["id"]), "publication estate provenance row");
          if (rows[0].id !== field.lastPublishedValue) {
            throw new TypeError("publication estate value lacks exact source-slug evidence");
          }
          sourceValue = field.lastPublishedValue;
        }
      } else {
        sourceValue = normalizeCanonicalFieldValue(
          field.fieldName,
          observation.payload.fields[field.fieldName],
        );
      }
      if (
        !automatedValuePresent(sourceValue) ||
        !jsonEqual(sourceValue, field.lastPublishedValue)
      ) {
        throw new TypeError(
          `publication ${field.fieldName} value does not match its winning observation payload`,
        );
      }
    }
  }

  const CANONICAL_PARAMS = Object.freeze([
    "listing_no",
    "canonical_property_no",
    "title_zh",
    "title_en",
    "deal_type",
    "estate_id",
    "district_slug",
    "address",
    "price",
    "rent",
    "saleable_area",
    "gross_area",
    "bedrooms",
    "bathrooms",
    "floor",
    "orientation",
    "features",
    "description",
    "images",
    "status",
  ]);

  function canonicalParams(canonical) {
    return CANONICAL_PARAMS.map((key) => canonical[key]);
  }

  function validateReturnedPropertyId(rows, expectedId, label, { optional = false } = {}) {
    if ((optional && rows.length > 1) || (!optional && rows.length !== 1)) {
      throw new TypeError(`${label} returned an invalid row count`);
    }
    if (rows.length === 0) return null;
    exactPublicationRow(rows[0], new Set(["id"]), `${label} row`);
    if (!isUuid(rows[0].id) || (expectedId != null && rows[0].id !== expectedId)) {
      throw new TypeError(`${label} returned an invalid property UUID`);
    }
    return rows[0].id;
  }

  function lockedCanonicalValues(row) {
    const current = Object.fromEntries(CANONICAL_PARAMS.map((key) => [key, row[key]]));
    for (const key of ["listing_no", "title_zh", "district_slug"]) {
      requireSafeText(current[key], `locked canonical ${key}`, { max: 2_000 });
    }
    if (
      current.canonical_property_no !== null &&
      (typeof current.canonical_property_no !== "string" ||
        normalizePropertyNo(current.canonical_property_no) !== current.canonical_property_no)
    ) {
      throw new TypeError("locked canonical property number is invalid");
    }
    requireNullableText(current.title_en, "locked canonical title_en", 2_000);
    if (!isDealType(current.deal_type))
      throw new TypeError("locked canonical deal type is invalid");
    if (current.estate_id !== null) requireUuid(current.estate_id, "locked canonical estate_id");
    requireNullableText(current.address, "locked canonical address", 2_000);
    for (const key of ["price", "rent"]) {
      requireNullableNumber(current[key], `locked canonical ${key}`);
    }
    for (const key of ["saleable_area", "gross_area", "bedrooms", "bathrooms"]) {
      requireNullableNumber(current[key], `locked canonical ${key}`, { integer: true });
    }
    requireNullableText(current.floor, "locked canonical floor", 200);
    requireNullableText(current.orientation, "locked canonical orientation", 200);
    for (const key of ["features", "images"]) {
      if (current[key] !== null) {
        current[key] = snapshotDataGraph(current[key], `locked canonical ${key}`);
        requireStringArray(current[key], `locked canonical ${key}`, {
          maxItems: 200,
          maxLength: key === "images" ? 2_048 : 500,
        });
      }
    }
    requireNullableText(current.description, "locked canonical description", 100_000);
    if (!PROPERTY_STATUSES.has(current.status)) {
      throw new TypeError("locked canonical status is invalid");
    }
    return Object.freeze(current);
  }

  async function assertNewIdentityAvailable(proposal, operation) {
    const canonical = proposal.canonical;
    const lockKeys = [
      `canonical:${canonical.deal_type}:${canonical.canonical_property_no}`,
      `listing:${canonical.listing_no}`,
    ].sort();
    for (const lockKey of lockKeys) {
      const lockRows = await publicationQuery(
        `SELECT count(*)::int AS acquired
           FROM (SELECT pg_advisory_xact_lock(hashtextextended($1, 0))) AS identity_lock`,
        [lockKey],
        "publication canonical identity advisory lock",
        "SELECT",
        operation,
      );
      if (lockRows.length !== 1) {
        throw new TypeError("publication canonical identity advisory lock returned no evidence");
      }
      exactPublicationRow(
        lockRows[0],
        new Set(["acquired"]),
        "publication canonical identity advisory-lock row",
      );
      if (lockRows[0].acquired !== 1) {
        throw new TypeError("publication canonical identity advisory lock was not acquired");
      }
    }
    const conflictRows = await publicationQuery(
      `SELECT id, listing_no, canonical_property_no, deal_type
         FROM properties
        WHERE (canonical_property_no = $1 AND deal_type = $2::deal_type)
           OR listing_no = $3
        ORDER BY id
        LIMIT 2
        FOR UPDATE`,
      [canonical.canonical_property_no, canonical.deal_type, canonical.listing_no],
      "publication new canonical identity conflict check",
      "SELECT",
      operation,
    );
    if (conflictRows.length > 0) {
      for (const row of conflictRows) {
        exactPublicationRow(
          row,
          new Set(["id", "listing_no", "canonical_property_no", "deal_type"]),
          "publication canonical identity conflict row",
        );
      }
      throw new PublicationConflictError("publication conflict: canonical identity already exists");
    }
  }

  async function lockActiveOverrideHistory(proposal, propertyId, currentCanonical, operation) {
    const activeFields = proposal.fields
      .filter((field) => field.activeOverride)
      .sort((left, right) => left.fieldName.localeCompare(right.fieldName));
    if (activeFields.length === 0) return;
    const fieldNames = activeFields.map((field) => field.fieldName);
    const rows = await publicationQuery(
      `SELECT property_id, field_name, last_published_value, override_value,
              active_override, winning_observation_id
         FROM property_sync_fields
        WHERE property_id = $1::uuid
          AND field_name = ANY($2::text[])
        ORDER BY field_name
        FOR UPDATE`,
      [propertyId, fieldNames],
      "lock active override history",
      "SELECT",
      operation,
    );
    if (rows.length !== activeFields.length) {
      throw new PublicationConflictError(
        "publication conflict: active override field history is missing",
        { propertyId },
      );
    }
    for (let index = 0; index < activeFields.length; index += 1) {
      const field = activeFields[index];
      const row = exactPublicationRow(
        rows[index],
        LOCKED_FIELD_STATE_ROW_KEYS,
        "locked active override field row",
      );
      const lastPublishedValue = databaseDecodedJsonSnapshot(
        row.last_published_value,
        "locked active override baseline",
      );
      databaseDecodedJsonSnapshot(row.override_value, "locked active override value");
      if (
        row.property_id !== propertyId ||
        row.field_name !== field.fieldName ||
        typeof row.active_override !== "boolean" ||
        (row.winning_observation_id !== null && !isUuid(row.winning_observation_id))
      ) {
        throw new TypeError("locked active override field row is invalid");
      }
      if (!jsonEqual(lastPublishedValue, field.lastPublishedValue)) {
        throw new PublicationConflictError(
          "publication conflict: active override automated baseline changed",
          { propertyId },
        );
      }
      if (
        row.active_override === false &&
        jsonEqual(currentCanonical[field.fieldName], lastPublishedValue)
      ) {
        throw new PublicationConflictError(
          "publication conflict: active override lacks a locked staff edit",
          { propertyId },
        );
      }
    }
  }

  async function lockAndValidateLifecycleHistory(
    proposal,
    propertyId,
    currentCanonical,
    gate,
    operation,
  ) {
    const rows = await publicationQuery(
      `SELECT property_id, consecutive_absent_healthy_runs, last_evaluated_run_id,
              inactive_reason,
              CASE WHEN inactive_at IS NULL THEN NULL
                   ELSE to_char(inactive_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
              END AS inactive_at_token
         FROM property_sync_state
        WHERE property_id = $1::uuid
        FOR UPDATE`,
      [propertyId],
      "lock publication lifecycle history",
      "SELECT",
      operation,
    );
    if (rows.length > 1) throw new TypeError("publication lifecycle history is duplicated");
    let currentState = null;
    if (rows.length === 1) {
      const row = exactPublicationRow(
        rows[0],
        LOCKED_LIFECYCLE_ROW_KEYS,
        "locked publication lifecycle row",
      );
      if (
        row.property_id !== propertyId ||
        !Number.isInteger(row.consecutive_absent_healthy_runs) ||
        row.consecutive_absent_healthy_runs < 0 ||
        row.consecutive_absent_healthy_runs > MAX_INT ||
        !isUuid(row.last_evaluated_run_id)
      ) {
        throw new TypeError("locked publication lifecycle row is invalid");
      }
      requireNullableText(row.inactive_reason, "locked lifecycle inactive reason", 500);
      if (row.inactive_at_token !== null) {
        requireRowVersion(row.inactive_at_token, "locked lifecycle inactive time");
      }
      if ((row.inactive_reason === null) !== (row.inactive_at_token === null)) {
        throw new TypeError("locked publication lifecycle row is inconsistent");
      }
      currentState = row;
    }

    const wasInactive = currentCanonical.status === "inactive";
    const becomesInactive = proposal.canonical.status === "inactive";
    if (!wasInactive && becomesInactive) {
      if (
        gate.sourceApproved[SOURCE_28HSE] !== true ||
        gate.sourceApproved[SOURCE_OLD_SITE] !== true
      ) {
        throw new PublicationGateError("inactivity requires both current sources to be healthy");
      }
      if (proposal.lifecycle.inactiveAt !== gate.run.started_at) {
        throw new TypeError(
          "inactive lifecycle effective time must equal the locked publish-run start",
        );
      }
      if (
        currentState == null ||
        currentState.consecutive_absent_healthy_runs !== 1 ||
        currentState.inactive_reason !== null ||
        currentState.inactive_at_token !== null
      ) {
        throw new PublicationConflictError(
          "publication conflict: first healthy absence lifecycle history changed",
          { propertyId },
        );
      }
    } else if (wasInactive) {
      if (
        currentState == null ||
        currentState.consecutive_absent_healthy_runs < 2 ||
        currentState.inactive_reason == null ||
        currentState.inactive_at_token == null
      ) {
        throw new PublicationConflictError(
          "publication conflict: inactive lifecycle history is missing",
          { propertyId },
        );
      }
      if (
        becomesInactive &&
        (proposal.lifecycle.inactiveReason !== currentState.inactive_reason ||
          proposal.lifecycle.inactiveAt !== currentState.inactive_at_token)
      ) {
        throw new PublicationConflictError(
          "publication conflict: inactive lifecycle history cannot be rewritten",
          { propertyId },
        );
      }
    }
  }

  async function writeCanonicalProperty(proposal, gate, operation) {
    const values = canonicalParams(proposal.canonical);
    if (proposal.kind === "new") {
      await assertNewIdentityAvailable(proposal, operation);
      let rows;
      try {
        rows = await publicationQuery(
          `INSERT INTO properties (
           listing_no, canonical_property_no, title_zh, title_en, deal_type,
           estate_id, district_slug, address, price, rent, saleable_area,
           gross_area, bedrooms, bathrooms, floor, orientation, features,
           description, images, status
         ) VALUES (
           $1, $2, $3, $4, $5::deal_type, $6::uuid, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17::text[], $18, $19::text[],
           $20::property_status
         )
         RETURNING id`,
          values,
          "insert canonical property",
          "INSERT",
          operation,
        );
      } catch (error) {
        if (["23505", "23P01"].includes(databaseErrorCode(error))) {
          throw new PublicationConflictError(
            "publication conflict: canonical identity changed during insert",
            { cause: error },
          );
        }
        throw error;
      }
      return {
        propertyId: validateReturnedPropertyId(rows, null, "canonical insert"),
        changed: true,
        changedFields: new Set(RECONCILED_FIELD_NAMES),
        currentCanonical: null,
      };
    }

    const lockedRows = await publicationQuery(
      `SELECT id,
              to_char(updated_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_token,
              updated_at = $2::timestamptz AS updated_at_matches_expected,
              listing_no, canonical_property_no, title_zh, title_en,
              deal_type, estate_id, district_slug, address,
              price::float8 AS price, rent::float8 AS rent,
              saleable_area, gross_area, bedrooms, bathrooms, floor, orientation,
              features, description, images, status
         FROM properties
        WHERE id = $1
        FOR UPDATE`,
      [proposal.propertyId, proposal.expectedUpdatedAt],
      "lock canonical property",
      "SELECT",
      operation,
    );
    if (lockedRows.length !== 1) {
      throw new PublicationConflictError("publication conflict: canonical property is missing", {
        propertyId: proposal.propertyId,
      });
    }
    exactPublicationRow(lockedRows[0], LOCKED_PROPERTY_ROW_KEYS, "locked property row");
    const actualUpdatedAt = requireRowVersion(
      lockedRows[0].updated_at_token,
      "locked property updated_at",
    );
    if (
      lockedRows[0].id !== proposal.propertyId ||
      actualUpdatedAt !== proposal.expectedUpdatedAt ||
      lockedRows[0].updated_at_matches_expected !== true
    ) {
      throw new PublicationConflictError("publication conflict: expectedUpdatedAt does not match", {
        propertyId: proposal.propertyId,
      });
    }
    const currentCanonical = lockedCanonicalValues(lockedRows[0]);
    if (
      currentCanonical.listing_no !== proposal.canonical.listing_no ||
      currentCanonical.canonical_property_no !== proposal.canonical.canonical_property_no ||
      currentCanonical.deal_type !== proposal.canonical.deal_type
    ) {
      throw new PublicationConflictError("publication conflict: canonical identity changed", {
        propertyId: proposal.propertyId,
      });
    }
    for (const field of proposal.fields) {
      if (
        field.activeOverride &&
        (!jsonEqual(currentCanonical[field.fieldName], field.overrideValue) ||
          !jsonEqual(currentCanonical[field.fieldName], proposal.canonical[field.fieldName]))
      ) {
        throw new PublicationConflictError(
          "publication conflict: active override does not match the locked staff value",
          { propertyId: proposal.propertyId },
        );
      }
    }
    await lockActiveOverrideHistory(proposal, proposal.propertyId, currentCanonical, operation);
    await lockAndValidateLifecycleHistory(
      proposal,
      proposal.propertyId,
      currentCanonical,
      gate,
      operation,
    );
    const changedFields = new Set(
      RECONCILED_FIELD_NAMES.filter(
        (fieldName) => !jsonEqual(currentCanonical[fieldName], proposal.canonical[fieldName]),
      ),
    );
    const canonicalChanged = CANONICAL_PARAMS.some(
      (fieldName) => !jsonEqual(currentCanonical[fieldName], proposal.canonical[fieldName]),
    );
    const rows = await publicationQuery(
      `UPDATE properties SET
         listing_no = $1,
         canonical_property_no = $2,
         title_zh = $3,
         title_en = $4,
         deal_type = $5::deal_type,
         estate_id = $6::uuid,
         district_slug = $7,
         address = $8,
         price = $9,
         rent = $10,
         saleable_area = $11,
         gross_area = $12,
         bedrooms = $13,
         bathrooms = $14,
         floor = $15,
         orientation = $16,
         features = $17::text[],
         description = $18,
         images = $19::text[],
         status = $20::property_status,
         updated_at = now()
       WHERE id = $21::uuid
         AND updated_at = $22::timestamptz
         AND ROW(
           listing_no, canonical_property_no, title_zh, title_en, deal_type,
           estate_id, district_slug, address, price, rent, saleable_area,
           gross_area, bedrooms, bathrooms, floor, orientation, features,
           description, images, status
         ) IS DISTINCT FROM ROW(
           $1, $2, $3, $4, $5::deal_type, $6::uuid, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17::text[], $18, $19::text[],
           $20::property_status
         )
       RETURNING id`,
      [...values, proposal.propertyId, proposal.expectedUpdatedAt],
      "update canonical property",
      "UPDATE",
      operation,
    );
    const propertyId = validateReturnedPropertyId(rows, proposal.propertyId, "canonical update", {
      optional: true,
    });
    if (canonicalChanged && propertyId == null) {
      throw new PublicationConflictError(
        "publication conflict: expectedUpdatedAt changed during canonical update",
        { propertyId: proposal.propertyId },
      );
    }
    if (!canonicalChanged && propertyId != null) {
      throw new TypeError("locked canonical comparison disagrees with the changed-only update");
    }
    return {
      propertyId: proposal.propertyId,
      changed: canonicalChanged,
      changedFields,
      currentCanonical,
    };
  }

  async function writeSourceLinks(proposal, propertyId, runId, sourceApproved, operation) {
    const changes = [];
    for (const link of [...proposal.links].sort((left, right) =>
      observationIdentity(left).localeCompare(observationIdentity(right)),
    )) {
      if (!sourceApproved[link.source]) {
        throw new PublicationGateError(
          "source link observation did not pass this run's health gate",
        );
      }
      const observationRows = await publicationQuery(
        `SELECT id, run_id, source, external_listing_id, deal_type, property_no_normalized,
                validation_state, fetched_at, payload, media_candidates, content_hash
           FROM listing_source_observations
          WHERE run_id = $1::uuid AND source = $2 AND external_listing_id = $3
            AND deal_type = $4::deal_type
          ORDER BY id
          LIMIT 2
          FOR UPDATE`,
        [runId, link.source, link.externalId, link.dealType],
        "publication source-link observation",
        "SELECT",
        operation,
      );
      if (observationRows.length !== 1) {
        throw new TypeError("publication source-link observation is missing or duplicated");
      }
      const observation = validatePublicationObservationRow(
        observationRows[0],
        { ...link, runId },
        "publication source-link observation row",
      );
      if (
        observation.property_no_normalized !== proposal.canonical.canonical_property_no ||
        observationTimestampInstant(link.observedAt) !== observation.fetched_at
      ) {
        throw new TypeError("publication source-link observation evidence does not match");
      }
      const existingRows = await publicationQuery(
        `SELECT property_id, match_key, status, first_seen_at, last_seen_at, last_seen_run_id
           FROM property_source_links
          WHERE source = $1 AND external_listing_id = $2 AND deal_type = $3::deal_type
          LIMIT 2
          FOR UPDATE`,
        [link.source, link.externalId, link.dealType],
        "publication source-link lock",
        "SELECT",
        operation,
      );
      if (existingRows.length > 1) throw new TypeError("publication source link is duplicated");
      if (existingRows.length === 1) {
        const existing = exactPublicationRow(
          existingRows[0],
          new Set([
            "property_id",
            "match_key",
            "status",
            "first_seen_at",
            "last_seen_at",
            "last_seen_run_id",
          ]),
          "publication source-link row",
        );
        const firstSeenAt = requireTimestamp(
          existing.first_seen_at,
          "publication source-link first_seen_at",
        );
        const lastSeenAt = requireTimestamp(
          existing.last_seen_at,
          "publication source-link last_seen_at",
        );
        if (
          !LINK_STATUSES.has(existing.status) ||
          !isUuid(existing.property_id) ||
          !isUuid(existing.last_seen_run_id) ||
          typeof existing.match_key !== "string" ||
          firstSeenAt > lastSeenAt ||
          existing.property_id !== propertyId ||
          existing.match_key !== link.matchKey ||
          existing.status === "rejected"
        ) {
          if (
            !LINK_STATUSES.has(existing.status) ||
            !isUuid(existing.property_id) ||
            !isUuid(existing.last_seen_run_id) ||
            typeof existing.match_key !== "string" ||
            firstSeenAt > lastSeenAt
          ) {
            throw new TypeError("publication source-link row is invalid");
          }
          throw new PublicationConflictError("publication conflict: source link is already owned", {
            propertyId,
          });
        }
        if (existing.status !== "active") {
          changes.push(
            Object.freeze({
              oldValue: Object.freeze({
                source: link.source,
                externalId: link.externalId,
                dealType: link.dealType,
                matchKey: existing.match_key,
                status: existing.status,
              }),
              newValue: Object.freeze({
                source: link.source,
                externalId: link.externalId,
                dealType: link.dealType,
                matchKey: link.matchKey,
                status: "active",
              }),
              winningObservationId: observation.id,
            }),
          );
        }
      } else {
        changes.push(
          Object.freeze({
            oldValue: null,
            newValue: Object.freeze({
              source: link.source,
              externalId: link.externalId,
              dealType: link.dealType,
              matchKey: link.matchKey,
              status: "active",
            }),
            winningObservationId: observation.id,
          }),
        );
      }
      const rows = await publicationQuery(
        `INSERT INTO property_source_links (
           property_id, source, external_listing_id, deal_type, match_key,
           link_reason, status, first_seen_at, last_seen_at, last_seen_run_id
         ) VALUES (
           $1::uuid, $2, $3, $4::deal_type, $5,
           'exact_property_no_and_deal_type', 'active', $6::timestamptz,
           $6::timestamptz, $7::uuid
         )
         ON CONFLICT (source, external_listing_id, deal_type) DO UPDATE SET
           match_key = EXCLUDED.match_key,
           status = 'active',
           first_seen_at = LEAST(property_source_links.first_seen_at, EXCLUDED.first_seen_at),
           last_seen_at = GREATEST(property_source_links.last_seen_at, EXCLUDED.last_seen_at),
           last_seen_run_id = CASE
             WHEN EXCLUDED.last_seen_at >= property_source_links.last_seen_at
             THEN EXCLUDED.last_seen_run_id
             ELSE property_source_links.last_seen_run_id
           END,
           updated_at = CASE
             WHEN property_source_links.match_key IS DISTINCT FROM EXCLUDED.match_key
               OR property_source_links.status IS DISTINCT FROM 'active'
               OR EXCLUDED.last_seen_at > property_source_links.last_seen_at
               OR (
                 EXCLUDED.last_seen_at >= property_source_links.last_seen_at
                 AND property_source_links.last_seen_run_id
                   IS DISTINCT FROM EXCLUDED.last_seen_run_id
               )
             THEN now()
             ELSE property_source_links.updated_at
           END
         WHERE property_source_links.property_id = EXCLUDED.property_id
           AND property_source_links.status <> 'rejected'
         RETURNING property_id`,
        [
          propertyId,
          link.source,
          link.externalId,
          link.dealType,
          link.matchKey,
          observation.fetched_at,
          runId,
        ],
        "publish source link",
        "INSERT",
        operation,
      );
      if (rows.length !== 1) {
        throw new PublicationConflictError("publication conflict: source link write was rejected", {
          propertyId,
        });
      }
      exactPublicationRow(rows[0], new Set(["property_id"]), "published source-link row");
      if (rows[0].property_id !== propertyId) {
        throw new TypeError("published source-link row does not match its property");
      }
    }
    return Object.freeze(changes);
  }

  async function writeFieldStates(proposal, propertyId, operation) {
    for (const field of [...proposal.fields].sort((left, right) =>
      left.fieldName.localeCompare(right.fieldName),
    )) {
      const lastPublished =
        field.lastPublishedValue == null
          ? null
          : serializeJson(field.lastPublishedValue, "published field value");
      const override =
        field.overrideValue == null
          ? null
          : serializeJson(field.overrideValue, "published field override");
      const rows = await publicationQuery(
        `INSERT INTO property_sync_fields (
           property_id, field_name, last_published_value, override_value,
           active_override, winning_observation_id
         ) VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5, $6::uuid)
         ON CONFLICT (property_id, field_name) DO UPDATE SET
           last_published_value = EXCLUDED.last_published_value,
           override_value = EXCLUDED.override_value,
           active_override = EXCLUDED.active_override,
           winning_observation_id = EXCLUDED.winning_observation_id,
           updated_at = CASE
             WHEN property_sync_fields.last_published_value IS DISTINCT FROM EXCLUDED.last_published_value
               OR property_sync_fields.override_value IS DISTINCT FROM EXCLUDED.override_value
               OR property_sync_fields.active_override IS DISTINCT FROM EXCLUDED.active_override
               OR property_sync_fields.winning_observation_id IS DISTINCT FROM EXCLUDED.winning_observation_id
             THEN now()
             ELSE property_sync_fields.updated_at
           END
         RETURNING property_id`,
        [
          propertyId,
          field.fieldName,
          lastPublished,
          override,
          field.activeOverride,
          field.winningObservationId,
        ],
        "publish field state",
        "INSERT",
        operation,
      );
      if (rows.length !== 1)
        throw new TypeError("published field state returned an invalid row count");
      exactPublicationRow(rows[0], new Set(["property_id"]), "published field-state row");
      if (rows[0].property_id !== propertyId) {
        throw new TypeError("published field-state row does not match its property");
      }
    }
  }

  async function writeLifecycleState(proposal, propertyId, runId, operation) {
    const lifecycle = proposal.lifecycle;
    const rows = await publicationQuery(
      `INSERT INTO property_sync_state (
         property_id, consecutive_absent_healthy_runs, last_evaluated_run_id,
         inactive_reason, inactive_at
       ) VALUES ($1::uuid, $2, $3::uuid, $4, $5::timestamptz)
       ON CONFLICT (property_id) DO UPDATE SET
         consecutive_absent_healthy_runs = EXCLUDED.consecutive_absent_healthy_runs,
         last_evaluated_run_id = EXCLUDED.last_evaluated_run_id,
         inactive_reason = EXCLUDED.inactive_reason,
         inactive_at = EXCLUDED.inactive_at,
         updated_at = CASE
           WHEN property_sync_state.consecutive_absent_healthy_runs IS DISTINCT FROM EXCLUDED.consecutive_absent_healthy_runs
             OR property_sync_state.last_evaluated_run_id IS DISTINCT FROM EXCLUDED.last_evaluated_run_id
             OR property_sync_state.inactive_reason IS DISTINCT FROM EXCLUDED.inactive_reason
             OR property_sync_state.inactive_at IS DISTINCT FROM EXCLUDED.inactive_at
           THEN now()
           ELSE property_sync_state.updated_at
         END
       RETURNING property_id`,
      [
        propertyId,
        lifecycle.consecutiveAbsentHealthyRuns,
        runId,
        lifecycle.inactiveReason,
        lifecycle.inactiveAt,
      ],
      "publish lifecycle state",
      "INSERT",
      operation,
    );
    if (rows.length !== 1)
      throw new TypeError("published lifecycle state returned an invalid row count");
    exactPublicationRow(rows[0], new Set(["property_id"]), "published lifecycle-state row");
    if (rows[0].property_id !== propertyId) {
      throw new TypeError("published lifecycle-state row does not match its property");
    }
  }

  async function attachImageMedia(proposal, propertyId, winningObservations, operation) {
    const imageField = proposal.fields.find((field) => field.fieldName === "images");
    if (proposal.canonical.images.length === 0 || imageField.winningObservationId == null) {
      return;
    }
    const winningObservation = winningObservations.get(imageField.winningObservationId);
    if (!winningObservation) {
      throw new TypeError("published images winner is not current-run evidence");
    }
    const upstreamCandidates = new Set(
      winningObservation.media_candidates.map((candidate) => candidate.url),
    );
    const rows = await publicationQuery(
      `SELECT lmr.id, lmr.observation_id, lmr.property_id, lmr.source_url,
              lmr.eligibility, lmr.owned_media_asset_id,
              lmr.content_hash AS record_content_hash,
              ma.url AS owned_url, ma.content_hash AS asset_content_hash
         FROM listing_media_records AS lmr
         JOIN media_assets AS ma ON ma.id = lmr.owned_media_asset_id
        WHERE lmr.observation_id = $1::uuid
          AND ma.url = ANY($2::text[])
          AND lmr.eligibility = 'eligible'
          AND lmr.owned_media_asset_id IS NOT NULL
        ORDER BY lmr.id
        FOR UPDATE OF lmr`,
      [imageField.winningObservationId, proposal.canonical.images],
      "lock publishable image media",
      "SELECT",
      operation,
    );
    const byUrl = new Map();
    const ids = [];
    for (const rawRow of rows) {
      const row = exactPublicationRow(rawRow, PUBLICATION_MEDIA_ROW_KEYS, "publication media row");
      if (
        !isUuid(row.id) ||
        row.observation_id !== imageField.winningObservationId ||
        (row.property_id != null && !isUuid(row.property_id)) ||
        !proposal.canonical.images.includes(row.owned_url) ||
        requireUrl(row.source_url, "publication upstream media URL") !== row.source_url ||
        requireUrl(row.owned_url, "publication owned media URL") !== row.owned_url ||
        row.eligibility !== "eligible" ||
        !isUuid(row.owned_media_asset_id) ||
        typeof row.record_content_hash !== "string" ||
        !HASH_PATTERN.test(row.record_content_hash) ||
        typeof row.asset_content_hash !== "string" ||
        !HASH_PATTERN.test(row.asset_content_hash) ||
        row.record_content_hash !== row.asset_content_hash
      ) {
        throw new TypeError("publication media row is invalid");
      }
      if (!upstreamCandidates.has(row.source_url)) {
        throw new TypeError(
          "publication upstream media URL is not a candidate in the winning observation",
        );
      }
      if (row.property_id != null && row.property_id !== propertyId) {
        throw new PublicationConflictError(
          "publication conflict: media belongs to another property",
          {
            propertyId,
          },
        );
      }
      if (byUrl.has(row.owned_url)) throw new TypeError("publication media URL is duplicated");
      byUrl.set(row.owned_url, row);
      ids.push(row.id);
    }
    if (proposal.canonical.images.some((url) => !byUrl.has(url))) {
      throw new TypeError("published images lack eligible owned current-run media records");
    }
    const updatedRows = await publicationQuery(
      `UPDATE listing_media_records
          SET property_id = $2::uuid
        WHERE id = ANY($1::uuid[])
          AND (property_id IS NULL OR property_id = $2::uuid)
        RETURNING id, property_id`,
      [ids, propertyId],
      "attach publishable image media",
      "UPDATE",
      operation,
    );
    if (updatedRows.length !== ids.length) {
      throw new PublicationConflictError(
        "publication conflict: media attachment changed concurrently",
        {
          propertyId,
        },
      );
    }
    const returnedIds = new Set();
    for (const row of updatedRows) {
      exactPublicationRow(row, new Set(["id", "property_id"]), "attached media row");
      if (!ids.includes(row.id) || row.property_id !== propertyId || returnedIds.has(row.id)) {
        throw new TypeError("attached media row does not match the publication request");
      }
      returnedIds.add(row.id);
    }
  }

  function eventIsReal(event, expected, winningObservations) {
    if (
      event.changeType !== expected.changeType ||
      event.fieldName !== expected.fieldName ||
      !jsonEqual(event.oldValue, expected.oldValue) ||
      !jsonEqual(event.newValue, expected.newValue)
    ) {
      return false;
    }
    if (expected.anyCurrentWinner) {
      if (
        event.winningObservationId !== null &&
        !winningObservations.has(event.winningObservationId)
      ) {
        return false;
      }
    } else if (event.winningObservationId !== expected.winningObservationId) {
      return false;
    }
    return expected.reason == null || event.reason === expected.reason;
  }

  function expectedChangeEvents(proposal, canonicalResult, linkChanges) {
    const expected = [];
    if (proposal.kind === "new") {
      expected.push(
        Object.freeze({
          changeType: "new",
          fieldName: null,
          oldValue: null,
          newValue: proposal.canonical,
          anyCurrentWinner: true,
          reason: null,
        }),
      );
    } else {
      for (const fieldName of [...canonicalResult.changedFields].sort()) {
        const field = proposal.fields.find((candidate) => candidate.fieldName === fieldName);
        const oldValue = canonicalResult.currentCanonical[fieldName];
        const newValue = proposal.canonical[fieldName];
        let changeType = "changed";
        let reason = null;
        if (fieldName === "status" && newValue === "inactive") {
          changeType = "inactive";
          reason = proposal.lifecycle.inactiveReason;
        } else if (fieldName === "status" && oldValue === "inactive") {
          changeType = "reactivated";
          if (
            proposal.lifecycle.consecutiveAbsentHealthyRuns !== 0 ||
            proposal.lifecycle.inactiveReason != null ||
            proposal.lifecycle.inactiveAt != null
          ) {
            throw new TypeError("reactivated lifecycle must clear counter, reason, and time");
          }
        }
        const lifecycleStatusChange = ["inactive", "reactivated"].includes(changeType);
        if (!field.activeOverride && !lifecycleStatusChange && field.winningObservationId == null) {
          throw new TypeError(`changed ${fieldName} field lacks current-run winning provenance`);
        }
        expected.push(
          Object.freeze({
            changeType,
            fieldName,
            oldValue,
            newValue,
            winningObservationId: lifecycleStatusChange ? null : field.winningObservationId,
            reason,
          }),
        );
      }
    }
    for (const linkChange of linkChanges) {
      expected.push(
        Object.freeze({
          changeType: "link_change",
          fieldName: null,
          oldValue: linkChange.oldValue,
          newValue: linkChange.newValue,
          winningObservationId: linkChange.winningObservationId,
          reason: null,
        }),
      );
    }
    return expected;
  }

  async function writeChangeEvents(
    proposal,
    propertyId,
    runId,
    canonicalResult,
    linkChanges,
    winningObservations,
    operation,
  ) {
    const unmatched = [...proposal.events];
    for (const expected of expectedChangeEvents(proposal, canonicalResult, linkChanges)) {
      const index = unmatched.findIndex((event) =>
        eventIsReal(event, expected, winningObservations),
      );
      if (index < 0) {
        const semanticCandidate = unmatched.find(
          (event) =>
            event.changeType === expected.changeType &&
            event.fieldName === expected.fieldName &&
            jsonEqual(event.oldValue, expected.oldValue) &&
            jsonEqual(event.newValue, expected.newValue),
        );
        if (semanticCandidate) {
          throw new TypeError(
            "publication event winning observation does not match field provenance",
          );
        }
        throw new TypeError("publication event coverage is missing an exact semantic event");
      }
      unmatched.splice(index, 1);
    }
    if (unmatched.length > 0) {
      throw new TypeError("publication event coverage contains an extra or no-op event");
    }
    let inserted = 0;
    for (const event of proposal.events) {
      const oldValue =
        event.oldValue == null ? null : serializeJson(event.oldValue, "change event old value");
      const newValue =
        event.newValue == null ? null : serializeJson(event.newValue, "change event new value");
      const rows = await publicationQuery(
        `INSERT INTO listing_change_events (
           property_id, run_id, change_type, field_name, old_value, new_value,
           winning_observation_id, reason
         )
         SELECT $1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7::uuid, $8
         WHERE NOT EXISTS (
           SELECT 1 FROM listing_change_events
            WHERE property_id = $1::uuid
              AND run_id = $2::uuid
              AND change_type = $3
              AND field_name IS NOT DISTINCT FROM $4
              AND old_value IS NOT DISTINCT FROM $5::jsonb
              AND new_value IS NOT DISTINCT FROM $6::jsonb
              AND winning_observation_id IS NOT DISTINCT FROM $7::uuid
              AND reason = $8
         )
         RETURNING id`,
        [
          propertyId,
          runId,
          event.changeType,
          event.fieldName,
          oldValue,
          newValue,
          event.winningObservationId,
          event.reason,
        ],
        "publish change event",
        "INSERT",
        operation,
      );
      if (rows.length > 1) throw new TypeError("published change event returned too many rows");
      if (rows.length === 1) {
        exactPublicationRow(rows[0], new Set(["id"]), "published change-event row");
        if (!isUuid(rows[0].id)) throw new TypeError("published change-event UUID is invalid");
        inserted += 1;
      }
    }
    return inserted;
  }

  function attachRollbackError(error, rollbackError) {
    const prior = Array.isArray(error.cleanupErrors) ? error.cleanupErrors : [];
    Object.defineProperty(error, "cleanupErrors", {
      configurable: true,
      enumerable: true,
      value: Object.freeze([...prior, rollbackError]),
      writable: false,
    });
    return error;
  }

  function stablePublicationFailure(error, cleanupErrors = []) {
    if (error instanceof PublicationError) {
      if (cleanupErrors.length > 0) attachRollbackError(error, cleanupErrors[0]);
      return error;
    }
    const rawSummary = error instanceof Error ? error.message : "unknown publication failure";
    let summary = "publication failure";
    if (typeof rawSummary === "string" && rawSummary.trim()) {
      try {
        summary =
          redactedText(rawSummary, "publication failure", {
            max: 500,
            nullable: false,
          }) ?? summary;
      } catch {
        summary = "publication failure";
      }
    }
    return new PublicationError(`MLS publication failed: ${summary}`, {
      cause: error,
      cleanupErrors,
    });
  }

  async function publishBatch(suppliedInput) {
    const input = validatePublicationBatch(suppliedInput);
    if (input.mode !== "publish") throw new PublicationGateError("publish mode is required");
    if (input.publishEnabled !== true) {
      throw new PublicationGateError("publication is not enabled");
    }
    const operation = input.signal == null ? undefined : Object.freeze({ signal: input.signal });
    const signal = operationSignal(operation);
    throwIfAborted(signal);
    const ordered = Object.freeze(
      [...input.proposals].sort((left, right) => {
        const leftKey = left.kind === "update" ? left.propertyId : left.canonical.listing_no;
        const rightKey = right.kind === "update" ? right.propertyId : right.canonical.listing_no;
        return leftKey.localeCompare(rightKey) || left.kind.localeCompare(right.kind);
      }),
    );
    let transactionState = "not_started";
    try {
      await assertLockSession(operation, true);
      await precheckPublicationBaselineGate(input.runId, operation);
      transactionState = "begin_attempted";
      const beginResult = await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE", []);
      transactionState = "begin_fulfilled";
      throwIfAborted(signal);
      validateQueryResult(beginResult, "begin serializable publication transaction", {
        expectedCommand: "BEGIN",
      });
      transactionState = "open";
      const gate = await recheckPublicationGate(input.runId, operation);
      if (ordered.some((proposal) => proposal.kind === "new")) {
        await publicationQuery(
          "LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE",
          [],
          "lock canonical property table for new identities",
          "LOCK",
          operation,
        );
      }
      const degraded = gate.sourceApproved[SOURCE_OLD_SITE] !== true;
      let inserted = 0;
      let updated = 0;
      let events = 0;
      for (const proposal of ordered) {
        throwIfAborted(signal);
        if (
          degraded &&
          (proposal.lifecycle.consecutiveAbsentHealthyRuns !== 0 ||
            proposal.events.some((event) => event.changeType === "inactive"))
        ) {
          throw new PublicationGateError(
            "degraded publication requires counter zero and no inactivity event",
          );
        }
        const winningObservations = await loadWinningObservations(
          proposal,
          input.runId,
          gate.sourceApproved,
          operation,
        );
        await validateFieldProvenance(proposal, winningObservations, operation);
        const canonicalResult = await writeCanonicalProperty(proposal, gate, operation);
        if (proposal.kind === "new") inserted += 1;
        else if (canonicalResult.changed) updated += 1;
        const linkChanges = await writeSourceLinks(
          proposal,
          canonicalResult.propertyId,
          input.runId,
          gate.sourceApproved,
          operation,
        );
        await writeFieldStates(proposal, canonicalResult.propertyId, operation);
        await writeLifecycleState(proposal, canonicalResult.propertyId, input.runId, operation);
        await attachImageMedia(
          proposal,
          canonicalResult.propertyId,
          winningObservations,
          operation,
        );
        events += await writeChangeEvents(
          proposal,
          canonicalResult.propertyId,
          input.runId,
          canonicalResult,
          linkChanges,
          winningObservations,
          operation,
        );
      }
      throwIfAborted(signal);
      transactionState = "commit_attempted";
      try {
        await publicationQuery(
          "COMMIT",
          [],
          "commit publication transaction",
          "COMMIT",
          operation,
          { checkAfter: false },
        );
      } catch (error) {
        throw new PublicationOutcomeUnknownError("MLS publication COMMIT outcome is unknown", {
          cause: error,
        });
      }
      transactionState = "committed";
      return Object.freeze({ inserted, updated, events });
    } catch (error) {
      const cleanupErrors = [];
      if (transactionState === "open" || transactionState === "begin_fulfilled") {
        try {
          await publicationQuery(
            "ROLLBACK",
            [],
            "rollback publication transaction",
            "ROLLBACK",
            undefined,
          );
          transactionState = "rolled_back";
        } catch (rollbackError) {
          cleanupErrors.push(rollbackError);
        }
      }
      if (signal?.aborted && Object.is(error, signal.reason)) throw error;
      if (transactionState === "commit_attempted") {
        throw error instanceof PublicationOutcomeUnknownError
          ? error
          : new PublicationOutcomeUnknownError("MLS publication COMMIT outcome is unknown", {
              cause: error,
            });
      }
      throw stablePublicationFailure(error, cleanupErrors);
    }
  }

  async function assertLockSession(operation, publication = false) {
    const rows = publication
      ? await publicationQuery(
          "SELECT 1 AS alive",
          [],
          "lock session assertion",
          "SELECT",
          operation,
        )
      : await query("SELECT 1 AS alive", [], "lock session assertion", operation);
    if (rows.length !== 1) {
      throw new Error("lock session assertion failed");
    }
    if (publication) {
      const row = exactPublicationRow(rows[0], new Set(["alive"]), "lock session row");
      if (row.alive !== 1) throw new Error("lock session assertion failed");
    } else if (rows[0]?.alive !== 1) {
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
    publishBatch,
    recordRunEvaluation,
    registerOwnedMedia,
    saveMediaRecord,
    saveObservations,
    saveProposedLinks,
  });
}
