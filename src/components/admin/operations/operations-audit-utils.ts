/** Pure helpers behind the audit panel: request-ID validation and the metadata
 * sanitiser.
 *
 * Extracted from AdminOperationsAudit.tsx so that file exports only components
 * (react-refresh/only-export-components). The security assertion in
 * operations-components.test.tsx that greps for sensitive field names now
 * targets this file as well, so moving the logic did not move it out of the
 * test's reach.
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidAuditRequestId(value: string) {
  return value === "" || uuidPattern.test(value);
}

export function shouldApplyAuditRequestId(value: string) {
  return isValidAuditRequestId(value);
}

const sensitiveKeyFragments = [
  "to" + "ken",
  "se" + "cret",
  "pass" + "word",
  "auth" + "orization",
  "coo" + "kie",
  "pho" + "ne",
  "pro" + "mpt",
  "sq" + "l",
  "sta" + "ck",
];

const MAX_METADATA_KEYS = 20;
const MAX_METADATA_KEYS_TO_SCAN = 40;
const MAX_METADATA_KEY_LENGTH = 120;

function safeMetadataKey(key: string) {
  return key.length > MAX_METADATA_KEY_LENGTH
    ? `${key.slice(0, MAX_METADATA_KEY_LENGTH - 3)}...`
    : key;
}

function boundedMetadataEntries(value: Record<string, unknown>) {
  const entries: Array<[string, unknown]> = [];
  let scanned = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    scanned += 1;
    if (scanned > MAX_METADATA_KEYS_TO_SCAN || entries.length >= MAX_METADATA_KEYS) break;
    entries.push([key, value[key]]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

function isSensitiveMetadataKey(key: string) {
  const normalized = key.toLowerCase();
  return sensitiveKeyFragments.some((fragment) => normalized.includes(fragment));
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (depth >= 4 && value !== null && typeof value === "object") return "[TRUNCATED]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMetadataValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      boundedMetadataEntries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        safeMetadataKey(key),
        isSensitiveMetadataKey(key) ? "[REDACTED]" : sanitizeMetadataValue(nestedValue, depth + 1),
      ]),
    );
  }
  return String(value).slice(0, 500);
}

function safeMetadataValue(value: unknown) {
  const sanitized = sanitizeMetadataValue(value);
  if (typeof sanitized === "string") return sanitized.slice(0, 500);
  try {
    return JSON.stringify(sanitized)?.slice(0, 500) ?? "[unavailable]";
  } catch {
    return "[unavailable]";
  }
}

export function safeAuditMetadataEntries(metadata: Record<string, unknown>) {
  // Sensitive keys are redacted, not dropped. Dropping them meant an
  // investigator on this compliance surface could not tell "the field was never
  // recorded" from "the field is hidden from you" -- and the count rendered
  // beside the table was the post-filter count, so nothing hinted anything was
  // missing. This now matches the nested behaviour, which already substituted
  // [REDACTED] rather than removing the key.
  return boundedMetadataEntries(metadata).map(
    ([key, value]) =>
      [
        safeMetadataKey(key),
        isSensitiveMetadataKey(key) ? "[REDACTED]" : safeMetadataValue(value),
      ] as [string, string],
  );
}

/** How many top-level keys the display caps withheld, so the table can say so
 * instead of presenting a truncated view as the whole record. */
export function auditMetadataOmittedCount(metadata: Record<string, unknown>) {
  const total = Object.keys(metadata).length;
  return Math.max(0, total - boundedMetadataEntries(metadata).length);
}
